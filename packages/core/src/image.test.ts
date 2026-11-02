import { describe, expect, it } from "vitest";
import { ImageAttachmentSchema, SessionMessage } from "./index.js";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, noImagesReason, supportsImages } from "./image.js";

describe("which models can read images", () => {
  it("recognises the usual vision families by name, and nothing else", () => {
    for (const id of ["llava-v1.6-34b", "qwen2.5-vl-7b-instruct", "google/gemma-3-12b", "llama-3.2-11b-vision-instruct", "pixtral-12b", "minicpm-v-2.6"]) {
      expect(supportsImages(id), id).toBe(true);
    }
    for (const id of ["qwen3-coder-30b", "google/gpt-oss-20b", "phi-4", "gemma-2-9b", "devstral", "evolve"]) {
      expect(supportsImages(id), id).toBe(false);
    }
  });

  it("does not offer images to Claude, which is driven with text only, and says why", () => {
    expect(supportsImages("claude")).toBe(false);
    expect(supportsImages("claude:sonnet")).toBe(false);
    expect(noImagesReason("claude:sonnet")).toContain("text only");
    expect(noImagesReason("qwen3-coder-30b")).toContain("qwen3-coder-30b does not look like a model that can read images");
  });
});

describe("what a message may carry", () => {
  const png = { mediaType: "image/png", data: "iVBORw0KGgo=" };

  it("takes up to the limit of images of the accepted types", () => {
    expect(IMAGE_TYPES).toContain("image/webp");
    expect(SessionMessage.safeParse({ text: "look", images: [png] }).success).toBe(true);
    expect(SessionMessage.safeParse({ text: "look", images: Array.from({ length: MAX_IMAGES }, () => {
      return png;
    }) }).success).toBe(true);
    expect(SessionMessage.safeParse({ text: "look", images: Array.from({ length: MAX_IMAGES + 1 }, () => {
      return png;
    }) }).success).toBe(false);
  });

  it("refuses another type, data that is not base64, and one that is too big", () => {
    expect(ImageAttachmentSchema.safeParse({ mediaType: "image/svg+xml", data: "AAAA" }).success).toBe(false);
    expect(ImageAttachmentSchema.safeParse({ mediaType: "image/png", data: "not base64!" }).success).toBe(false);
    expect(ImageAttachmentSchema.safeParse({ mediaType: "image/png", data: "A".repeat(Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100) }).success).toBe(false);
  });
});
