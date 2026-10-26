import { afterEach, expect, it, vi } from "vitest";
import { compressImage, ImageDecodeError, IMAGE_DECODE_MESSAGE } from "@/lib/image/compress";

class FakeCanvas {
  static last: FakeCanvas;
  constructor(public width: number, public height: number) {
    FakeCanvas.last = this;
  }
  getContext() {
    return { drawImage: () => {} };
  }
  convertToBlob() {
    return Promise.resolve(new Blob(["x"], { type: "image/jpeg" }));
  }
}

afterEach(() => vi.unstubAllGlobals());

it("scales the long edge down to 1600px", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  const out = await compressImage(new Blob(["raw"]));
  expect(out.type).toBe("image/jpeg");
  expect([FakeCanvas.last.width, FakeCanvas.last.height]).toEqual([1600, 1200]);
});

it("keeps small images at their size", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 800, height: 1200, close() {} }));
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  await compressImage(new Blob(["raw"]));
  expect([FakeCanvas.last.width, FakeCanvas.last.height]).toEqual([800, 1200]);
});

it("explains formats the browser cannot decode", async () => {
  vi.stubGlobal("createImageBitmap", async () => {
    throw new DOMException("bad", "InvalidStateError");
  });
  await expect(compressImage(new Blob(["heic"]))).rejects.toBeInstanceOf(ImageDecodeError);
  expect(IMAGE_DECODE_MESSAGE).toContain("HEIC");
});
