# Vendored libcimbar Assets

These assets are vendored from libcimbar v0.6.4 official GitHub Release. **Original copyright belongs to sz3 and project contributors; this redistribution complies with the upstream license terms (see License section below).**

## Source

- Release: https://github.com/sz3/libcimbar/releases/tag/v0.6.4
- Build timestamp tag: `2026-01-20T0312` (embedded in filenames)
- Source code: https://github.com/sz3/libcimbar/tree/v0.6.4

## License (IMPORTANT)

**libcimbar is licensed under Mozilla Public License Version 2.0 (MPL-2.0)**, NOT MIT. This is a copyleft license.

- Full license text: [`LICENSE-libcimbar`](./LICENSE-libcimbar)
- Source code obligation: Per MPL-2.0 §3.2, when distributing the wasm binary (`Executable Form`), recipients must be able to obtain the corresponding `Source Code Form`. We comply by pointing to the upstream GitHub release: https://github.com/sz3/libcimbar/tree/v0.6.4
- Modifications: We have NOT modified any libcimbar source code. The vendored wasm/js are bit-identical reproductions of the v0.6.4 release artifacts.
- Notice preservation: Per MPL-2.0 §3.4, no copyright/license notices have been removed from the vendored files.

The compiled wasm binary additionally embeds **wirehair** (a fountain code library):

- Author: Christopher A. Taylor (https://github.com/catid/wirehair)
- License: BSD 3-Clause License — see [`LICENSE-wirehair`](./LICENSE-wirehair)

## Files

| Filename | Purpose | Size |
|----------|---------|------|
| `cimbar_js.html` | Self-contained release (wasm/js inlined as base64). Double-click to run encoder standalone. | 1.3 MB |
| `cimbar.wasm.tar.gz` | Original release tarball, kept for reference | 630 KB |
| `cimbar-wasm-v0.6.4/` | Extracted modular version (faster dev, used by our wrappers) | - |
| └── `index.html` | Encoder UI page | 13 KB |
| └── `recv.html` | Decoder UI page | 11 KB |
| └── `cimbar_js.2026-01-20T0312.wasm` | Compiled wasm binary | 1.9 MB |
| └── `cimbar_js.2026-01-20T0312.js` | Emscripten wasm glue | 85 KB |
| └── `main.2026-01-20T0312.js` | Encoder application logic | 13 KB |
| └── `recv.2026-01-20T0312.js` | Decoder application logic | 14 KB |
| └── `recv-worker.2026-01-20T0312.js` | Decoder web worker | 4 KB |
| └── `zstd.2026-01-20T0312.js` | ZSTD decompression library | 3 KB |
| └── `sw.js`, `recv-sw.js` | Service workers (PWA offline support) | <2 KB ea |
| └── `pwa*.json` | PWA manifests | <1 KB ea |

## WASM API used by encoder (v0.6.4)

Based on inspection of `main.2026-01-20T0312.js`:

| Export | Purpose |
|--------|---------|
| `_cimbare_configure(modeVal, frameRate)` | Set mode. modeVal: `4`=4C, `66`=Bu, `67`=Bm, `68`=B (default) |
| `_cimbare_get_aspect_ratio()` | Returns ideal w/h ratio |
| `_cimbare_rotate_window(needRotate)` | Internal window orientation flip |
| `_cimbare_encode_bufsize()` | Returns expected per-call streaming chunk size |
| `_cimbare_init_encode(fnPtr, fnLen, fountain_id)` | **Start a new fountain stream**. fountain_id = -1 auto-increments; pass explicit value to control encode_id (key for our chunked wrapper). |
| `_cimbare_encode(dataPtr, dataLen)` | Stream data bytes. Call with len=0 to flush. |
| `_cimbare_render()` | Render current frame to canvas |
| `_cimbare_next_frame(colorBalance)` | Advance frame, returns frame count |

**Important**: Filename passed to `_cimbare_init_encode` is embedded into the ZSTD header. When CFC decodes, it uses this name as the saved filename. Our chunked wrapper exploits this: each application-level chunk is initialized with a synthetic filename like `<basename>.part00.bin`.

## WASM API used by decoder (v0.6.4)

Based on inspection of `recv.2026-01-20T0312.js`:

| Export | Purpose |
|--------|---------|
| `_cimbard_get_bufsize()` | Max fountain buffer size for streaming decoded bytes |
| `_cimbard_configure_decode(mode)` | Set decode mode (0=Auto, 4=4C, 66=Bu, 67=Bm, 68=B) |
| `_cimbard_fountain_decode(bufPtr, bufLen)` | Feed decoded fountain frame bytes; returns id (>0 = file complete, the id is fountain encode_id) |
| `_cimbard_get_report()` | Returns JSON array of per-stream completion percentages (multiple concurrent fountain streams supported) |
| `_cimbard_get_filesize(id)` | Returns size of completed file (id = fountain encode_id) |
| `_cimbard_get_filename(id, bufPtr, maxLen)` | Writes ZSTD-header-embedded filename UTF-8 bytes to buffer; returns length |

## Updating to newer libcimbar release

```bash
# Remove old vendored files
rm -rf cimbar-wasm-v*/ cimbar_js.html cimbar.wasm.tar.gz

# Download (replace v0.6.4 with new version)
gh release download vX.Y.Z --repo sz3/libcimbar \
  --pattern 'cimbar_js.html' \
  --pattern 'cimbar.wasm.tar.gz' \
  --dir .

# Extract and rename
tar -xzf cimbar.wasm.tar.gz
mv <timestamped-dir>/ cimbar-wasm-vX.Y.Z/

# Update this README's API table if exports changed (inspect new main.js)
# Update send.html / reassemble.html if API surface changed
```
