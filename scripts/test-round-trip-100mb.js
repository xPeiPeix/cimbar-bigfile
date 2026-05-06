'use strict';
// Application-layer round-trip test for the chunked transfer protocol.
// Generates a 100MB random file, applies send.html slicing + manifest logic,
// then runs reassemble.html parsing + concat + SHA256 verification logic.
// Does NOT exercise wasm encoder/decoder or the physical optical link.
// Run: node scripts/test-round-trip-100mb.js

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE_SIZE = 100 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;
const FILENAME = 'roundtrip-100mb-test.bin';

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const stripExt = (filename) => {
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.substring(0, lastDot) : filename;
};
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cimbar-rt-'));
const t0 = Date.now();

try {
  log(`Generating ${FILE_SIZE / 1024 / 1024} MB random source file...`);
  const t1 = Date.now();
  const fileBytes = crypto.randomBytes(FILE_SIZE);
  log(`  generated in ${Date.now() - t1} ms`);

  log('Computing full-file SHA256...');
  const t2 = Date.now();
  const fullSha = sha256Hex(fileBytes);
  log(`  ${fullSha} (${Date.now() - t2} ms)`);

  // Send-side: slice + per-chunk SHA256 + manifest (mirrors send.html:406-452, 615-619)
  log('Slicing + per-chunk SHA256 + manifest construction...');
  const t3 = Date.now();
  const chunkCount = Math.ceil(FILE_SIZE / CHUNK_SIZE);
  const padW = chunkCount < 100 ? 2 : chunkCount < 1000 ? 3 : 4;
  const basename = stripExt(FILENAME);
  const chunkMeta = [];
  const chunks = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, FILE_SIZE);
    const slice = fileBytes.subarray(start, end);
    chunks.push(slice);
    chunkMeta.push({ index: i, size: slice.length, sha256: sha256Hex(slice) });
  }
  const manifest = {
    version: 1,
    tool: 'cimbar-bigfile',
    filename: FILENAME,
    total_size: FILE_SIZE,
    sha256: fullSha,
    chunk_size: CHUNK_SIZE,
    chunk_count: chunkCount,
    encode_id_base: 0,
    chunks: chunkMeta,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  log(`  ${chunkCount} chunks, manifest ${manifestBytes.length} B (no indent), ${Date.now() - t3} ms`);

  log(`Writing manifest + chunks to ${tmpDir}...`);
  const t4 = Date.now();
  fs.writeFileSync(path.join(tmpDir, 'manifest.json'), manifestBytes);
  for (let i = 0; i < chunks.length; i++) {
    const partName = `${basename}.part${String(i).padStart(padW, '0')}.bin`;
    fs.writeFileSync(path.join(tmpDir, partName), chunks[i]);
  }
  log(`  ${Date.now() - t4} ms`);

  // Reassemble-side: parse + classify + verify (mirrors reassemble.html:212-380)
  log('Reassemble: parse + validate manifest...');
  const m2 = JSON.parse(fs.readFileSync(path.join(tmpDir, 'manifest.json'), 'utf8'));
  if (m2.tool !== 'cimbar-bigfile') throw new Error(`tool="${m2.tool}", expected "cimbar-bigfile"`);
  if (m2.version !== 1) throw new Error(`version=${m2.version}, expected 1`);
  if (m2.chunks.length !== m2.chunk_count) {
    throw new Error(`chunks.length=${m2.chunks.length} != chunk_count=${m2.chunk_count}`);
  }

  log('Reassemble: classify part files by regex /\\.part(\\d+)\\.bin$/i...');
  const partFiles = new Map();
  for (const fname of fs.readdirSync(tmpDir)) {
    if (fname === 'manifest.json') continue;
    const mm = fname.match(/\.part(\d+)\.bin$/i);
    if (!mm) throw new Error(`Unexpected file: ${fname}`);
    partFiles.set(parseInt(mm[1], 10), path.join(tmpDir, fname));
  }
  for (let i = 0; i < m2.chunk_count; i++) {
    if (!partFiles.has(i)) throw new Error(`Missing chunk index ${i}`);
  }

  log('Reassemble: verify each chunk size + SHA256...');
  const t5 = Date.now();
  const buffers = [];
  for (let i = 0; i < m2.chunk_count; i++) {
    const expected = m2.chunks[i];
    const data = fs.readFileSync(partFiles.get(i));
    if (data.length !== expected.size) {
      throw new Error(`Chunk ${i} size mismatch: got ${data.length}, manifest ${expected.size}`);
    }
    const sha = sha256Hex(data);
    if (sha !== expected.sha256) {
      throw new Error(`Chunk ${i} SHA256 mismatch: got ${sha}, manifest ${expected.sha256}`);
    }
    buffers.push(data);
  }
  log(`  ${m2.chunk_count} chunks verified in ${Date.now() - t5} ms`);

  log('Reassemble: concatenate + full-file SHA256...');
  const t6 = Date.now();
  const out = Buffer.concat(buffers);
  if (out.length !== m2.total_size) {
    throw new Error(`Reassembled size mismatch: ${out.length} vs ${m2.total_size}`);
  }
  const finalSha = sha256Hex(out);
  if (finalSha !== m2.sha256) {
    throw new Error(`Reassembled SHA256 mismatch: got ${finalSha}, manifest ${m2.sha256}`);
  }
  log(`  ${out.length} B, ${finalSha} === manifest.sha256 (${Date.now() - t6} ms)`);

  log(`PASS: 100MB application-layer round-trip in ${Date.now() - t0} ms`);
  process.exit(0);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
