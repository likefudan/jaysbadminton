// Who may use the release site. Ke Li (OPS_EMAIL) is the owner: she always has every power, and she alone
// approves applications and gives or takes the 发布工程师 (release engineer) role. Anyone else signs in
// with Google, applies, and waits; once approved they can look (viewer), and release engineers can also
// release, roll back and restore. Kept in one Durable Object (OpsUsers, index.ts), so a change takes effect on the
// very next request: the login cookie only says who someone is, never what they may do.

export type Role = "owner" | "engineer" | "viewer";
export type Status = "pending" | "viewer" | "engineer" | "rejected";

export interface User {
  email: string;
  name: string;
  note: string;
  status: Status;
  appliedAt: string;
  decidedAt: string | null;
}

/** The few storage calls UserBook needs: Durable Object storage in production, a Map in tests. */
export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

/** At most this many accounts (applicants included), so strangers cannot fill the storage. */
export const MAX_USERS = 200;
/** At most this many waiting at once, so a flood of applications stays small and stops the notices. */
export const MAX_PENDING = 20;
export const MAX_NOTE = 200;
const MAX_NAME = 60;
const key = (email: string) => `u:${email}`;
const clean = (s: unknown, max: number) =>
  typeof s === "string"
    ? s
        .replace(/\p{Cc}/gu, " ")
        .trim()
        .slice(0, max)
    : "";

export type ApplyResult = { ok: true; user: User; isNew: boolean } | { ok: false; reason: "full" | "decided" };

export class UserBook {
  constructor(private store: Storage) {}

  async get(email: string): Promise<User | null> {
    return (await this.store.get<User>(key(email))) ?? null;
  }

  /** Everyone, waiting applications first, then by name. */
  async list(): Promise<User[]> {
    const all = [...(await this.store.list<User>({ prefix: "u:" })).values()];
    const rank: Record<Status, number> = { pending: 0, engineer: 1, viewer: 2, rejected: 3 };
    return all.sort((a, b) => rank[a.status] - rank[b.status] || a.email.localeCompare(b.email));
  }

  /** An application, or an update of a still-waiting one's note. A decided account cannot re-apply. */
  async apply(email: string, name: unknown, note: unknown, now = new Date()): Promise<ApplyResult> {
    const had = await this.get(email);
    if (had && had.status !== "pending") return { ok: false, reason: "decided" };
    if (!had) {
      const all = [...(await this.store.list<User>({ prefix: "u:" })).values()];
      if (all.length >= MAX_USERS || all.filter((u) => u.status === "pending").length >= MAX_PENDING)
        return { ok: false, reason: "full" };
    }
    const user: User = {
      email,
      name: clean(name, MAX_NAME) || had?.name || "",
      note: clean(note, MAX_NOTE),
      status: "pending",
      appliedAt: had?.appliedAt ?? now.toISOString(),
      decidedAt: null,
    };
    await this.store.put(key(email), user);
    return { ok: true, user, isNew: !had };
  }

  /** The owner's decision: approve as viewer or engineer, or reject / take away access. */
  async decide(email: string, status: Exclude<Status, "pending">, now = new Date()): Promise<User | null> {
    const had = await this.get(email);
    if (!had) return null;
    const user = { ...had, status, decidedAt: now.toISOString() };
    await this.store.put(key(email), user);
    return user;
  }

  /** Forgets an account entirely, so it may apply again. */
  async remove(email: string): Promise<boolean> {
    return this.store.delete(key(email));
  }
}

/** What an account may do: the owner always everything; others by their approved status. */
export function roleOf(email: string, owner: string | undefined, user: User | null): Role | null {
  if (owner && email === owner.trim().toLowerCase()) return "owner";
  if (user?.status === "engineer") return "engineer";
  if (user?.status === "viewer") return "viewer";
  return null;
}
export const canRelease = (role: Role | null) => role === "owner" || role === "engineer";
