# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目本质

**纯前端光学传输工具**，无包管理器、无 lint、无自动化测试。核心交付物三个 HTML 文件：

- `send.html` — 发送端开发版：切片 + 调外部 vendored libcimbar wasm 做 fountain 编码 + 渲染彩色码动画到 canvas。**file:// 协议下不能用**（wasm fetch 被 CORS 拦），开发时必须配 HTTP server。
- `send.standalone.html` — 发送端用户版：`scripts/build-standalone.py` 产物，base64 inline wasm + glue js 到 send.html 一份独立 HTML（约 2.5 MB），**双击 file:// 即可运行**。给终端用户的版本。
- `reassemble.html` — 拼接端：**零 wasm 依赖纯 JS**，读 manifest + 校验 SHA256 + 顺序拼接 + 触发下载，永远双击即用。

接收端是用户独立安装的 **CFC (CameraFileCopy)** Android 应用（**不在本仓库**，见 https://github.com/sz3/cfc）。

## 开发与本地测试

**改 `send.html` 时**（开发版）— 必须起 HTTP server，因为 file:// 下 wasm fetch 被浏览器 CORS 拦截：

```bash
python -m http.server 8000
# 浏览器访问 http://localhost:8000/send.html
```

**改完 send.html 后** — 必须重新跑构建脚本同步 standalone 版本：

```bash
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python scripts/build-standalone.py
```

否则 `send.standalone.html` 内嵌的是旧版 send.html UI/逻辑，与开发版分叉。**这是修改 send.html 后忘了做就会让 standalone 用户卡在旧 bug 的事**。

测试样本：`test/test-5m.bin`（5 MB 已 vendored）。无 CI/test runner——验证靠人工跑端到端流程（电脑发送→手机 CFC 接收→拼接）。

## 构建脚本契约（`scripts/build-standalone.py`）

工作机制：在 send.html 里找到 `<script src="vendor/cimbar-wasm-v0.6.4/cimbar_js.2026-01-20T0312.js"></script>` 这一行，替换为两段 inline `<script>`：

1. 第一段：把 vendor wasm base64 解码成 `Uint8Array` 赋给 `Module.wasmBinary`
2. 第二段：原 glue js 内容直接 inline

emscripten glue 加载时检测 `Module.wasmBinary` 已存在就**跳过 fetch 走 sync path**（这是 v0.6.4 glue 的具体行为，看 `getBinarySync` / `getBinaryPromise` 源码）。

**修改前必读的不变量**：
- 替换的 NEEDLE 必须与 send.html 里实际的 `<script src=...>` 完全一致——升级 vendor 改了文件名时必须同步修改脚本里的 NEEDLE 常量
- 注入位置必须在 main script（`window.Module = {...}`）之后、glue script 之前——main script 创建 Module 对象，inline script 才能在它上面挂 wasmBinary 字段
- glue js 不能含 `</script>` 子串（脚本会检测并报错）；emscripten 输出通常不含，但升级版本时仍要重检

## 必须遵守的协议契约（修改 send.html 前必读）

**修改后端到端流程都会断的不变量**：

1. **encode_id 分桶**：每 chunk 必须用**独立** `encode_id`，CFC 的 `fountain_decoder_sink` 用 `unordered_map<encode_id, stream>` 分桶并发解码；同 ID 不同内容会污染状态。`encode_id_base = Date.now()/1000 & 0xFFFF`，`base+0`=manifest，`base+1..N`=数据块 0..N-1。
2. **manifest 必须留在循环里**：发完所有 chunk 后回到 index=0（manifest）继续循环——晚到的接收方需要先拿到 manifest 才能识别后续 chunk。删掉 `advanceToNextChunk()` 里的 loop-back 分支会让晚启动的 CFC 永远抓不到 manifest。
3. **chunk 文件名严格 `<basename>.partNN.bin`**：拼接端按这个名字反向匹配 `manifest.chunks[].index`。零填充宽度按块数自适应（< 100 块用 2 位、< 1000 用 3 位）。`<basename>` = `filename` 去掉**最后一个**后缀（`.tar.gz` → `.tar`）。改命名规则必须同步改 `reassemble.html` 的解析。
4. **文件名通过 ZSTD header 传**：`_cimbare_init_encode(filename, len, encode_id)` 把 filename 写进 ZSTD header，CFC 直接当落盘文件名。**不要**自己再发文件名 metadata——CFC 端没解析协议。
5. **manifest JSON 不缩进**：每字节都对应额外的 fountain 帧 / CFC 保存对话框点击次数。修改 manifest 序列化时禁止 `JSON.stringify(m, null, 2)`。
6. **协议 version 字段强校验**：reassemble.html 遇到 `version !== 1` 直接拒绝。新增字段走兼容扩展（不改 version）；改语义/删字段必须 bump 并在 `docs/manifest-spec.md` 记录。

