import type { SessionClient } from "../auth/client";
import sharp from "sharp";
import { getLogger } from "../logger";

const logger = getLogger({ name: "upload-image-blob" });

export async function uploadImageBlob(
  image: string | undefined,
  agent: SessionClient,
) {
  try {
    if (image) {
      logger.trace({ image }, "trying to fetch image");
      const data = await fetch(image as string).then((res) =>
        res.arrayBuffer(),
      );
      logger.trace("downloaded image");

      const resizedImage = await sharp(Buffer.from(data))
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg()
        .toBuffer();
      logger.trace("resized image");

      const uploadResponse = await agent.post("com.atproto.repo.uploadBlob", {
        input: new Blob([new Uint8Array(resizedImage)], { type: "image/jpeg" }),
      });
      logger.trace({ success: uploadResponse.ok }, "reupload image");
      if (uploadResponse.ok) {
        return (
          uploadResponse.data as {
            blob?: { ref: { $link: string }; mimeType: string };
          }
        )?.blob;
      }
    }
  } catch (err) {
    logger.error({ err }, "failed to upload image blob");
  }
  return undefined;
}
