import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { remindIfExpired } from "../src/worker/appointments";
import { emailProblemAlert, forwardingWatch } from "../src/worker/health";
import { handleEmail, purgeGmailConfirmations, receiveEmail, recordEmailOutcome } from "../src/worker/inbound";
import { dollars } from "../src/shared/settle";
import { pacificToUtc } from "../src/shared/time";
import { appoint, billingScenario, Client, expire, futureDate, GOOGLE, ORIGIN, request } from "./helpers";
import { testKey, venmoEmail, type ReceiptFields } from "./venmoMail";

/** Card 8: auto-matching with several payees, each organizer's Venmo account beside the Owner's. */

const on = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "1" };
const OWNER_CHAT = "42";
const ALICE_CHAT = "77";
const ALICE = { sentTo: "Alice-V", to: "alice@venmo.test" };

let resolveKey: Awaited<ReturnType<typeof testKey>>["resolveKey"];
beforeAll(async () => {
  resolveKey = (await testKey()).resolveKey;
});

/** Telegram messages sent, as [chat, text]; Resend emails, as their JSON bodies. */
let telegram: [string, string][] = [];
let emails: any[] = [];
beforeEach(() => {
  telegram = [];
  emails = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url === "https://api.resend.com/emails") {
      emails.push(body);
      return Response.json({ id: "email-1" });
    }
    if (!url.startsWith("https://api.telegram.org/")) throw new Error(`unexpected fetch ${url}`);
    telegram.push([String(body.chat_id), body.text]);
    return Response.json({ ok: true, result: { message_id: 1 } });
  });
});
afterEach(() => vi.restoreAllMocks());
const to = (chat: string) => telegram.filter(([c]) => c === chat).map(([, t]) => t);

const deliver = async (fields: ReceiptFields, e: typeof env = env) =>
  handleEmail(e, (await venmoEmail(fields)).raw, { resolveKey });
const json = async (res: Response) => (await res.json()) as any;
/** What a bill owes, as Venmo prints it. */
const due = (bill: { amountDueCents: number }) => dollars(bill.amountDueCents);

/**
 * The Owner's event (billingScenario: Jay, Alice, Bob) and one run by Alice, an organizer paid into
 * her own Venmo (Alice-V), which Bob and Jay play. Both finalized; the Owner and Alice have Telegram.
 */
