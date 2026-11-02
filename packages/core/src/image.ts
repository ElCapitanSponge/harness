// Images attached to a message, for models that can read them. Kept free of anything but plain values so the page and the gateway
// share the same limits and the same idea of which models can see.

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageType = typeof IMAGE_TYPES[number];

// Per image, in bytes of the picture itself, and how many a message may carry.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;

export interface ImageAttachment {
  mediaType: ImageType;
  // The picture, base64 encoded.
  data: string;
}

// What an image counts for when the size of a conversation is estimated. The real cost depends on the model; this is a middling figure.
export const IMAGE_TOKENS = 1000;

// Local models do not say whether they can see, so this goes by the name: the usual vision families. Claude can see, but the
// `claude` program is driven with text only here, so it is not offered images.
const VISION = /(^|[^a-z])(llava|vl|vision|pixtral|minicpm-v|bakllava|moondream|internvl|molmo|gemma-?3|mllama|smolvlm|idefics|phi-?3\.5-vision|phi-?4-multimodal)([^a-z]|$)/i;

export const supportsImages = (model: string): boolean => {
  if (model === "claude" || model.startsWith("claude:")) {
    return false;
  }
  return VISION.test(model);
};

// Why an image was not sent, in words for the person.
export const noImagesReason = (model: string): string => {
  return model === "claude" || model.startsWith("claude:")
    ? "Claude is reached through the claude program with text only here, so the image was not sent. Pick a local vision model, or Auto."
    : `${model} does not look like a model that can read images, so the image was not sent. Pick a vision model, or Auto.`;
};
