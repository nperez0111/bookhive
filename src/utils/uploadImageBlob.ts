import { Agent } from "@atproto/api";
import type { BlobRef } from "@atproto/lexicon";
import sharp from "sharp";

export async function uploadImageBlob(image: string | undefined, agent: Agent) {
  let imageBlobRef: BlobRef | undefined = undefined;
  if (image) {
    const data = await fetch(image as string).then((res) => res.arrayBuffer());

    const resizedImage = await sharp(data)
      .resize({ width: 800, withoutEnlargement: true })
      .jpeg()
      .toBuffer();
    const uploadResponse = await agent.com.atproto.repo.uploadBlob(
      resizedImage,
      {
        encoding: "image/jpeg",
      },
    );
    if (uploadResponse.success) {
      imageBlobRef = uploadResponse.data.blob;
    }
  }
  return imageBlobRef;
}
