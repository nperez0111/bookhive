// KOReader document identifier (partial MD5).
//
// Ports util.partialMD5 (frontend/util.lua): it hashes 1024-byte samples at
// exponentially increasing offsets rather than the whole file, so a
// byte-identical upload produces the same hash as the device's copy.
//
// LuaJIT's bit.lshift masks the shift count to the low 5 bits, so for i = -1
// the shift is (2 * -1) & 0x1f = 30, and 1024 << 30 overflows a 32-bit int to
// 0 — that's the `>>> 0` below, not a bug.
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
 * The same hash, read straight off a file instead of a buffer — at most 12 KB
 * regardless of file size, so an upload can be hashed before anything is
 * materialised.
 *
 * Must stay byte-for-byte equivalent to `koreaderPartialMD5`; `bookMetadata.test.ts`
 * pins the two together.
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
