import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanLayout } from "../src/shared/courtMap";
import worker from "../src/worker/index";
import { approveMember, appoint, Client, createTestEvent, ORIGIN, setUpAdmin } from "./helpers";

const anon = new Client();
const image = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3));
/** Through the Worker with an AI key and the organizer roles on. GET without a body. */
const post = async (path: string, body?: unknown) => {
  const res = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, AZURE_FOUNDRY_API_KEY: "test-key", SITE_ORIGIN: ORIGIN, ORGANIZERS: "1" },
    {} as ExecutionContext,
  );
  return { status: res.status, data: (await res.json()) as any };
};

/** The model answering with `answer`. */
function model(answer: object, seen: any[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    seen.push(JSON.parse(String(init?.body ?? (input as Request).body)));
    return Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-fable-5-1",
      content: [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 2800, output_tokens: 900 },
    });
  });
  return seen;
}

const court = (label: string, x: number, y: number) => ({ kind: "court", label, x, y, w: 0.1, h: 0.05 });
const plan = {
  found: true,
  aspect: 1.39,
  items: [
    court("2", 0.1, 0.1),
    court("1", 0.3, 0.1),
    court("JR", 0.9, 0.7),
    court("1", 0.5, 0.1),
    { kind: "text", label: "BADMINTON COURTS", x: 0.35, y: 0.25, w: 0.3, h: 0.03 },
    { kind: "area", label: "FRONT DESK", x: 0.7, y: 0.95, w: 0.5, h: 0.2 },
  ],
};

describe("cleanLayout", () => {
  it("keeps courts with numbers, turns other courts into areas, and keeps boxes inside the plan", () => {
    expect(cleanLayout(plan)).toEqual({
      aspect: 1.39,
      items: [
        { kind: "court", label: "2", x: 0.1, y: 0.1, w: 0.1, h: 0.05 },
        { kind: "court", label: "1", x: 0.3, y: 0.1, w: 0.1, h: 0.05 },
        { kind: "area", label: "JR", x: 0.9, y: 0.7, w: 0.1, h: 0.05 },
        { kind: "text", label: "BADMINTON COURTS", x: 0.35, y: 0.25, w: 0.3, h: 0.03 },
        { kind: "area", label: "FRONT DESK", x: 0.7, y: 0.95, w: 0.3, h: 0.05 },
      ],
    });
  });

  it("refuses a plan without courts or with a strange shape", () => {
    expect(cleanLayout({ aspect: 1.3, items: [{ kind: "area", label: "A", x: 0, y: 0, w: 0.1, h: 0.1 }] })).toBeNull();
    expect(cleanLayout({ aspect: 40, items: [court("1", 0, 0)] })).toBeNull();
    expect(cleanLayout("nonsense")).toBeNull();
  });
});

describe("球场图", () => {
  afterEach(() => vi.restoreAllMocks());

  async function scenario() {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, { queueRoundMin: 45, location: "Bintang Fremont" });
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    for (const m of [alice, bob]) await anon.call(`${m.base}/events/${e.id}/signup`, { friends: [] });
    const q = `/events/${e.id}/queue`;
    const queue = async (base: string) => (await post(`${base}/events/${e.id}`)).data.event.queue;
    return { ctx, e, alice, bob, q, queue };
  }

  it("is read from a photo by the Owner, admins or whoever runs the event, checked, then saved for the venue", async () => {
    const { ctx, alice, bob, q, queue } = await scenario();
    // A player can't set it, and sees no plan yet.
    expect(await queue(alice.base)).toMatchObject({ map: null, mapEdit: false });
    expect((await post(`${alice.base}${q}/map/photo`, { image })).status).toBe(400);

    await appoint(bob.id, "bob", "admin");
    expect((await queue(bob.base)).mapEdit).toBe(true);
    const seen = model(plan);
    const read = await post(`${bob.base}${q}/map/photo`, { image });
    expect(read.status).toBe(200);
    expect(read.data.items.filter((i: any) => i.kind === "court")).toHaveLength(2);
    expect(seen[0].messages[0].content.some((c: any) => c.type === "image")).toBe(true);
    // Reading saves nothing.
    expect((await queue(alice.base)).map).toBeNull();

    // The page sends back what was checked (court 2 renumbered 3).
    const checked = {
      ...read.data,
      items: read.data.items.map((i: any) => (i.label === "2" ? { ...i, label: "3" } : i)),
    };
    expect((await post(`${bob.base}${q}/map`, { layout: checked })).status).toBe(200);
    const map = (await queue(alice.base)).map;
    expect(map.items.map((i: any) => i.label)).toEqual(["3", "1", "JR", "BADMINTON COURTS", "FRONT DESK"]);
    expect((await post(`${alice.base}${q}/map`, { layout: checked })).status).toBe(400);

    // Another event at the same venue (any case) shows it too; one elsewhere doesn't.
    const same = await createTestEvent(ctx, { queueRoundMin: 45, location: "bintang fremont" });
    const other = await createTestEvent(ctx, { queueRoundMin: 45 });
    for (const id of [same.id, other.id]) await anon.call(`${alice.base}/events/${id}/signup`, { friends: [] });
    expect((await post(`${alice.base}/events/${same.id}`)).data.event.queue.map).toEqual(map);
    expect((await post(`${alice.base}/events/${other.id}`)).data.event.queue.map).toBeNull();

    // A layout without courts isn't saved; 删除 takes it off the venue.
    expect((await post(`${bob.base}${q}/map`, { layout: { aspect: 1, items: [] } })).status).toBe(400);
    expect((await post(`${bob.base}${q}/map/remove`, {})).status).toBe(200);
    expect((await queue(alice.base)).map).toBeNull();
  });

  it("lets the organizer who runs the event set it, and says when the photo isn't a court map", async () => {
    const { ctx, bob } = await scenario();
    await appoint(bob.id, "bob", "organizer");
    const e = await createTestEvent(ctx, { queueRoundMin: 45, location: "Elsewhere" });
    await env.DB.prepare("UPDATE events SET manager_id = ? WHERE id = ?").bind(bob.id, e.id).run();
    model({ found: false, aspect: 1, items: [] });
    const res = await post(`${bob.base}/events/${e.id}/queue/map/photo`, { image });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toBe("照片上没有找到球场图，请对准场馆贴的平面图重拍一张");
  });
});
