import type { SessionClient } from "../auth/client";
import sharp from "sharp";

export async function uploadImageBlob(
  image: string | undefined,
  agent: SessionClient,
) {
  try {
    if (image) {
      const data = await fetch(image as string).then((res) =>
        res.arrayBuffer(),
      );

      const resizedImage = await sharp(Buffer.from(data))
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg()
        .toBuffer();

      const uploadResponse = await agent.post("com.atproto.repo.uploadBlob", {
        input: new Blob([new Uint8Array(resizedImage)], { type: "image/jpeg" }),
      });
      if (uploadResponse.ok) {
        return (
          uploadResponse.data as {
            blob?: { ref: { $link: string }; mimeType: string };
          }
        )?.blob;
      }
    }
  } catch {
    // Caller can add wide-event context if needed
  }
  return undefined;
}
