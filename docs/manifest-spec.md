# cimbar-bigfile Manifest 协议规范

## 概述

cimbar-bigfile 把大文件切分为多个 fountain stream 通过 libcimbar 传输。第一个 stream 内容是 **manifest JSON**，用于声明本次传输的元数据；后续每个 stream 是一个数据块（chunk）。

接收端按 fountain `encode_id` 自动分桶解码（CFC 的 `fountain_decoder_sink` 原生支持），落盘后由 `reassemble.html` 读取 manifest，按 `chunks[].index` 顺序拼接还原原文件。

## Manifest JSON 结构（version 1）

```json
{
  "version": 1,
  "tool": "cimbar-bigfile",
  "filename": "bigfile.tar.gz",
  "total_size": 104857600,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "chunk_size": 10485760,
  "chunk_count": 10,
  "encode_id_base": 7000,
  "chunks": [
    {"index": 0, "size": 10485760, "sha256": "..."},
    {"index": 1, "size": 10485760, "sha256": "..."},
    {"index": 2, "size": 10485760, "sha256": "..."},
    {"index": 3, "size": 10485760, "sha256": "..."},
    {"index": 4, "size": 10485760, "sha256": "..."},
    {"index": 5, "size": 10485760, "sha256": "..."},
    {"index": 6, "size": 10485760, "sha256": "..."},
    {"index": 7, "size": 10485760, "sha256": "..."},
    {"index": 8, "size": 10485760, "sha256": "..."},
    {"index": 9, "size": 10485760, "sha256": "..."}
  ]
}
```

## 字段语义

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `version` | int | ✅ | 协议版本号。当前为 `1`。未来字段调整时 bump |
| `tool` | string | ✅ | 固定为 `"cimbar-bigfile"`，用于消歧（避免误识别其他 cimbar 衍生工具的 manifest） |
| `filename` | string | ✅ | 原文件名（含后缀），UTF-8 编码。可包含中文/空格/特殊字符 |
| `total_size` | int | ✅ | 原文件总字节数（未压缩） |
| `sha256` | string | ✅ | 原文件全文 SHA-256 校验和（小写 hex） |
| `chunk_size` | int | ✅ | 单块大小（字节）。最后一块可小于此值 |
| `chunk_count` | int | ✅ | 数据块总数（不含 manifest 自身） |
| `encode_id_base` | int | ✅ | 本次会话的 fountain encode_id 起点。`encode_id_base + 0` 是 manifest 自身，`encode_id_base + 1..N` 是数据块 0..N-1 |
| `chunks` | array | ✅ | 数据块元数据数组，长度 = `chunk_count` |
| `chunks[].index` | int | ✅ | 块序号（0 起），用于拼接顺序 |
| `chunks[].size` | int | ✅ | 该块字节数 |
| `chunks[].sha256` | string | ✅ | 该块 SHA-256（小写 hex） |

## fountain encode_id 与文件名约定

| encode_id | 内容 | ZSTD header 嵌入的文件名 |
|-----------|------|-------------------------|
| `encode_id_base + 0` | manifest JSON 文本（UTF-8） | `manifest.json` |
| `encode_id_base + 1` | 数据块 0 的二进制 | `<basename>.part00.bin` |
| `encode_id_base + 2` | 数据块 1 的二进制 | `<basename>.part01.bin` |
| `encode_id_base + N` | 数据块 N-1 的二进制 | `<basename>.part<NN>.bin` |

`<basename>` = 原文件名去除最后一个后缀（如 `myfile.tar.gz` → `myfile.tar`），使拼接端能轻松反向匹配 manifest。零填充宽度根据 `chunk_count` 自适应：< 100 块用 2 位（`part00`），< 1000 块用 3 位（`part000`），以此类推。

## encode_id_base 选取

发送端生成 `encode_id_base` 的建议算法：

```javascript
// 取当前时间戳的低 16 位 (0..65535)
const encode_id_base = Math.floor(Date.now() / 1000) & 0xFFFF;
```

**约束**：
- 每个会话内的 `encode_id_base + i` (i ∈ [0, chunk_count]) 不能与同时进行的另一会话碰撞
- libcimbar wasm 的 `_cimbare_init_encode` 第三参数接受 `int32`，但**实际 wirehair fountain decoder 每 ~128 个 transfer 后会循环复用 encode_id slot**（详见 [sz3/libcimbar#149](https://github.com/sz3/libcimbar/issues/149)）
- 单次会话 `chunk_count` 因此应保守约束在 **~120 块以内**（即 ~1.2 GB at 10MB/chunk 的实用上限）。超过此值后 CFC 端 wirehair 解码器会忽略循环后重复 encode_id 的数据

### chunk_size 选择参考（wirehair 硬限制推导）

libcimbar 作者在 [sz3/libcimbar#165 评论](https://github.com/sz3/libcimbar/pull/165#issuecomment-4421610294) 给出了 wirehair 内部限制的具体数学：

- **wirehair 的 `block_id` 是 `uint16_t`**，即单 stream 最多 65536 个有效 block
- **Mode B (默认) block size = 7500 / 12 = 625 bytes**，扣除 fountain header 后实际承载 **619 bytes** → 单 stream 有效字节数上限 ≈ 65536 × 619 ≈ **~40.5 MB**（见 sz3 在 [#165 评论](https://github.com/sz3/libcimbar/pull/165#issuecomment-4439953749) 的修正）
- **33 MB 文件理论最大冗余仅 ~1.23x**（40.5 / 33 ≈ 1.23，hard cap）—— counter rollover 不会 break，但实际 redundancy 受限，不利于光线/对焦不佳场景
- **Mode Bu block size 更小** → cap 也相应更低，**不应用于 ≥30 MB 文件**

**实践推荐**：

| chunk_size | 最大可用冗余 | 适用场景 |
|------------|--------------|---------|
| 5 MB | ~8.1x | 极端环境（差光线/手抖），冗余余量充足 |
| 10 MB（默认） | ~4.0x | **推荐 sweet spot**，留出 3x+ 冗余 headroom |
| 15 MB | ~2.7x | 大文件时减少块数，冗余仍宽松 |
| 33 MB | ~1.23x | hard cap，不推荐（冗余太低易卡） |

**碰撞处理**：CFC 一旦有同 encode_id 的两个不同文件先后出现，行为未定义（可能合并、可能丢失）。开始新传输前请等待前一传输全部完成或重启 CFC。

## 版本演进规则

新版本字段变更时：

1. **加字段（兼容）**：直接新增可选字段，老版本拼接端忽略。`version` 不变
2. **改字段语义（不兼容）**：`version` bump，旧 manifest 格式继续被旧版拼接端识别
3. **删字段（不兼容）**：`version` bump

拼接端必须先读 `version` 字段决定如何解析。当前 v1 拼接端遇到 `version > 1` 应提示用户升级工具。

## 序列化注意事项

- JSON 输出**不缩进**（节省传输大小，每字节都要点击多次保存对话框）
- 字符串字段 UTF-8 编码
- `total_size`、`chunk_size` 用 JSON 数字（注意 JS Number 精度上限 `2^53`，约 9 PB，足够）
- SHA-256 用小写 hex（与 Linux `sha256sum` 输出对齐）

## manifest 体积估算

10 块场景下，manifest JSON ≈ 800 字节（每个 chunk 约 80 字节 × 10 + 头部 100 字节）。1000 块 ≈ 80 KB。manifest 自身的 fountain 帧数与块数线性增长但仍很小。
