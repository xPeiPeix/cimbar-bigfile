#!/usr/bin/env python
"""build-standalone.py — 打包 send.html 为自包含单文件版 send.standalone.html

替换 send.html 里 `<script src="vendor/....js">` 为两段 inline:
  1. base64 -> Uint8Array -> Module.wasmBinary  (让 emscripten glue 跳过 fetch)
  2. 原 glue js 内容直接 inline

输出 send.standalone.html (~4 MB), 双击即可在 file:// 下运行, 不需要 HTTP server.

用法:
    PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python scripts/build-standalone.py
"""
import base64
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEND_HTML = ROOT / "send.html"
GLUE_JS = ROOT / "vendor" / "cimbar-wasm-v0.6.4" / "cimbar_js.2026-01-20T0312.js"
WASM = ROOT / "vendor" / "cimbar-wasm-v0.6.4" / "cimbar_js.2026-01-20T0312.wasm"
OUT = ROOT / "send.standalone.html"

NEEDLE = '<script src="vendor/cimbar-wasm-v0.6.4/cimbar_js.2026-01-20T0312.js"></script>'


def main() -> int:
    for p in (SEND_HTML, GLUE_JS, WASM):
        if not p.is_file():
            print(f"ERR: 文件缺失: {p}", file=sys.stderr)
            return 1

    html = SEND_HTML.read_text(encoding="utf-8")
    if NEEDLE not in html:
        print(
            f"ERR: send.html 找不到目标 script 标签:\n  {NEEDLE}\n"
            "  (可能 vendor 版本号变了, 同步更新本脚本的 NEEDLE 常量)",
            file=sys.stderr,
        )
        return 1

    glue = GLUE_JS.read_text(encoding="utf-8")
    # HTML5 spec (WHATWG §13.2.5.16): script data end tag 后只要跟 \s / > 就终止, 不限于 `</script>`.
    # 匹配所有合法终止变体: </script ` `, </script\t, </script\n, </script/, </script> 等.
    if re.search(r"</script[\s/>]", glue, re.IGNORECASE):
        print("ERR: glue js 含 </script> 子串变体, 需要转义后再 inline", file=sys.stderr)
        return 1

    wasm_bytes = WASM.read_bytes()
    wasm_b64 = base64.b64encode(wasm_bytes).decode("ascii")

    inline_block = (
        "<script>\n"
        "// === build-standalone.py: inline wasm (base64 -> Module.wasmBinary) ===\n"
        "// emscripten glue 检测到 Module.wasmBinary 已设置就跳过 fetch, 走 sync path\n"
        "Module.wasmBinary = (() => {\n"
        f'  const b64 = "{wasm_b64}";\n'
        "  const bin = atob(b64);\n"
        "  const arr = new Uint8Array(bin.length);\n"
        "  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);\n"
        "  return arr;\n"
        "})();\n"
        "</script>\n"
        "<script>\n"
        "// === build-standalone.py: original cimbar_js glue inlined ===\n"
        + glue
        + "\n</script>"
    )

    out_html = html.replace(NEEDLE, inline_block, 1)
    # 原子写: Ctrl+C / 磁盘满 / 编码失败时不会留下半截 send.standalone.html 让用户误用
    tmp = OUT.with_suffix(OUT.suffix + ".tmp")
    tmp.write_text(out_html, encoding="utf-8")
    os.replace(tmp, OUT)

    src_kb = SEND_HTML.stat().st_size / 1024
    wasm_mb = len(wasm_bytes) / 1024 / 1024
    out_mb = OUT.stat().st_size / 1024 / 1024
    print(f"[OK] {OUT.name}")
    print(f"     源 send.html : {src_kb:.1f} KB")
    print(f"     vendor wasm  : {wasm_mb:.2f} MB (base64 后 ~{wasm_mb*4/3:.2f} MB)")
    print(f"     输出 standalone: {out_mb:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
