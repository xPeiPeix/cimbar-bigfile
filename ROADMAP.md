# cimbar-bigfile · Roadmap

本文件记录已识别但尚未实施的优化方向，优先级按"用户体验改善 ÷ 实施成本"排序。

---

## 🔥 Plan B: fork CFC 添加批量自动保存模式

**优先级**：高（如果主人觉得每次手点 N 次保存对话框太烦）

### 问题

当前方案 A 利用 CFC 原生的 fountain 多 stream 分桶能力，但每个 stream 完成时 CFC 都会调用 Android 系统的 `ACTION_CREATE_DOCUMENT` intent，弹窗让用户手选保存目录。**100 MB 的文件分 10 块就会弹 11 次保存对话框**，用户需要每次都点"保存"，体验差。

CFC 当前实现见 `app/src/main/java/org/cimbar/camerafilecopy/MainActivity.java`（GitHub: https://github.com/sz3/cfc）。

### 改动方案

在 CFC 添加 "Batch Save Mode" 设置项：

1. **新增 toggle**：CFC 设置页加 "Batch save mode" 开关，默认关闭
2. **新增目录选择**：开启时让用户预先选择一个 SAF tree URI（一次性），存到 SharedPreferences
3. **改保存逻辑**：当 batch mode 开启 + tree URI 已设置时，每个完成文件直接通过 `DocumentFile.createFile()` 保存到该 tree URI 下，跳过 ACTION_CREATE_DOCUMENT
4. **冲突处理**：同名文件追加 `_1` `_2` 后缀，或覆盖（用户可配置）

### 改动量估算

- `MainActivity.java` 修改约 **30-50 行**（新增 batch mode 检查 + 目录写入逻辑）
- 新增 `BatchModeSettings.java` 约 **40 行**（SharedPreferences 包装）
- `settings_activity.xml` 新增 **2 个 PreferenceCategory** 项
- 总计 **< 100 行 Kotlin/Java**

### 风险

- **SAF 兼容性**：Android 11+ 对 SAF tree URI 权限较严，需要测试 11/12/13/14 各版本行为
- **APK 重新签名**：需要主人自分发签名 APK（用 keytool + jarsigner），不能直接走 Play 商店原始签名
- **CFC 上游可能不接受 PR**：作者风格偏向"用户主动控制"，自动保存可能被视为反模式。需要先开 issue 讨论

### 触发条件

完成 Plan A MVP 验证后，主人在实际使用中觉得每次手点 10 次太烦时启动这个改造。

### 实施步骤（如启动）

1. fork sz3/cfc 到主人 GitHub
2. clone + 装 Android Studio + NDK + OpenCV 4.5.0（详见 cfc README）
3. 实现 batch mode（按上述方案）
4. 本地构建 + 签名 + 装到主人测试机
5. 端到端验证：与本仓库 send.html 配合 10 块以上场景，确认不再弹窗
6. 提 PR 给上游（沟通后再决定是否合并）
7. 不论合并与否，把签名 APK 放到本仓库 release 供主人使用

---

## 🌐 Plan C: 浏览器接收端（替代 CFC Android）

**优先级**：中（CFC 已经够用，但有些场景手机不方便装 app）

### 背景

libcimbar v0.6.4 的 release 内含 `recv.html` + `recv-worker.js`——这是个**功能完整的 web 解码器**，使用 `getUserMedia` + 4 个 web worker 并行 barcode 提取 + 主线程 fountain decode。

实测能力（从源码推断）：
- 多 fountain stream 并发解码（用 `_cimbard_get_report()` 返回 JSON 数组追踪每 stream 进度）
- ZSTD 解压 + 文件名提取（`_cimbard_get_filename(id, buf, max)`）
- 自动模式检测（Auto / B / Bm / Bu / 4C）

### 改动方案

基于 v0.6.4 的 `recv.html`，加上：

1. **多文件批量保存**：当前 recv.html 每完成一个文件触发一次浏览器下载，对应 N+1 次下载弹窗
2. **manifest 自动识别**：识别到 `manifest.json` 后，自动等待对应 chunks 全部完成
3. **浏览器内拼接**：所有 chunks 收到后直接在浏览器内拼接（不需要单独的 reassemble.html）
4. **手机优化 UI**：当前 recv.html 是桌面 UI，要做触控/响应式优化

