export const IMAGE_DECODE_MESSAGE = "这张图片的格式无法读取（例如 iPhone 的 HEIC），请截图后再上传";

export class ImageDecodeError extends Error {
  constructor() {
    super(IMAGE_DECODE_MESSAGE);
    this.name = "ImageDecodeError";
  }
}

/** Shrink a photo or screenshot to a JPEG whose long edge is at most maxEdge pixels. */
export async function compressImage(file: Blob, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageDecodeError();
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageDecodeError())), "image/jpeg", quality),
  );
}
