import type { SessionClient } from "../auth/client";
import type { BlobRef } from "../types";
import sharp from "sharp";

export type { BlobRef };

export async function uploadImageBlob(
  image: string | undefined | null,
  agent: SessionClient,
  maxWidth?: number,
): Promise<BlobRef | undefined> {
  if (!image) return undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const fetchResponse = await fetch(image, { signal: controller.signal });
    if (!fetchResponse.ok) return undefined;
    const contentType = fetchResponse.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return undefined;
    const data = await fetchResponse.arrayBuffer();

    const encoded = await sharp(Buffer.from(data))
      .resize(maxWidth ? { width: maxWidth, withoutEnlargement: true } : undefined)
      .jpeg()
      .toBuffer();

    const uploadResponse = await agent.post("com.atproto.repo.uploadBlob", {
      input: new Blob([new Uint8Array(encoded)], { type: "image/jpeg" }),
    });
    if (uploadResponse.ok) {
      return (uploadResponse.data as { blob?: BlobRef })?.blob;
    }
  } catch {
    // Caller can add wide-event context if needed
  } finally {
    clearTimeout(timeoutId);
  }
  return undefined;
}
