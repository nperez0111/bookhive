// KOReader document identifier (partial MD5).
//
// KOReader identifies a document via util.partialMD5 (frontend/util.lua). It
// hashes 1024-byte samples read at exponentially increasing offsets rather than
// the whole file. This means an uploaded book that is byte-identical to the copy
// on the device will produce the same hash, letting us line up reading progress.
//
// The Lua loop is:
//   step, size = 1024, 1024
//   for i = -1, 10 do
//     file:seek("set", lshift(step, 2*i))
//     sample = file:read(size)
//     if sample then update(sample) else break end
//   end
//
// LuaJIT's bit.lshift masks the shift count to the low 5 bits, so for i = -1 the
// shift is (2 * -1) & 0x1f = 30, and 1024 << 30 overflows a 32-bit int to 0.
// The resulting offsets are:
//   0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216,
//   67108864, 268435456, 1073741824
export function koreaderPartialMD5(bytes: Uint8Array): string {
  const step = 1024;
  const size = 1024;
  const hasher = new Bun.CryptoHasher("md5");
  for (let i = -1; i <= 10; i++) {
    const offset = (step << ((2 * i) & 0x1f)) >>> 0; // i === -1 -> 0
    if (offset >= bytes.length) break;
    hasher.update(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
  return hasher.digest("hex");
}

/**
 * The same hash, read straight off a file instead of a buffer.
 *
 * The algorithm only ever touches twelve 1 KB windows, so it never needed the
 * whole file resident — the buffer was incidental to how the upload path used
 * to work. Reading the slices costs at most 12 KB regardless of file size,
 * which is what lets an upload be hashed (and rejected as a duplicate) before
 * anything is materialised.
 *
 * Must stay byte-for-byte equivalent to `koreaderPartialMD5`: the resulting
 * hash is what lines an uploaded file up with the `document` id a KOReader
 * device sends. `bookMetadata.test.ts` pins the two together.
 */
export async function koreaderPartialMD5File(file: Blob, size: number): Promise<string> {
  const step = 1024;
  const window = 1024;
  const hasher = new Bun.CryptoHasher("md5");
  for (let i = -1; i <= 10; i++) {
    const offset = (step << ((2 * i) & 0x1f)) >>> 0; // i === -1 -> 0
    if (offset >= size) break;
    const end = Math.min(offset + window, size);
    hasher.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
  }
  return hasher.digest("hex");
}
