import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import {
  createTrayIcon,
  renderIconPixels,
  renderIconPng,
  TRAY_ICON_SIZES,
} from "../apps/desktop/main/tray-icon";

function decodePng(png: Buffer) {
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  let size = 0;
  const payload: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      size = data.readUInt32BE(0);
      assert.equal(data.readUInt32BE(4), size);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    }
    if (type === "IDAT") payload.push(data);
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(payload));
  const pixels = Buffer.alloc(size * size * 4);
  assert.equal(rows.length, size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    assert.equal(rows[y * (size * 4 + 1)], 0);
    rows.copy(
      pixels,
      y * size * 4,
      y * (size * 4 + 1) + 1,
      (y + 1) * (size * 4 + 1),
    );
  }
  return { size, pixels };
}

test("tray mark keeps transparent corners and a blue/white eye at every display scale", () => {
  for (const size of TRAY_ICON_SIZES) {
    const pixels = renderIconPixels(size);
    for (const pixel of [0, size - 1, size * (size - 1), size * size - 1])
      assert.equal(pixels[pixel * 4 + 3], 0);
    let blue = 0;
    let white = 0;
    let transparent = 0;
    let antialiased = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3];
      if (!alpha) transparent++;
      if (alpha > 0 && alpha < 255) antialiased++;
      if (
        alpha >= 128 &&
        pixels[offset] === 28 &&
        pixels[offset + 1] === 111 &&
        pixels[offset + 2] === 232
      )
        blue++;
      if (
        alpha >= 128 &&
        pixels[offset] === 255 &&
        pixels[offset + 1] === 255 &&
        pixels[offset + 2] === 255
      )
        white++;
    }
    assert.ok(
      blue > size * size * 0.15,
      `Missing blue silhouette at ${size} px`,
    );
    assert.ok(white > size * size * 0.04, `Missing white eye at ${size} px`);
    assert.ok(
      transparent > size * size * 0.3,
      `Solid background at ${size} px`,
    );
    assert.ok(antialiased > 0);
    const center = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
    assert.deepEqual(
      [...pixels.subarray(center, center + 4)],
      [28, 111, 232, 255],
    );
  }
});

test("all tray representations are decodable PNGs with matching RGBA pixels", () => {
  const representations: { scaleFactor?: number; buffer?: Buffer }[] = [];
  let base: Buffer | undefined;
  const result = {
    isEmpty: () => false,
    addRepresentation: (representation: {
      scaleFactor?: number;
      buffer?: Buffer;
    }) => {
      representations.push(representation);
    },
  };
  assert.equal(
    createTrayIcon({
      createFromBuffer: (buffer) => {
        base = buffer;
        return result;
      },
    }),
    result,
  );
  assert.ok(base);
  const initial = decodePng(base);
  assert.equal(initial.size, 16);
  assert.deepEqual(initial.pixels, renderIconPixels(16));
  assert.equal(representations.length, TRAY_ICON_SIZES.length - 1);
  for (const [index, representation] of representations.entries()) {
    const size = TRAY_ICON_SIZES[index + 1];
    assert.equal(representation.scaleFactor, size / 16);
    assert.ok(representation.buffer);
    const decoded = decodePng(representation.buffer);
    assert.equal(decoded.size, size);
    assert.deepEqual(decoded.pixels, renderIconPixels(size));
  }
});

test("icon errors do not silently substitute an unrecognizable solid square", () => {
  assert.throws(() => renderIconPixels(0), RangeError);
  assert.throws(() => renderIconPng(16.5), RangeError);
  assert.throws(() => renderIconPng(257), RangeError);
  assert.throws(
    () =>
      createTrayIcon({
        createFromBuffer: () => ({
          isEmpty: () => true,
          addRepresentation: () => {},
        }),
      }),
    /could not be decoded/,
  );
});
