**中文** | [English](README.en.md)

# cimbar-bigfile

> 基于 [sz3/libcimbar](https://github.com/sz3/libcimbar) 的大文件光学传输工具——突破 ~10MB 单次稳定上限，无网络环境下传输任意大小文件。

## 这是什么？

`cimbar-bigfile` 在 libcimbar 之上做了一层**纯 HTML/JS 包装**，把大文件切成 10MB 的小块，每块独立用 fountain code 编码（不同 `encode_id`），在屏幕上依次播放彩色码动画。

接收端用作者的 **CameraFileCopy (CFC)** 安卓应用扫码，CFC 内置的 `fountain_decoder_sink` 已经原生支持按 `encode_id` 并发分桶解码，**完全无需修改**。所有块收完后用浏览器打开拼接页面，拖入文件即可还原原始大文件。

```
[发送端 send.html]  →  屏幕动画  →  [手机 CFC]  →  保存 N 个块  →  [拼接 reassemble.html]  →  原文件
```

## 用法

### 准备

1. **接收端**：手机安装 [CameraFileCopy](https://github.com/sz3/cfc/releases) (F-Droid / Google Play / GitHub Release APK)
2. **发送端**：电脑浏览器双击打开 `send.standalone.html`（自包含单文件版，无需联网，**推荐**）
3. **拼接端**：任意浏览器双击打开 `reassemble.html`（零依赖纯 JS，无需联网）

> 也可以用模块化的 `send.html`（开发版），但需要先起本地 HTTP server（见下文 [开发](#开发) 段），因为浏览器在 `file://` 协议下会拦截 wasm 文件加载。普通用户用 standalone 版更简单。

### 发送

1. 打开 `send.standalone.html`
2. 把要传的文件拖入页面
3. 点击 "开始传输"，屏幕开始播放彩色码动画
4. **保持屏幕不动直到所有块发完**

#### 💡 加速接收：手动跳转 chunk

大文件（多块）模式下，页面底部会出现一排跳转按钮（`manifest` / `part00` / `part01` / ...）。
默认行为是发送方按 `manifest → part00 → part01 → ... → 循环回 manifest` 的顺序循环播放，CFC 扫到哪块靠随机命中——100MB 文件总扫描时间约 ~55 分钟。

**用法**：每当 CFC 弹出"保存到哪里"对话框、保存了某个 chunk 后，**立刻点页面上对应的下一个目标 chunk 按钮**。发送方会专心播放该 chunk，CFC 下次扫到的必然是它。

**预期收益**：100MB 文件总扫描时间从 ~55 分钟降到 ~17 分钟（消除随机扫描等待）。

> simpleMode（小文件 ≤ 块大小，单文件直发）下不显示跳转按钮——只有 1 个 stream，跳转无意义。

### 接收

1. 手机打开 CFC，对着电脑屏幕
2. 每完成一块，CFC 会弹出"保存到哪里"对话框
3. **每次都选同一个目录**（推荐建一个 `cimbar-bigfile-job1/` 目录）
4. 全部接收完后：
   - **小文件（≤ 块大小，默认 ≤ 10 MB）**：直接 1 个原文件名的文件，**不需要拼接**，CFC 落盘的就是原文件
   - **大文件（> 块大小）**：N+1 个文件 `manifest.json` + `<filename>.part00.bin` ... `<filename>.partNN.bin`，需要走下面的拼接步骤

### 拼接（仅大文件需要）

1. 把手机里的所有文件传到电脑（USB / 邮件 / 任何方式）
2. 浏览器打开 `reassemble.html`
3. 全选所有文件拖入页面
4. 自动校验 SHA256 → 通过 → 自动下载还原后的原文件

## 已知限制

- **每块完成 CFC 弹一次保存对话框**：10MB / 块时，100MB 文件需要点 11 次"保存"。详见 [ROADMAP.md](ROADMAP.md) Plan B 优化方案。
- **吞吐量**：约 **106 KB/s**（libcimbar Mode B 默认）。100MB 文件预计耗时 16-20 分钟。
- **接收端目前只能用 Android CFC**：libcimbar web 端没有解码器。

## 故障排除

| 症状 | 可能原因 | 解决方法 |
|------|---------|---------|
| CFC 扫不到任何码 | 屏幕亮度低 / 距离不对 | 屏幕调最高亮度，离手机 10-30 cm |
| CFC 扫描很慢 | 帧率太高摄像头跟不上 | send.html 把 FPS 调到 10-12 |
| 某些块没收到 | fountain 冗余不够 | send.html 把 "冗余" 调到 2.0 或更高，让发送端给每块多发些帧 |
| 拼接 SHA256 校验失败 | 某块在传输中损坏 | 看哪块失败 → 重新发送（用同一 encode_id_base 重启 send.html，跳到那块） |
| 浏览器加载 wasm 失败 | file:// 协议被 CORS 拦截（开发版 `send.html` 才有此问题） | 改用 `send.standalone.html`（双击即可），或用本地 HTTP server：`python -m http.server 8000` 访问 `http://localhost:8000/send.html` |
| 文件名乱码 | 系统字符编码问题 | manifest 强制 UTF-8，检查浏览器/手机系统编码 |
| 浏览器卡顿 | 文件太大 wasm 堆压力 | 降低单块大小（默认 10MB → 5MB） |
| 总扫描时间太长 | CFC 每次保存重置 fountain 状态，发送方循环导致命中靠运气 | 用新加的「跳转按钮」主动指定下一个目标 chunk（见上方"加速接收"段） |
| Android 保存对话框点烦了 | 块数太多 | 见 [ROADMAP.md](ROADMAP.md) Plan B（fork CFC 加批量保存模式） |

## 性能参考

参考环境：1080p 屏幕 + Pixel 5 + 默认参数（Mode B / 15 fps / 10 MB 块 / 1.5x 冗余）

| 文件大小 | 块数 | 弹窗次数 | 预估耗时 | 参考吞吐 (Mode B) |
|---------|------|---------|---------|-------------------|
| 5 MB | 1 块（直发，无 manifest） | 1 次 | ~1 分钟 | ~85 KB/s |
| 28 MB | 3 块 | 4 次（manifest + 3 块） | ~4-5 分钟 | ~100 KB/s |
| 100 MB | 10 块 | 11 次（manifest + 10 块） | ~16-20 分钟 | ~106 KB/s |

> 验证覆盖：5 MB（bundled `test/test-5m.bin`）+ ~28 MB（手动光学链路 end-to-end）+ 100 MB（应用层 round-trip via `scripts/test-round-trip-100mb.js`）。其他规模线性外推。
>
> 实际吞吐受光线、屏幕亮度、相机自动对焦稳定性影响很大。

## 开发

### 更新 libcimbar 依赖

详见 [`vendor/README.md` 的 "Updating to newer libcimbar release" 章节](vendor/README.md#updating-to-newer-libcimbar-release)。

### 协议规范

- [docs/manifest-spec.md](docs/manifest-spec.md) - manifest JSON 字段语义
- [docs/architecture.md](docs/architecture.md) - 数据流、wasm API、设计决策

### 本地测试发送端

```bash
# 起本地 HTTP 服务器（避免 file:// CORS 问题）
python -m http.server 8000
# 浏览器访问 http://localhost:8000/send.html
```

### 构建自包含单文件版

`send.standalone.html` 是给最终用户的"双击即用"版本，把 vendor wasm + glue js 都 base64 inline 进 HTML，脱离 HTTP server。每次升级 vendor 后必须重新构建：

```bash
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python scripts/build-standalone.py
# 输出 send.standalone.html (约 2.5 MB)
```

构建脚本只读 `send.html` + `vendor/cimbar-wasm-v0.6.4/cimbar_js.*.js` + `cimbar_js.*.wasm`，输出独立文件到仓库根目录。原理：替换 `<script src="vendor/...">` 为 inline `<script>` 把 base64 解码成 `Module.wasmBinary`，emscripten glue 检测到就跳过 fetch。

## 架构与协议

- 协议规范：[docs/manifest-spec.md](docs/manifest-spec.md)
- 架构图：[docs/architecture.md](docs/architecture.md)
- 未来方向：[ROADMAP.md](ROADMAP.md)

## License & Acknowledgements

cimbar-bigfile 是 libcimbar 之上的轻量包装器。**本仓库由 MIT、MPL-2.0、BSD-3-Clause 三个许可证共同管理**：

| 部分 | 许可证 | 版权 | 说明 |
|------|-------|------|------|
| `send.html` / `reassemble.html` / `docs/*` 等本项目原创代码 | **MIT** | © 2026 peipei | 详见 [`LICENSE`](LICENSE) |
| `vendor/cimbar_js.html` / `vendor/cimbar-wasm-v0.6.4/*` | **MPL-2.0** | © sz3 (libcimbar) | 详见 [`vendor/LICENSE-libcimbar`](vendor/LICENSE-libcimbar) |
| 上述 wasm 内嵌的 wirehair fountain code 库 | **BSD-3-Clause** | © 2018 Christopher A. Taylor | 详见 [`vendor/LICENSE-wirehair`](vendor/LICENSE-wirehair) |
| 用户独立安装的 CFC Android 接收端 (未 vendor) | **MIT** | © sz3 | 见 [github.com/sz3/cfc](https://github.com/sz3/cfc) |

**MPL-2.0 source obligation**：本项目分发了 libcimbar 的 wasm 二进制（Executable Form），按 MPL-2.0 §3.2，对应的 source code 可在 https://github.com/sz3/libcimbar/tree/v0.6.4 免费获取。

### 致谢

- [sz3/libcimbar](https://github.com/sz3/libcimbar) — 核心 fountain code + cimbar 编解码引擎
- [sz3/cfc](https://github.com/sz3/cfc) — 接收端 Android 应用
- [catid/wirehair](https://github.com/catid/wirehair) — 底层 fountain code 库
