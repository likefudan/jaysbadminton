import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/worker/index";
import { handleEmail } from "../src/worker/inbound";
import { dollars } from "../src/shared/settle";
import { appoint, billingScenario, Client, expire, futureDate, GOOGLE, ORIGIN, request } from "./helpers";
import { testKey, venmoEmail, type ReceiptFields } from "./venmoMail";

/** 付款回执: the payer is emailed once a Venmo payment lands on their bill. */

const mail = { ...env, SITE_ORIGIN: ORIGIN, RESEND_API_KEY: "re_test", EMAIL_FROM: "Jay <jay@example.com>" };

let resolveKey: Awaited<ReturnType<typeof testKey>>["resolveKey"];
beforeAll(async () => {
  resolveKey = (await testKey()).resolveKey;
});

let emails: any[] = [];
beforeEach(() => {
  emails = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.resend.com/emails") {
      emails.push({
        ...JSON.parse(String(init?.body)),
        key: (init!.headers as Record<string, string>)["Idempotency-Key"],
      });
      return Response.json({ id: "email-1" });
    }
    if (url.startsWith("https://api.telegram.org/")) return Response.json({ ok: true, result: { message_id: 1 } });
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

const deliver = async (fields: ReceiptFields, e: typeof env = mail) =>
  handleEmail(e, (await venmoEmail(fields)).raw, { resolveKey });

async function scenario() {
  const s = await billingScenario();
  await s.admin.call(`${s.eb}/finalize`, s.fees);
  const bills = async () =>
    Object.fromEntries(
      (await s.admin.call(`${s.eb}/settlement`)).data.payments.map((p: any) => [p.memberName, p]),
    ) as Record<string, any>;
  const email = async (id: string) =>
    (await env.DB.prepare("SELECT email FROM members WHERE id = ?").bind(id).first<{ email: string }>())!.email;
  return { ...s, bills, email };
}

describe("payment receipt email", () => {
  it("tells the payer what is still owed, then that it is paid in full, then about a refund", async () => {
    const s = await scenario();
    const bob = (await s.bills()).Bob;
    const due = bob.amountDueCents as number;
    const owner = (await env.DB.prepare("SELECT username FROM members WHERE id = ?").bind(s.owner).first<{
      username: string;
    }>())!.username;

    expect(await deliver({ note: bob.paymentCode, txnId: "R1", amount: "10.00", payer: "Bob B" })).toBe("partial");
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual([await s.email(s.bob.id)]);
    expect(emails[0].subject).toBe("已收到你的 Venmo 付款 $10.00");
    expect(emails[0].text).toContain(`活动组织人 ${owner} 已收到你的 Venmo 付款 $10.00`);
    expect(emails[0].text).toContain("Venmo 付款人：Bob B");
    expect(emails[0].text).toContain(`还差 $${dollars(due - 1000)}`);
    expect(emails[0].key).toBe(`payment-receipt/${bob.id}/R1/1000/${due}`);

    expect(await deliver({ note: bob.paymentCode, txnId: "R2", amount: dollars(due - 1000) })).toBe("paid");
    expect(emails[1].text).toContain("已全部付清");

    expect(await deliver({ note: bob.paymentCode, txnId: "R3", amount: "5.00" })).toBe("overpaid");
    expect(emails[2].text).toContain("多付了 $5.00，多付的钱会退给你");

    // The same Venmo email again changes nothing and sends nothing.
    expect(await deliver({ note: bob.paymentCode, txnId: "R3", amount: "5.00" })).toBe("duplicate");
    expect(emails).toHaveLength(3);
  });

  it("is sent when a 待确认 payment is linked, but not for 标记已付", async () => {
    const s = await scenario();
    const { Alice: alice, Bob: bob } = await s.bills();
    // No code in the bill's format: lands in 待确认 because the name doesn't match the member.
    expect(await deliver({ note: alice.paymentCode.replace(/^[^-]+/, "bob"), txnId: "L1", amount: "7.00" })).toBe(
      "review",
    );
    expect(emails).toEqual([]);
    const open = (await s.admin.call(`${s.base}/inbound`)).data.open;
    expect(open).toHaveLength(1);
    const linked = await worker(s, `${s.base}/inbound/${open[0].id}/link`, { paymentId: alice.id });
    expect(linked.status).toBe(200);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual([await s.email(s.alice.id)]);
    expect(emails[0].text).toContain(`还差 $${dollars(alice.amountDueCents - 700)}`);

    expect((await worker(s, `${s.base}/payments/${bob.id}/mark-paid`, {})).status).toBe(200);
    expect(emails).toHaveLength(1);
  });

  it("is skipped for a member without an email, and when email is not set up", async () => {
    const s = await scenario();
    const bob = (await s.bills()).Bob;
    await env.DB.prepare("UPDATE members SET email = NULL WHERE id = ?").bind(s.bob.id).run();
    expect(await deliver({ note: bob.paymentCode, txnId: "N1", amount: dollars(bob.amountDueCents) })).toBe("paid");
    const alice = (await s.bills()).Alice;
    expect(await deliver({ note: alice.paymentCode, txnId: "N2", amount: "1.00" }, env)).toBe("partial");
    expect(emails).toEqual([]);
  });

  it("names the organizer whose account received the money", async () => {
    const s = await scenario();
    const org = await appoint(s.alice.id, "alice");
    expect(
      (await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "Alice-V", venmoEmail: "alice@venmo.test" }))
        .status,
    ).toBe(200);
    const created = (await (
      await request(`${GOOGLE}/events`, org, {
        date: futureDate(9),
        startTime: "19:00",
        endTime: "21:00",
        location: "Alice Gym",
        deadlineDays: 1,
        deadlineHours: 0,
      })
    ).json()) as { id: number };
    const ab = `${GOOGLE}/events/${created.id}`;
    await new Client().call(`${s.bob.base}/events/${created.id}/signup`, { friends: [] });
    await expire(created.id);
    expect((await request(`${ab}/finalize`, org, s.fees)).status).toBe(200);
    const bob = ((await (await request(`${ab}/settlement`, org)).json()) as any).payments.find(
      (p: any) => p.memberName === "Bob",
    );
    const on = { ...mail, ORGANIZERS: "1" };
    expect(
      await deliver(
        {
          note: bob.paymentCode,
          txnId: "O1",
          amount: dollars(bob.amountDueCents),
          sentTo: "Alice-V",
          to: "alice@venmo.test",
        },
        on,
      ),
    ).toBe("paid");
    expect(emails).toHaveLength(1);
    expect(emails[0].text).toContain(`活动组织人 Alice 已收到你的 Venmo 付款 $${dollars(bob.amountDueCents)}`);
    expect(emails[0].text).toContain("已全部付清");
  });
});

/** An admin request through the Worker with email set up. */
const worker = (s: { admin: Client }, path: string, body: unknown) =>
  app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { Cookie: s.admin.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    mail,
    {} as ExecutionContext,
  );
