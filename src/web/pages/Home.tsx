import type { EventSummary, HomeResponse } from "../../shared/types";
import { Empty, Load, Page, SectionTitle } from "../components";
import { CourtsLine, EventHero, EventLink, MiniEventCard } from "../events";
import { Account } from "./Account";
import { MemberNav } from "./Member";
import { useApi, useMemberSession } from "../hooks";
import { useSiteTitle } from "../site";
import { siteCardText } from "../../shared/shareCard";
import { ShareCardButton } from "../ShareCard";
import { Leaders } from "../Boards";
import { SwipeSection } from "../Swipe";
import { t, tx } from "../i18n";

/** An event as one big card; 报名 (or 查看 once they're on it) sits in its corner. */
function NextEvent(props: {
  e: EventSummary;
  /** The button's label; null for none (signed out: 登录 / 注册 goes on the page once, not on the card). */
  cta: string | null;
  /** Where the button goes: 我的活动 (or sign-in) by default; the event's own page for a member. */
  ctaHref?: string;
  mine?: { cls: string; label: string } | null;
  /** 预定场地, for a member on it. */
  courts?: number[];
  /** Coral (the default), light or plain: see toneFor. */
  tone?: "hero" | "soft" | "plain";
}) {
  const e = props.e;
  const status =
    props.mine ?? (e.status === "open" ? { cls: "open", label: t("报名中") } : { cls: "closed", label: t("已截止") });
  return (
    <section class={`next-card tone-${props.tone ?? "hero"}`}>
      <a class="next-event" href={`/e/${e.code}`}>
        <EventHero e={e} status={status}>
          <span class="next-count">
            <span>{tx("{n} 人已报名", { n: <b>{e.headcount}</b> })}</span>
          </span>
          {props.courts && props.courts.length > 0 && <CourtsLine courts={props.courts} />}
        </EventHero>
      </a>
      {props.cta !== null && (
        <a class="next-cta" href={props.ctaHref ?? "/me"}>
          {props.cta}
          <span aria-hidden="true"> →</span>
        </a>
      )}
    </section>
  );
}

/** 排行榜、历史活动 and 分享: the bottom of the public home page, and a signed-in member's 排行榜 page. */
function BoardAndPast(props: { data: HomeResponse }) {
  const data = props.data;
  return (
    <>
      {data.leaderboard && <Leaders board={data.leaderboard} />}
      <SwipeSection
        title={t("历史活动")}
        empty={data.pastEvents.length === 0 ? <Empty>{t("还没有历史活动")}</Empty> : undefined}
      >
        {data.pastEvents.map((e) => (
          <MiniEventCard
            key={e.id}
            e={e}
            muted={e.status === "cancelled"}
            line={e.status === "cancelled" ? t("已取消") : t("{n} 人参加", { n: e.headcount })}
          />
        ))}
      </SwipeSection>
      <ShareCardButton text={siteCardText(location.origin, t)} />
    </>
  );
}

/** /board 排行榜: the boards, 历史活动 and 分享. Members reach it from the row on top; anyone may open it. */
export function BoardPage() {
  const [home] = useApi<HomeResponse>("/api/public/home");
  const member = useMemberSession();
  return (
    <Page title={t("排行榜")} bare>
      {member === "member" && <MemberNav current="board" top />}
      <Load result={home}>{(data) => <BoardAndPast data={data} />}</Load>
    </Page>
  );
}

/**
 * The home page. A signed-in member gets 我的活动 here (Ke Li 2026-11-12, option A: the two pages
 * showed the same cards); everyone else the public page.
 */
export function Home() {
  const member = useMemberSession();
  const title = useSiteTitle();
  if (member === "loading")
    return (
      <Page title={title} bare>
        {null}
      </Page>
    );
  return member === "member" ? <Account /> : <PublicHome pending={member === "pending"} />;
}

function PublicHome(props: { pending: boolean }) {
  const [home] = useApi<HomeResponse>("/api/public/home");
  const cta = t("报名");
  return (
    <Page title={useSiteTitle()} bare>
      <Load result={home}>
        {(data) => {
          const next = data.currentEvents.find((e) => e.status === "open") ?? data.currentEvents[0];
          const others = data.currentEvents.filter((e) => e !== next);
          return (
            <>
              {next ? (
                // Signed out: nothing on the card, 登录 / 注册 is in the top bar (Ke Li).
                <NextEvent e={next} cta={props.pending ? cta : null} />
              ) : (
                <>
                  {props.pending && (
                    <a class="button block" href="/me">
                      {cta}
                    </a>
                  )}
                  <Empty>{t("暂时没有活动")}</Empty>
                </>
              )}
              {others.length > 0 && (
                <>
                  <SectionTitle>{t("近期活动")}</SectionTitle>
                  <div class="card list">
                    {others.map((e) => (
                      <EventLink key={e.id} e={e} href={`/e/${e.code}`} publicView />
                    ))}
                  </div>
                </>
              )}
              <BoardAndPast data={data} />
            </>
          );
        }}
      </Load>
    </Page>
  );
}
