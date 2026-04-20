type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | Record<string, boolean | null | undefined>
  | ClassValue[];

export default function clsx(...args: ClassValue[]): string {
  const out: string[] = [];
  for (const a of args) {
    if (!a) continue;
    if (typeof a === "string" || typeof a === "number") {
      out.push(String(a));
    } else if (Array.isArray(a)) {
      const nested = clsx(...a);
      if (nested) out.push(nested);
    } else if (typeof a === "object") {
      for (const [k, v] of Object.entries(a)) if (v) out.push(k);
    }
  }
  return out.join(" ");
}
