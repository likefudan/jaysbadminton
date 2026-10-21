import type { MyEventResponse, PublicEvent } from "../../shared/types";
import { fmtDate, t, tx } from "../i18n";
import { Load, Page } from "../components";
import { EventHero, mapLink, publicStatus } from "../events";
import { useApi, useMemberSession } from "../hooks";
import { CardCornerIcons } from "../ShareCard";
import { SignupCard } from "./Member";

/**
 * The page shared in the WeChat group: when, where and how many, never who. A member signed in
 * with Google sees their own card instead: the full roster, their sign-up and their bill.
 */
export function EventPage(props: { code?: string }) {
  const [ev] = useApi<PublicEvent>(`/api/public/events/${props.code}`);
  const member = useMemberSession();
  return (
    <Load result={ev}>
      {(e) => (
        <Page title={e.title || fmtDate(e.date, false)} eyebrow={`${e.date.slice(0, 4)} · ${t("羽毛球活动")}`}>
          {member === "member" ? (
            <MemberView e={e} />
          ) : (
            <>
              <PublicCard e={e} />
              {member === "pending" && <p class="muted small">{t("你的入群申请正在等待审核，通过后就能报名。")}</p>}
            </>
          )}
          {(member === "member" || member === "pending") && (
            <a class="button block" href="/me">
              {t("我的活动")}
            </a>
          )}
          <a class="button secondary block" href="/">
            {t("所有活动")}
          </a>
        </Page>
      )}
    </Load>
  );
}

/**
 * The event as it appears on the member's own page, past ones included (who came, their bill and
 * whether it is paid), and ones they are not on (你没有报名); the public card only for a cancelled one.
 */
function MemberView(props: { e: PublicEvent }) {
  const [res, reload] = useApi<MyEventResponse>(`/api/m/session/events/${props.e.id}`);
  const mine = res.state === "ok" ? res.data.event : null;
  if (res.state === "loading") return null;
  if (res.state === "ok" && mine) return <SignupCard base="/api/m/session" e={mine} onChange={reload} />;
  return <PublicCard e={props.e} />;
}

/** The event in the same card as 我的活动 (coloured top, date, place), with only what anyone may see. */
function PublicCard(props: { e: PublicEvent }) {
  const e = props.e;
  return (
    <section class={`card ev-card tone-${e.status === "open" ? "soft" : "plain"}`}>
      <div class="ev-head">
        <EventHero e={e} status={publicStatus(e.status)} action={<CardCornerIcons e={e} calendar />} />
      </div>
      <div class="ev-main">
        {e.address && (
          <a class="ev-meta address" href={mapLink(e.address)} target="_blank" rel="noreferrer">
            {e.address} ↗
          </a>
        )}
        {e.notes?.trim() && <div class="ev-meta event-notes">{e.notes}</div>}
        <div class="ev-meta">{tx("{n} 人已报名", { n: <b>{e.headcount}</b> })}</div>
      </div>
    </section>
  );
}
