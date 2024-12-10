import { Agent } from "@atproto/api";
import sharp from "sharp";
import { getLogger } from "../logger";

const logger = getLogger({ name: "upload-image-blob" });

export async function uploadImageBlob(image: string | undefined, agent: Agent) {
  try {
    if (image) {
      logger.trace("trying to fetch image", { image });
      const data = await fetch(image as string).then((res) =>
        res.arrayBuffer(),
      );
      logger.trace("downloaded image");

      const resizedImage = await sharp(data)
        .resize({ width: 800, withoutEnlargement: true })
        .jpeg()
        .toBuffer();
      logger.trace("resized image");

      const uploadResponse = await agent.com.atproto.repo.uploadBlob(
        resizedImage,
        {
          encoding: "image/jpeg",
        },
      );
      logger.trace("reupload image", { success: uploadResponse.success });
      if (uploadResponse.success) {
        return uploadResponse.data.blob;
      }
    }
  } catch (err) {
    logger.error("failed to upload image blob", { err });
  }
  return undefined;
}
