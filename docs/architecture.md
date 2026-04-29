# cimbar-bigfile 架构与数据流

## 总览

`cimbar-bigfile` 是一层**纯前端包装器**，没有自己的 wasm 模块；它复用 libcimbar v0.6.4 官方发布的 wasm 引擎，在 JS 层实现"切片 + 多 fountain stream 编码 + 接收端原生分桶 + 浏览器拼接"的工作流。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          cimbar-bigfile 架构                             │
└─────────────────────────────────────────────────────────────────────────┘

  [send.html]                                      [reassemble.html]
  发送端 (电脑浏览器)                                拼接端 (任意浏览器)
   │                                                 │
   │  原文件 (e.g. 100MB)                             │  收到的 N+1 个文件
   │  ↓ JS 切片 + SHA256                              │  ↓ 拖拽解析
   │  manifest.json + N 个 chunk Uint8Array          │  ↓ 校验 SHA256
   │  ↓ 调 cimbar wasm encoder                        │  ↓ 顺序拼接
   │  Module._cimbare_init_encode(name, len, id)     │  ↓ 全文 SHA256 校验
   │  Module._cimbare_encode(data, len)               │  ↓ 触发下载
   │  ↓ 渲染帧动画到 canvas                            │  原文件 (100MB)
   │                                                 │
   └─→ 屏幕                                          ┘
       ↓
       彩色码动画 (Mode B, 默认 15 fps)
       ↓
   [手机 CFC (CameraFileCopy Android app)]
   接收端 (不修改)
       │
       │  对屏幕拍摄帧
       │  ↓ 4 个 web worker 并行 barcode 提取
       │  ↓ 主线程 fountain decode (cimbard_fountain_decode)
       │  ↓ unordered_map<encode_id, fountain_decoder_stream> 分桶并发
       │  ↓ 每个 stream 完成后 ZSTD 解压 → ACTION_CREATE_DOCUMENT 弹窗
       │
       └─→ N+1 个文件落到用户选择的目录
            (manifest.json + <basename>.partXX.bin × N)
```

## 数据流时序图

```
Send Client          Display              CFC (Android)         Reassemble Client
  (Browser)          (Screen)             (Phone)               (Browser, later)
     │                  │                    │                     │
     │ user drops file  │                    │                     │
     │←────────         │                    │                     │
     │                  │                    │                     │
     │ slice + SHA256   │                    │                     │
     │ build manifest   │                    │                     │
     │                  │                    │                     │
     │ encode_init      │                    │                     │
     │ ("manifest.json",│                    │                     │
     │  ID_BASE+0)      │                    │                     │
     │ feed manifest    │                    │                     │
     │ render frames ──▶│ flicker barcodes   │                     │
     │                  │ ─────────────────▶ │ extract            │
     │                  │                    │ fountain_decode    │
     │                  │                    │ stream(ID_BASE+0)   │
     │                  │                    │ ↓ done             │
     │                  │                    │ save manifest.json  │
     │                  │                    │ to user-chosen dir  │
     │                  │                    │                     │
     │ encode_init      │                    │ (camera keeps       │
     │ ("name.part00",  │                    │  scanning)          │
     │  ID_BASE+1)      │                    │                     │
     │ feed chunk 0     │                    │                     │
     │ render frames ──▶│ ───────────────▶  │ stream(ID_BASE+1)   │
     │                  │                    │ ↓ done              │
     │                  │                    │ save part00.bin     │
     │                  │                    │                     │
     │   ... repeat for chunks 1..N-1 ...    │                     │
     │                  │                    │                     │
     │ all chunks sent  │                    │ all N+1 files saved │
     │ (loop for fountain redundancy)        │                     │
     │                  │                    │                     │
     │  user transfers files                                       │
     │  to reassemble client (USB / cloud / whatever)              │
     │                  ─────────────────────────────────────────▶ │
     │                                                             │ user drops files
     │                                                             │ parse manifest
     │                                                             │ verify each chunk SHA256
     │                                                             │ concat ──▶ output
     │                                                             │ verify full-file SHA256
     │                                                             │ trigger download
```

## libcimbar wasm API 契约（v0.6.4）

完整 API 表见 `../vendor/README.md`。这里只列我们实际调用的：

### 编码器（send.html 用）

```c
// 配置编码模式（每次会话开始时调一次）
void cimbare_configure(int modeVal, int frameRate);
// modeVal: 4=4C, 66=Bu, 67=Bm, 68=B (我们用 68)
// frameRate: -1 = 不变

// 启动一个新 fountain stream（每个 chunk 调一次）
int cimbare_init_encode(const char* filename, size_t filename_len, int fountain_id);
// fountain_id: -1 自动递增；显式传入则我们手动控制 encode_id

