import type { SessionClient } from "../auth/client";
import type { BlobRef } from "../types";
import sharp from "sharp";

export type { BlobRef };

export async function uploadImageBlob(
  image: string | undefined | null,
  agent: SessionClient,
  maxWidth?: number,
): Promise<BlobRef | undefined> {
  try {
    if (image) {
      const data = await fetch(image).then((res) => res.arrayBuffer());

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
    }
  } catch {
    // Caller can add wide-event context if needed
  }
  return undefined;
}