async function scenario() {
  const s = await billingScenario();
  await s.admin.call(`${s.eb}/finalize`, s.fees);
  const org = await appoint(s.alice.id, "alice");
  expect(
    (await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "Alice-V", venmoEmail: "alice@venmo.test" }))
      .status,
  ).toBe(200);
  const created = await json(
    await request(`${GOOGLE}/events`, org, {
      date: futureDate(9),
      startTime: "19:00",
      endTime: "21:00",
      location: "Alice Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    }),
  );
  const ab = `${GOOGLE}/events/${created.id}`;
  await request(`${ab}/roster/add`, org, { memberId: s.owner, includeSelf: true });
  await new Client().call(`${s.bob.base}/events/${created.id}/signup`, { friends: [] });
  await expire(created.id);
  expect((await request(`${ab}/finalize`, org, s.fees)).status).toBe(200);
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', ?)").bind(OWNER_CHAT).run();
  await env.DB.prepare("INSERT INTO telegram_bindings (member_id, chat_id) VALUES (?, ?)")
    .bind(s.alice.id, ALICE_CHAT)
    .run();

  const codes = async (path: string, cookie?: string) =>
    Object.fromEntries(
      (cookie
        ? await json(await request(`${path}/settlement`, cookie))
        : (await s.admin.call(`${path}/settlement`)).data
      ).payments.map((p: { memberName: string }) => [p.memberName, p]),
    ) as Record<string, any>;
  const ownerBills = () => codes(s.eb);
  const aliceBills = () => codes(ab, org);
  telegram = [];
  return { ...s, org, aliceEvent: created.id as number, ab, ownerBills, aliceBills };
}

const inbound = (txn: string) =>
  env.DB.prepare("SELECT payee_id, state, reason FROM inbound_payments WHERE venmo_txn_id = ?")
    .bind(txn)
    .first<{ payee_id: string | null; state: string; reason: string }>();

describe("whose account a Venmo payment went into", () => {
  it("matches the Owner's account for the Owner's event and an organizer's for theirs", async () => {
    const s = await scenario();
    const own = (await s.ownerBills()).Bob;
    expect(await deliver({ note: own.paymentCode, txnId: "O1", amount: due(own) })).toBe("paid");
    const bob = (await s.aliceBills()).Bob;
    expect(await deliver({ note: bob.paymentCode, txnId: "A1", amount: due(bob), ...ALICE })).toBe("paid");
    expect((await s.aliceBills()).Bob.status).toBe("paid");
    // Her account's last email is what 转发已生效 shows.
    const profile = await json(await request(`${GOOGLE}/payment-profile`, s.org));
    expect(profile.lastVenmoEmailAt).toBeTruthy();
  });

  it("puts money paid into the wrong person's account in 待确认, for that account", async () => {
    const s = await scenario();
    // Alice's event, paid into the Owner's account.
    expect(await deliver({ note: (await s.aliceBills()).Jay.paymentCode, txnId: "W1" })).toBe("review");
    expect(await inbound("W1")).toMatchObject({
      payee_id: s.owner,
      reason: "付到了 @KeLi8916（群主）的账户，但这场的收款人是 Alice",
    });
    // The Owner's event, paid into Alice's account.
    const bob = (await s.ownerBills()).Bob;
    expect(await deliver({ note: bob.paymentCode, txnId: "W2", ...ALICE })).toBe("review");
    const row = await inbound("W2");
    expect(row).toMatchObject({
      payee_id: s.alice.id,
      reason: "付到了 @Alice-V（Alice）的账户，但这场的收款人是 群主",
    });
    expect((await s.ownerBills()).Bob.status).toBe("unpaid");

    // Alice sees it, but can't put it on the Owner's bill; the Owner sees whose account it is in.
    const hers = await json(await request(`${GOOGLE}/inbound`, s.org));
    expect(hers.open.map((i: any) => [i.txnId, i.payee])).toEqual([["W2", null]]);
    const id = hers.open[0].id;
    expect((await request(`${GOOGLE}/inbound/${id}/link`, s.org, { paymentId: bob.id })).status).toBe(403);
    const all = (await s.admin.call(`${s.base}/inbound`)).data;
    expect(Object.fromEntries(all.open.map((i: any) => [i.txnId, i.payee]))).toEqual({ W1: null, W2: "Alice" });

    // The Owner links it: paid, marked as money in Alice's account.
    expect((await s.admin.call(`${s.base}/inbound/${id}/link`, { paymentId: bob.id })).status).toBe(200);
    const after = (await s.ownerBills()).Bob;
    expect(after.status).toBe("paid");
    expect(after.receipts).toMatchObject([{ method: "venmo", elsewhere: "Alice" }]);
  });

  it("keeps a changed Venmo account recognized while bills are out", async () => {
    const s = await scenario();
    expect(
      (await request(`${GOOGLE}/payment-profile`, s.org, { venmoUsername: "Alice-New", venmoEmail: "new@venmo.test" }))
        .status,
    ).toBe(200);
    const b = await s.aliceBills();
    expect(await deliver({ note: b.Bob.paymentCode, txnId: "AL1", amount: due(b.Bob), ...ALICE })).toBe("paid");
    expect(
      await deliver({
        note: b.Jay.paymentCode,
        txnId: "AL2",
        amount: due(b.Jay),
        sentTo: "Alice-New",
        to: "new@venmo.test",
      }),
    ).toBe("paid");
  });

  it("still matches a former organizer's account while their events collect, then only into 待确认", async () => {
    const s = await scenario();
    expect((await request(`${s.base}/members/${s.alice.id}/revoke`, s.admin.cookie, {})).status).toBe(200);
    const bills = await s.ownerBills();
    const hers = await s.aliceBills().catch(() => null);
    expect(hers).toBeNull(); // her Google session no longer opens the admin pages
    const own = (await s.admin.call(`${s.base}/events/${s.aliceEvent}/settlement`)).data.payments;
    const bob = own.find((p: any) => p.memberName === "Bob");
    const jay = own.find((p: any) => p.memberName === "Jay");

    expect(await deliver({ note: bob.paymentCode, txnId: "R1", amount: due(bob), ...ALICE }, on)).toBe("paid");
    // Money for the Owner's event: 待确认, told to the Owner (she can no longer handle it).
    expect(await deliver({ note: bills.Bob.paymentCode, txnId: "R2", ...ALICE }, on)).toBe("review");
    expect((await inbound("R2"))!.payee_id).toBe(s.alice.id);
    expect(to(ALICE_CHAT)).toEqual([]);
    expect(to(OWNER_CHAT).at(-1)).toContain("历史收款人 Alice");

    // Her last event is archived: expired. Our code → 待确认; anything else is dropped quietly.
    await env.DB.prepare("UPDATE events SET status = 'settled' WHERE id = ?").bind(s.aliceEvent).run();
    expect(await deliver({ note: jay.paymentCode, txnId: "R3", ...ALICE }, on)).toBe("review");
    expect((await inbound("R3"))!.reason).toBe("付到了 @Alice-V（Alice）的账户，这个账户已经不再收本群的款");
    expect(await deliver({ note: "pizza", txnId: "R4", ...ALICE }, on)).toBe("ignored");
  });

  it("reports an account nobody has, as before", async () => {
    const s = await scenario();
    const code = (await s.aliceBills()).Bob.paymentCode;
    expect(await deliver({ note: code, txnId: "U1", sentTo: "Alice-V", to: "other@venmo.test" })).toBe(
      "wrong_recipient",
    );
    expect(await deliver({ note: code, txnId: "U2", sentTo: "Stranger", to: "alice@venmo.test" })).toBe(
      "wrong_recipient",
    );
  });
});

describe("待确认 notices", () => {
  it("go to the organizer whose account it is, or the Owner when they have no Telegram", async () => {
    const s = await scenario();
    const bob = (await s.ownerBills()).Bob;
    expect(await deliver({ note: bob.paymentCode, txnId: "N1", ...ALICE }, on)).toBe("review");
    expect(to(ALICE_CHAT)).toHaveLength(1);
    expect(to(ALICE_CHAT)[0]).toContain("需要确认");
    expect(to(ALICE_CHAT)[0]).toContain("/admin/google");
    expect(to(OWNER_CHAT)).toEqual([]);

    telegram = [];
    await env.DB.prepare("DELETE FROM telegram_bindings").run();
    expect(await deliver({ note: bob.paymentCode, txnId: "N2", amount: "1.00", ...ALICE }, on)).toBe("review");
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toContain("组织者 Alice 还没连接 Telegram");

    // The Owner's own account: the Owner, as always.
    telegram = [];
    expect(await deliver({ note: (await s.aliceBills()).Jay.paymentCode, txnId: "N3" }, on)).toBe("review");
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).not.toContain("ℹ️");
  });
});

