import { deflateSync } from "node:zlib";
import type { NativeImage } from "electron";

/** Physical pixel sizes for the 16 px tray mark at common display scales. */
export const TRAY_ICON_SIZES = [16, 20, 24, 32, 48, 64] as const;
const BLUE = [28, 111, 232] as const;
const WHITE = [255, 255, 255] as const;

/** Rasterize the SVG's blue O and white eye with transparent, antialiased edges. */
export function renderIconPixels(size: number): Buffer {
  if (!Number.isInteger(size) || size < 16 || size > 256)
    throw new RangeError("Icon size must be an integer from 16 to 256.");
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) * 32) / size;
          const y = ((py + (sy + 0.5) / samples) * 32) / size;
          const distance = Math.hypot(x - 16, y - 16);
          let color: readonly number[] | undefined;
          if (distance >= 11.9 && distance <= 15.1) color = BLUE;
          const eyeX = (x - 16) / 8.5;
          if (Math.abs(eyeX) <= 1 && Math.abs(y - 16) <= 5 * (1 - eyeX * eyeX))
            color = WHITE;
          if (distance <= 3.4) color = BLUE;
          if (color) {
            covered++;
            red += color[0];
            green += color[1];
            blue += color[2];
          }
        }
      }
      if (covered) {
        const offset = (py * size + px) * 4;
        pixels[offset] = Math.round(red / covered);
        pixels[offset + 1] = Math.round(green / covered);
        pixels[offset + 2] = Math.round(blue / covered);
        pixels[offset + 3] = Math.round((covered * 255) / (samples * samples));
      }
    }
  }
  return pixels;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return chunk;
}

/** A portable RGBA PNG avoids platform-dependent SVG decoding and bitmap order. */
export function renderIconPng(size: number): Buffer {
  const pixels = renderIconPixels(size);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6; // Eight-bit RGBA, no palette.
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++)
    pixels.copy(rows, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

type IconImage = Pick<NativeImage, "addRepresentation" | "isEmpty">;

/** Pass Electron's nativeImage; the PNGs are bundled code, with no asset path. */
export function createTrayIcon<T extends IconImage>(images: {
  createFromBuffer(buffer: Buffer): T;
}): T {
  const icon = images.createFromBuffer(renderIconPng(TRAY_ICON_SIZES[0]));
  if (icon.isEmpty())
    throw new Error("OpenAware tray icon could not be decoded.");
  for (const size of TRAY_ICON_SIZES.slice(1))
    icon.addRepresentation({
      scaleFactor: size / 16,
      buffer: renderIconPng(size),
    });
  return icon;
}
