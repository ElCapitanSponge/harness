import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, type ImageAttachment, type ImageType } from "@harness/core/image";

// Checks a picture the person chose and turns it into what the gateway takes: its type and its bytes as base64. The limits are the
// gateway's own (same constants), so a file that passes here is not refused there.

const isImageType = (type: string): type is ImageType => {
  return (IMAGE_TYPES as readonly string[]).includes(type);
};

const base64 = (file: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => {
      reject(new Error("could not read the file"));
    };
    reader.readAsDataURL(file);
  });
};

export const readImages = async (files: File[], already: number): Promise<{ images: ImageAttachment[]; problems: string[] }> => {
  const images: ImageAttachment[] = [];
  const problems: string[] = [];
  for (const file of files) {
    if (!isImageType(file.type)) {
      problems.push(`${file.name || "That file"} is not a PNG, JPEG, GIF or WebP image.`);
    } else if (file.size > MAX_IMAGE_BYTES) {
      problems.push(`${file.name || "That image"} is larger than ${String(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`);
    } else if (already + images.length >= MAX_IMAGES) {
      problems.push(`A message can carry up to ${String(MAX_IMAGES)} images.`);
    } else {
      images.push({ mediaType: file.type, data: await base64(file) });
    }
  }
  return { images, problems };
};