// 拿编码器期望的内部 streaming buffer 大小
int cimbare_encode_bufsize();

// 喂入一段数据（多次调用直到喂完）
int cimbare_encode(const uint8_t* data, size_t len);
// 文件喂完后再调一次 len=0 作为 flush

// 渲染当前帧到 canvas
void cimbare_render();

// 推进到下一帧，返回累计帧计数
int cimbare_next_frame(bool color_balance);
```

### 解码器（CFC native 用，本工具不直接用，但 v0.6.4 web 版 recv.html 也提供）

```c
int cimbard_get_bufsize();
void cimbard_configure_decode(int mode);
int64_t cimbard_fountain_decode(const uint8_t* buf, size_t len);  // 返回完成的 encode_id 或 0
int cimbard_get_report(uint8_t* out, size_t max_len);             // 写入 JSON 进度数组
int64_t cimbard_get_filesize(int64_t encode_id);
int cimbard_get_filename(int64_t encode_id, uint8_t* out, size_t max_len);
```

## 关键设计决策

### 为什么每个 chunk 用独立 encode_id？

`cimbar` 的 fountain code 设计为**单个 encode_id 编码一个文件**。同一个 encode_id 内的所有帧组成一个完整的 fountain stream，接收端用 wirehair 解出原数据。

我们需要传多个独立的"文件"（manifest + N 个数据块），每个都需要 CFC 当作独立 stream 来解码。`encode_id` 是 fountain metadata 的一个字段，CFC 的 `fountain_decoder_sink` 用 `unordered_map<stream_slot, fountain_decoder_stream>` 按 encode_id 分桶。

只要发送端给每个 chunk 用不同 encode_id（且接收端 metadata 字段足以表达），CFC 就会自动认为是 N+1 个独立 stream，并发解码各自完成。

### 为什么 encode_id_base 用时间戳低 16 位？

不同会话间需要避免 encode_id 碰撞——CFC 已经认为某 encode_id "完成"了，不会再重新解码同 ID 的 stream。如果新会话用了已用过的 encode_id，CFC 会忽略。

时间戳秒数低 16 位每 18 小时循环一次，足够应付实际使用频率；每会话起 N+1 个连续 ID，N 通常 < 100，碰撞概率极低。

### 为什么文件名走 ZSTD header 而不是单独传？

libcimbar 的 ZSTD 压缩 header 自带文件名字段（由 `_cimbare_init_encode` 写入）。CFC 解压时直接用这个字段作为保存文件名，**完全无需我们额外传**。这让 CFC 在没有任何应用层协议改动的情况下就能用对的文件名落盘。

我们利用这个机制：每 chunk 用合成名（`<basename>.partNN.bin`），让 CFC 直接把块按这个名字保存。拼接端按文件名匹配 manifest 里的 chunks[].index 即可。

### 为什么估算帧数而不是用 fountain "完成"事件？

libcimbar v0.6.4 的 wasm encoder 没有暴露"当前 fountain stream 已编码完一轮"的回调。`_cimbare_next_frame` 返回累计帧数，但没有"循环重启"信号。

可能的方案：
1. **估算**（当前 MVP 选择）：按 `bytes / 7500 * redundancy_factor` 估算需要的帧数
2. **调内部 API**：libcimbar 内部有 `_fes->blocks_required() * 8` 这种计算，但未暴露给 wasm export
3. **外部信号**：依赖接收端反馈（CFC 不支持反向通道）

估算方案的好处是简单可调（用户能改 `redundancy` 输入框），坏处是可能浪费时间（多发了不需要的帧）或不够（接收端没解出来就被切走，下一轮再补）。fountain 码的好处是**即使切走也能在下次循环补齐**，所以容错性好。

### 为什么发送端循环不停？

fountain code 的特性是"持续编码越多冗余越好"。我们的 wrapper 把所有 chunk 各发一遍后**回到第 0 个数据块继续循环**（manifest 已发完不需要再发）。CFC 在所有 stream 都完成前会持续利用新帧补齐丢失的部分。用户看到全部块都被 CFC 接收并保存后再手动停止发送即可。

## 文件依赖

```
cimbar-bigfile/
├── send.html
│   └── vendor/cimbar-wasm-v0.6.4/cimbar_js.2026-01-20T0312.js
│       └── vendor/cimbar-wasm-v0.6.4/cimbar_js.2026-01-20T0312.wasm
├── reassemble.html (零依赖，纯 JS)
└── docs/
    ├── manifest-spec.md (协议规范)
    └── architecture.md (本文件)
```

`reassemble.html` **不依赖** wasm，完全纯 JS。这意味着即使将来 libcimbar 大改 API，只要 manifest 协议不变，已有备份的拼接端永远能用。