describe("the Owner's forwarding status", () => {
  it("is not moved by emails into an organizer's account", async () => {
    const s = await scenario();
    const { outcome, organizer } = await receiveEmail(
      env,
      (await venmoEmail({ note: "pizza", txnId: "S1", ...ALICE })).raw,
      { resolveKey },
    );
    expect([outcome, organizer]).toEqual(["ignored", s.alice.id]);
    await recordEmailOutcome(env, outcome, organizer);
    expect((await s.admin.call(`${s.base}/email-status`)).data.lastAt).toBeNull();
  });
});

describe("emails into an organizer's notification email that match no account", () => {
  it("are theirs: not the Owner's 转发状态, and the problem goes to them", async () => {
    const s = await scenario();
    const { outcome, organizer } = await receiveEmail(
      on,
      (await venmoEmail({ note: "x", txnId: "P1", sentTo: "Typo-V", to: "alice@venmo.test" })).raw,
      { resolveKey },
    );
    expect([outcome, organizer]).toEqual(["wrong_recipient", s.alice.id]);
    await recordEmailOutcome(env, outcome, organizer);
    expect((await s.admin.call(`${s.base}/email-status`)).data.lastAt).toBeNull();
    await emailProblemAlert(on, outcome, new Date(), organizer);
    expect(to(ALICE_CHAT)).toHaveLength(1);
    expect(to(ALICE_CHAT)[0]).toContain("我的收款设置");
    expect(to(OWNER_CHAT)).toEqual([]);
  });
});