### 改动量估算

- 写一个新的 `recv-bigfile.html`，复用 recv.js 的核心解码循环
- 约 **300-500 行 JS**（manifest 识别 + 拼接 + UI 重写）
- 不需要改 wasm，直接使用 vendor 的 cimbar_js.wasm

### 风险

- **HTTPS 强制**：`getUserMedia` 在 file:// 和 http:// 都被禁用，必须 HTTPS（或 localhost）。需要主人本地起 https server 或借用第三方静态托管（GitHub Pages / Cloudflare Pages）
- **手机浏览器性能**：iOS Safari 的 `VideoFrame` API 较新，可能有兼容问题；安卓 Chrome 性能未知
- **多 worker 内存**：4 个 worker × wasm heap 128MB = 512 MB，老旧手机可能 OOM

### 触发条件

主人在某个不方便装 CFC 的场景需要接收文件时（如临时公用电脑）。

---

## 🚀 Plan D: 5×5 cells 高密度模式

**优先级**：中（吞吐量 ×10，但稳定性未知）

### 背景

libcimbar 的 `PERFORMANCE.md` 提到 `Conf5x5` Beta 模式吞吐 >1 Mbit/s（vs 默认 8x8 的 ~852 kbit/s，**约 10 倍**）。但这是 compile-time 配置，需要重新构建 wasm。

### 改动方案

1. fork libcimbar
2. 在 emscripten 构建脚本里启用 `Conf5x5`
3. 自分发新 wasm 模块到本仓库 vendor/
4. send.html 加 mode 选择按钮

### 风险

- **未生产验证**：作者标记为 Beta，CFC 当前可能不支持解码 5x5 模式
- **接收端配套**：需要 CFC 也升级支持 5x5（否则只能用浏览器接收端）
- **复杂度**：要搭 emscripten + libcimbar 构建链

### 触发条件

主人对吞吐有强需求（GB 级文件常态化传输），且能接受可能的稳定性风险。

---

## ⚡ Plan E: 多屏并行发送

**优先级**：低（场景受限）

### 思路

N 台电脑屏幕同时显示 N 个不同 chunk 的 fountain 动画，主人用 N 个手机或一个手机扫描 N 块屏幕区域，理论吞吐 ×N。

### 风险

- 需要 N 台显示设备，主人通常没有
- N 个手机协调难
- CFC 一次只看一个 stream，多屏只对单 ID 有效，**不能解决 chunked 场景**——chunked 已经在串行发，多屏会让 ID 错乱

实际收益不大，记录在此但不计划做。

---

## 🔁 Plan F: 自动重传缺失块协议

**优先级**：低（fountain code 本来就有冗余）

### 思路

接收端识别"缺哪几块"，反向通知发送端只重发那几块。

### 问题

我们的链路是单向的（屏幕→摄像头），没有反向通道。除非：
- 主人手动看 CFC 状态，告诉发送端缺哪块（人肉协议）
- 引入辅助通道（USB/蓝牙做控制平面）—— 但这违背了"无网络光学传输"的初衷

实际意义不大。fountain code 的特性已经天然解决冗余问题——发送端持续循环，接收端会自动补齐。

---

## 📚 Plan G: 提 PR 到 libcimbar contrib

**优先级**：低（社区贡献向）

把 cimbar-bigfile 作为官方推荐工具提交到 libcimbar 的 `contrib/` 目录或 README 推荐工具列表，让所有 cimbar 用户受益。

### 触发条件

Plan A 实测稳定 + 至少有一个其他用户成功使用 + 文档完善后。

---

## 已完成项

- ✅ MVP 设计 + 实现
- ✅ vendor 进 libcimbar v0.6.4 wasm 资源
- ✅ manifest 协议 v1
- ✅ send.html / reassemble.html
- ✅ 文档：README / architecture.md / manifest-spec.md / 本 ROADMAP
