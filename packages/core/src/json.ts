/** JSON.parse validates syntax; this second pass rejects duplicate object keys. */
export function parseUnambiguousJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const stack: ({ keys: Set<string>; keyExpected: boolean } | null)[] = [];
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      const start = index;
      while (++index < text.length) {
        if (text[index] === "\\") index++;
        else if (text[index] === '"') break;
      }
      const object = stack.at(-1);
      if (object?.keyExpected) {
        const key = JSON.parse(text.slice(start, index + 1)) as string;
        if (object.keys.has(key)) throw new Error("Duplicate JSON object key");
        object.keys.add(key);
        object.keyExpected = false;
      }
    } else if (character === "{") {
      stack.push({ keys: new Set(), keyExpected: true });
    } else if (character === "[") {
      stack.push(null);
    } else if (character === "}" || character === "]") {
      stack.pop();
    } else if (character === ",") {
      const object = stack.at(-1);
      if (object) object.keyExpected = true;
    }
  }
  return value;
}
