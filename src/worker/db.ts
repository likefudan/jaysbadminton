export const now = () => new Date().toISOString();

export async function getSettings(db: D1Database, keys: string[]): Promise<Record<string, string>> {
  const placeholders = keys.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

export function setSetting(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value);
}