describe("转发已生效 for an organizer", () => {
  it("follows the account they have now, not an old one", async () => {
    const s = await scenario();
    const b = await s.aliceBills();
    expect(await deliver({ note: b.Bob.paymentCode, txnId: "F1", amount: due(b.Bob), ...ALICE })).toBe("paid");
    const last = async () => (await json(await request(`${GOOGLE}/payment-profile`, s.org))).lastVenmoEmailAt;
    expect(await last()).toBeTruthy();
    // A new account starts unproven, and the old one's emails (still matched) don't prove it.
    expect(
      (await request(`${GOOGLE}/payment-profile`, s.org, { venmoUsername: "Alice-New", venmoEmail: "new@venmo.test" }))
        .status,
    ).toBe(200);
    expect(await last()).toBeNull();
    expect(await deliver({ note: b.Jay.paymentCode, txnId: "F2", amount: due(b.Jay), ...ALICE })).toBe("paid");
    expect(await last()).toBeNull();
  });
});

describe("taking a payment back off a bill", () => {
  it("gives an auto-matched one a 待确认 row in the event payee's account", async () => {
    const s = await scenario();
    const bob = (await s.aliceBills()).Bob;
    expect(await deliver({ note: bob.paymentCode, txnId: "B1", amount: due(bob), ...ALICE })).toBe("paid");
    const receipt = (await s.aliceBills()).Bob.receipts[0];
    expect((await request(`${GOOGLE}/receipts/${receipt.id}/remove`, s.org, {})).status).toBe(200);
    expect(await inbound("B1")).toMatchObject({ payee_id: s.alice.id, state: "open" });
    // So Alice can put it back herself.
    const open = (await json(await request(`${GOOGLE}/inbound`, s.org))).open;
    expect(open.map((i: any) => i.txnId)).toEqual(["B1"]);
  });
});

describe("Gmail forwarding confirmation", () => {
  const confirmation = (from: string) =>
    venmoEmail(
      { from: "Gmail Team <forwarding-noreply@google.com>", txnId: "G1" },
      {
        domain: "google.com",
        subject: `(#123456789) Gmail Forwarding Confirmation - Receive Mail from ${from}`,
        body: `<p>${from} has requested to automatically forward mail.</p><p>Confirmation code: 123456789</p>`,
      },
    );

  it("goes to the organizer whose Venmo email it names: their page and Telegram", async () => {
    const s = await scenario();
    expect(await handleEmail(on, (await confirmation("Alice@Venmo.test")).raw, { resolveKey })).toBe(
      "gmail_confirm_organizer",
    );
    expect(to(ALICE_CHAT)).toHaveLength(1);
    expect(to(ALICE_CHAT)[0]).toContain("123456789");
    expect(to(OWNER_CHAT)).toEqual([]);
    const page = await json(await request(`${GOOGLE}/payment-profile`, s.org));
    expect(page.gmailConfirm).toContain("Confirmation code: 123456789");
    expect(page.gmailConfirmAt).toBeTruthy();

    // Gone after 24 hours.
    await purgeGmailConfirmations(env, new Date(Date.now() + 25 * 3600_000));
    expect((await json(await request(`${GOOGLE}/payment-profile`, s.org))).gmailConfirm).toBeNull();
  });

  it("never goes to an organizer when it names one of the Owner's own addresses", async () => {
    const s = await scenario();
    await env.DB.prepare("UPDATE members SET google_email = 'jay@gmail.com' WHERE id = ?").bind(s.owner).run();
    await env.DB.prepare("UPDATE payment_profiles SET venmo_email = 'jay@gmail.com' WHERE member_id = ?")
      .bind(s.alice.id)
      .run();
    expect(await handleEmail(on, (await confirmation("jay@gmail.com")).raw, { resolveKey })).toBe("gmail_confirm");
    expect(to(ALICE_CHAT)).toEqual([]);
    expect(to(OWNER_CHAT)).toHaveLength(1);
  });

  it("goes to the Owner when it names nobody's, or with the feature off", async () => {
    await scenario();
    expect(await handleEmail(on, (await confirmation("someone@gmail.com")).raw, { resolveKey })).toBe("gmail_confirm");
    expect(to(OWNER_CHAT)).toHaveLength(1);
    telegram = [];
    expect(await handleEmail(env, (await confirmation("alice@venmo.test")).raw, { resolveKey })).toBe("gmail_confirm");
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(ALICE_CHAT)).toEqual([]);
  });
});

