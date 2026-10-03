import { z } from "zod";
import type { AutomationStep, Frame } from "../../contracts/src/index.js";
import { MAX_FRAME_BYTES } from "../../contracts/src/index.js";
import { parseUnambiguousJson } from "./json.js";

/** Validate encoded type and dimensions before retaining or serializing an image. */
export function validateImage(frame: Frame): void {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    frame.dataUrl,
  );
  if (!match || match[2].length % 4 !== 0)
    throw new Error("Invalid image encoding");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_FRAME_BYTES || bytes.toString("base64") !== match[2])
    throw new Error("Image exceeds limit or has invalid base64");
  let width = 0,
    height = 0;
  if (match[1] === "png") {
    if (
      bytes.length < 33 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    )
      throw new Error("Invalid PNG header");
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
    const depth = bytes[24],
      color = bytes[25];
    const depths: Record<number, number[]> = {
      0: [1, 2, 4, 8, 16],
      2: [8, 16],
      3: [1, 2, 4, 8],
      4: [8, 16],
      6: [8, 16],
    };
    if (
      !depths[color]?.includes(depth) ||
      bytes[26] !== 0 ||
      bytes[27] !== 0 ||
      bytes[28] > 1
    )
      throw new Error("Invalid PNG image header");
    let offset = 8,
      data = false,
      ended = false,
      palette = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12)
        throw new Error("Invalid PNG chunk length");
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (
        !/^[A-Za-z]{4}$/.test(type) ||
        (offset === 8 && (type !== "IHDR" || length !== 13)) ||
        (offset !== 8 && type === "IHDR")
      )
        throw new Error("Invalid PNG chunk structure");
      if (type === "PLTE") {
        if (data || length === 0 || length > 768 || length % 3 !== 0)
          throw new Error("Invalid PNG palette");
        palette = true;
      }
      if (type === "IDAT" && length > 0) data = true;
      if (type === "IEND") {
        if (length !== 0 || !data || (color === 3 && !palette))
          throw new Error("Invalid PNG end structure");
        ended = true;
        break;
      }
      offset += length + 12;
    }
    if (!ended) throw new Error("Invalid PNG image structure");
  } else {
    if (
      bytes.length < 4 ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[bytes.length - 2] !== 255 ||
      bytes[bytes.length - 1] !== 217
    )
      throw new Error("Invalid JPEG header");
    let offset = 2;
    let components: number[] = [],
      scanned = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) throw new Error("Invalid JPEG marker");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length)
        throw new Error("Invalid JPEG segment");
      if (marker === 218) {
        const count = bytes[offset + 2];
        if (
          !components.length ||
          count < 1 ||
          count > components.length ||
          length !== 6 + 2 * count ||
          offset + length >= bytes.length - 2
        )
          throw new Error("Invalid JPEG scan structure");
        const selected = Array.from(
          { length: count },
          (_, index) => bytes[offset + 3 + 2 * index],
        );
        if (
          new Set(selected).size !== count ||
          selected.some((id) => !components.includes(id))
        )
          throw new Error("Invalid JPEG scan components");
        offset += length;
        let entropyBytes = 0;
        // Locate subsequent markers without interpreting entropy-coded pixels.
        // Stuffed FF bytes and restart markers are not additional frame headers.
        while (offset < bytes.length - 2) {
          if (bytes[offset] !== 255) {
            entropyBytes++;
            offset++;
          } else if (bytes[offset + 1] === 0) {
            entropyBytes++;
            offset += 2;
          } else if (bytes[offset + 1] >= 208 && bytes[offset + 1] <= 215) {
            offset += 2;
          } else if (bytes[offset + 1] === 255) {
            offset++;
          } else break;
        }
        if (!entropyBytes) throw new Error("Invalid JPEG empty scan");
        scanned = true;
        continue;
      }
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (components.length)
          throw new Error("Invalid JPEG multiple frame headers");
        const count = bytes[offset + 7];
        if (length < 8 || count < 1 || count > 4 || length !== 8 + 3 * count)
          throw new Error("Invalid JPEG components");
        if (
          (marker === 192 && bytes[offset + 2] !== 8) ||
          bytes[offset + 2] < 2 ||
          bytes[offset + 2] > 16
        )
          throw new Error("Invalid JPEG precision");
        components = Array.from(
          { length: count },
          (_, index) => bytes[offset + 8 + 3 * index],
        );
        if (new Set(components).size !== count)
          throw new Error("Invalid JPEG components");
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        if (
          width < 1 ||
          height < 1 ||
          width > 1024 ||
          height > 1024 ||
          width !== frame.width ||
          height !== frame.height
        )
          throw new Error("Invalid JPEG dimensions for bounded frame");
      }
      offset += length;
    }
    if (!scanned) throw new Error("Invalid JPEG image structure");
  }
  if (
    width !== frame.width ||
    height !== frame.height ||
    width < 1 ||
    height < 1 ||
    width > 1024 ||
    height > 1024
  )
    throw new Error("Image dimensions do not match bounded frame");
}

const description = z.string().trim().min(1).max(300);
const stepSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("click"),
      x: z.number().finite().min(0).max(1),
      y: z.number().finite().min(0).max(1),
      description,
    })
    .strict(),
  z
    .object({
      type: z.literal("type"),
      text: z
        .string()
        .min(1)
        .max(1000)
        .refine(
          (text) => !/[\u0000-\u001f\u007f-\u009f]/u.test(text),
          "Control characters are not allowed; use a separate key step",
        ),
      description,
    })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      key: z.enum([
        "ENTER",
        "TAB",
        "ESC",
        "BACKSPACE",
        "UP",
        "DOWN",
        "LEFT",
        "RIGHT",
        "CTRL+A",
        "CTRL+C",
        "CTRL+V",
        "CTRL+Z",
      ]),
      description,
    })
    .strict(),
]);
export function parsePlan(text: string): AutomationStep[] {
  if (text.length > 16_384)
    throw new Error("Automation plan exceeds output limit");
  // Fences and prose are deliberately rejected: the proposal is an exact, reviewable JSON object.
  let value: unknown;
  try {
    value = parseUnambiguousJson(text);
  } catch {
    throw new Error("Model must return a JSON plan");
  }
  return z
    .object({ steps: z.array(stepSchema).min(1).max(8) })
    .strict()
    .parse(value).steps;
}

export interface MotionState {
  qualifying: number;
  clearing: number;
  active: boolean;
  cooldownUntil: number;
  lastCapturedAt: number;
}
export const initialMotion = (): MotionState => ({
  qualifying: 0,
  clearing: 0,
  active: false,
  cooldownUntil: 0,
  lastCapturedAt: 0,
});
export function updateMotion(
  state: MotionState,
  value: number,
  capturedAt: number,
  monotonic: number,
): boolean {
  if (capturedAt <= state.lastCapturedAt) return false;
  if (capturedAt - state.lastCapturedAt > 1000) {
    state.qualifying = 0;
    state.clearing = 0;
  }
  state.lastCapturedAt = capturedAt;
  if (value <= 0.05) {
    state.clearing++;
    state.qualifying = 0;
  } else if (value >= 0.1) {
    state.qualifying++;
    state.clearing = 0;
  } else {
    state.clearing = 0;
    state.qualifying = 0;
  }
  if (state.active && state.clearing >= 2 && monotonic >= state.cooldownUntil)
    state.active = false;
  if (
    !state.active &&
    state.qualifying >= 2 &&
    monotonic >= state.cooldownUntil
  ) {
    state.active = true;
    state.cooldownUntil = monotonic + 30_000;
    state.qualifying = 0;
    return true;
  }
  return false;
}
