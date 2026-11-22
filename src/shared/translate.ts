/**
 * Finding the 繁體 / English for a message made in Simplified Chinese, numbers and names included:
 * "用户名最多 20 个字" matches the key "用户名最多 {n} 个字". The pages use it for what they show
 * (src/web/lang.ts) and the Worker for the errors it answers with (src/worker/errorText.ts).
 */
export type Catalog = Record<string, { tw: string; en: string }>;
export type Pattern = { re: RegExp; names: string[]; key: string };

/** The keys with placeholders, as patterns; only those with enough words of their own. */
export function compilePatterns(catalog: Catalog): Pattern[] {
  // "{a} 或 {b}" would match any message with 或 in it.
  return Object.keys(catalog)
    .filter((k) => k.includes("{") && k.replace(/\{\w+\}/g, "").trim().length >= 4)
    .map((key) => {
      const names: string[] = [];
      const src = key
        .split(/(\{\w+\})/)
        .map((part) => {
          const k = /^\{(\w+)\}$/.exec(part)?.[1];
          if (k) {
            names.push(k);
            return "(.+?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      return { re: new RegExp(`^${src}$`), names, key };
    });
}

/** The key a message was made from, and what filled its placeholders; null for a message we don't know. */
export function matchMessage(
  catalog: Catalog,
  patterns: Pattern[],
  message: string,
): { key: string; vars?: Record<string, string> } | null {
  if (catalog[message]) return { key: message };
  for (const p of patterns) {
    const m = p.re.exec(message);
    if (m) return { key: p.key, vars: Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]!])) };
  }
  return null;
}

/** Fills {name} placeholders. */
export const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/**
 * Marks an error text made away from badRequest() / HttpError (a shared form check, a message picked
 * beforehand), so test/errorText.test.ts finds it and makes sure it has its 繁體 and English.
 */
export const ek = (zh: string) => zh;