describe("转发可能中断, by account", () => {
  const cfg = { reminderEnabled: true, reminderHours: 6, dunningHour: 10, weeklyDigest: false };
  const at = () => new Date(pacificToUtc(futureDate(1), "10:05"));

  it("tells an organizer about their own account, with a copy for the Owner", async () => {
    const s = await scenario();
    await env.DB.prepare("UPDATE events SET finalized_at = '2000-01-01T00:00:00.000Z'").run();
    // The Owner's account had an email lately; Alice's never did.
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('email_last_at', ?)")
      .bind(new Date().toISOString())
      .run();
    await forwardingWatch(on, at(), cfg);
    expect(to(ALICE_CHAT)).toHaveLength(1);
    expect(to(ALICE_CHAT)[0]).toContain("系统还没收到过 @Alice-V（Alice）的 Venmo 邮件");
    expect(to(ALICE_CHAT)[0]).toContain("2 笔没付清");
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toContain("抄送");

    // Once per quiet spell.
    telegram = [];
    await forwardingWatch(on, at(), cfg);
    expect(telegram).toEqual([]);

    // Revoked: a former organizer's account goes to the Owner alone.
    await env.DB.prepare("DELETE FROM notification_log").run();
    await env.DB.prepare("UPDATE members SET role = 'member' WHERE id = ?").bind(s.alice.id).run();
    await forwardingWatch(on, at(), cfg);
    expect(to(ALICE_CHAT)).toEqual([]);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toContain("历史收款人 Alice");
  });

  it("checks the Owner's account by the Owner's bills only", async () => {
    const s = await scenario();
    await env.DB.prepare("UPDATE events SET finalized_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(s.e.id).run();
    await env.DB.prepare("UPDATE payment_profiles SET email_last_at = ?").bind(new Date().toISOString()).run();
    await forwardingWatch(on, at(), cfg);
    expect(to(ALICE_CHAT)).toEqual([]);
    expect(to(OWNER_CHAT)).toHaveLength(1);
    expect(to(OWNER_CHAT)[0]).toContain("还有 2 笔账单没付清");
  });
});

describe("a former organizer's account expiring", () => {
  const mail = { ...env, SITE_ORIGIN: ORIGIN, RESEND_API_KEY: "re_test", EMAIL_FROM: "Jay <jay@example.com>" };

  it("emails them once to remove the forwarding filter", async () => {
    const s = await scenario();
    expect((await request(`${s.base}/members/${s.alice.id}/revoke`, s.admin.cookie, {})).status).toBe(200);
    // Her event still collects: not yet.
    await remindIfExpired(mail, s.alice.id);
    expect(emails).toEqual([]);
    await env.DB.prepare("UPDATE events SET status = 'settled' WHERE id = ?").bind(s.aliceEvent).run();
    await remindIfExpired(mail, s.alice.id);
    await remindIfExpired(mail, s.alice.id);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(["alice@gmail.com"]);
    expect(emails[0].text).toContain("过滤器");
  });

  it("is checked when their last event is archived", async () => {
    const s = await scenario();
    expect((await request(`${s.base}/members/${s.alice.id}/revoke`, s.admin.cookie, {})).status).toBe(200);
    const owed = (await s.admin.call(`${s.base}/events/${s.aliceEvent}/settlement`)).data.payments.filter(
      (p: any) => p.status !== "paid",
    );
    expect(owed.length).toBeGreaterThan(0);
    // Paid off through the Owner (who manages it now): archived, and she is told (no Resend here: not configured).
    for (const p of owed) expect((await s.admin.call(`${s.base}/payments/${p.id}/mark-paid`, {})).status).toBe(200);
    expect((await env.DB.prepare("SELECT status FROM events WHERE id = ?").bind(s.aliceEvent).first())!.status).toBe(
      "settled",
    );
    expect(
      await env.DB.prepare("SELECT 1 FROM notification_log WHERE type = ?")
        .bind(`filter_reminder:${s.alice.id}`)
        .first(),
    ).toBeNull(); // not configured: not marked as sent, so a later archive tries again
  });
});