## libcimbar wasm API 契约（v0.6.4 锁定）

`send.html` 依赖 `vendor/cimbar-wasm-v0.6.4/cimbar_js.2026-01-20T0312.js`。**实际调用的 export**：

| Export | 说明 |
|--------|------|
| `_cimbare_configure(modeVal, frameRate)` | 当前固定 `modeVal=68` (Mode B)、`frameRate=-1`（不变） |
| `_cimbare_init_encode(fnPtr, fnLen, fountain_id)` | 传 `-1` 自动递增；本项目**显式传 `encode_id_base + i`** 控制分桶 |
| `_cimbare_encode_bufsize()` | 每次 streaming chunk 大小，分批喂入 |
| `_cimbare_encode(dataPtr, dataLen)` | 喂数据；最后必须再调一次 `len=0` flush |
| `_cimbare_render()` | 渲染当前帧到 `Module.canvas` |
| `_cimbare_next_frame(colorBalance)` | 推进帧；本项目传 `false` |

完整 API 表（含解码端，本项目不直接用）：`vendor/README.md`。

**升级 libcimbar 版本流程**：见 `vendor/README.md` 末尾。重点——升级后必须 inspect 新的 `main.*.js` 检查 export 是否变化，必要时同步改 `send.html` 调用代码 + 更新 `vendor/README.md` API 表。

## 关键常量（修改前确认理解原因）

- `ESTIMATED_BYTES_PER_FRAME = 7500`（send.html:199）— Mode B ECC payload 经验值，用于估算 fountain 帧数。改这个值会让 `framesNeededFor()` 估算失准（多发浪费时间 / 少发等下一轮）。
- 默认值：FPS=15、chunk=10 MB、redundancy=1.5x、Mode B（modeVal=68）。这些都暴露给用户在 UI 上调，不要硬编码删除控件。
- `framesNeededFor()` 下限是 30 帧（避免极小 manifest 一闪而过 CFC 没来得及锁焦）。

## 仓库结构

```
cimbar-bigfile/
├── send.html               # 发送端开发版（依赖 vendor wasm，需要 HTTP server）
├── send.standalone.html    # 发送端用户版（构建产物，双击即用，约 2.5 MB）
├── reassemble.html         # 拼接端（零依赖纯 JS，永远双击即用）
├── scripts/
│   └── build-standalone.py # 构建脚本：base64 inline wasm + glue 到 send.html
├── docs/
│   ├── manifest-spec.md    # manifest JSON 协议规范（修改协议必同步更新）
│   └── architecture.md     # 数据流时序 + 设计决策（写为什么这么做的根因）
├── vendor/
│   ├── cimbar-wasm-v0.6.4/     # 解压后的模块化 wasm（send.html + 构建脚本用）
│   ├── cimbar_js.html          # 上游自包含单文件版（参考用，不被引用）
│   ├── cimbar.wasm.tar.gz      # 原始 release 包
│   ├── LICENSE-libcimbar       # MPL-2.0
│   └── LICENSE-wirehair        # BSD-3-Clause
├── test/test-5m.bin        # 端到端测试样本
├── ROADMAP.md              # 已识别但未做的优化（Plan B-G）
└── LICENSE                 # 本项目 MIT
```

## 三许可证共存（修改 vendor 前必读）

- 本项目原创代码（`send.html` / `reassemble.html` / `docs/*`）：**MIT**
- `vendor/cimbar*` 全部内容：**MPL-2.0**（copyleft）— 修改这些文件需以 MPL-2.0 释出修改后的源码
- vendor wasm 内嵌的 wirehair：**BSD-3-Clause**

**MPL-2.0 §3.2 source obligation**：本仓库分发了 wasm 二进制，README 必须保留指向 `https://github.com/sz3/libcimbar/tree/v0.6.4` 的源码引用链接。**当前未修改任何 vendor 内容**——如果需要修改 vendor wasm，必须先开 issue 讨论，且分发时附带修改后源码或链接。

## 提交风格

- commit message 用中文，≤ 50 字
- 禁止 `Co-Authored-By: Claude` 行（不把 AI 署名写进 git log）
