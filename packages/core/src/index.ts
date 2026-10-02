import { z } from "zod";
import type { AutomationStep, Frame } from "../../contracts/src/index.js";
import { MAX_FRAME_BYTES } from "../../contracts/src/index.js";

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
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) throw new Error("Invalid JPEG marker");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length)
        throw new Error("Invalid JPEG segment");
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (length < 8) throw new Error("Invalid JPEG dimensions");
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
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
    value = JSON.parse(text);
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
