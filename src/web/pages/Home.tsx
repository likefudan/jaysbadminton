import { useState } from "preact/hooks";
import type { EventSummary, HomeResponse, Leaderboard } from "../../shared/types";
import { Empty, Load, Page, SectionTitle } from "../components";
import { EventHero, EventLink, MiniEventCard } from "../events";
import { useApi, useMemberSession } from "../hooks";
import { useSiteTitle } from "../site";
import { siteCardText } from "../../shared/shareCard";
import { ShareCardButton } from "../ShareCard";
import { BOARDS } from "../Stats";
import { SwipeSection } from "../Swipe";
import { t, tx } from "../i18n";

/** The next event as one big card; 报名 (or 登录 / 注册) sits in its corner. */
function NextEvent(props: { e: EventSummary; cta: string }) {
  const e = props.e;
  const status = e.status === "open" ? { cls: "open", label: t("报名中") } : { cls: "closed", label: t("已截止") };
  return (
    <section class="next-card tone-hero">
      <a class="next-event" href={`/e/${e.code}`}>
        <EventHero e={e} status={status}>
          <span class="next-count">
            <span>{tx("{n} 人已报名", { n: <b>{e.headcount}</b> })}</span>
          </span>
        </EventHero>
      </a>
      <a class="next-cta" href="/me">
        {props.cta}
        <span aria-hidden="true"> →</span>
      </a>
    </section>
  );
}

/** 排行榜 as a row of small cards that scrolls sideways, first place in the accent colour. */
function Leaders(props: { board: Leaderboard }) {
  const [tab, setTab] = useState<(typeof BOARDS)[number]["key"]>("attendance");
  const b = BOARDS.find((x) => x.key === tab)!;
  const list = props.board[tab];
  return (
    <>
      <SwipeSection
        title={t("{year} 年排行榜", { year: props.board.year })}
        extra={
          <span class="seg mini">
            {BOARDS.map((x) => (
              <button type="button" key={x.key} class={x.key === tab ? "on" : ""} onClick={() => setTab(x.key)}>
                {t(x.label)}
              </button>
            ))}
          </span>
        }
        empty={list.length === 0 ? <Empty>{t("还没有出勤记录")}</Empty> : undefined}
        ordered
        class="ranks-swipe"
      >
        {list.map((r) => (
          <li key={r.name} class={`rank-card p${r.rank}`}>
            <span class="rank-no">{r.rank}</span>
            <span class="who">{r.name}</span>
            <span class="value">
              {r.value}
              <small>{t(b.unit)}</small>
            </span>
          </li>
        ))}
      </SwipeSection>
      {tab === "streak" && <p class="muted small swipe-note">{t("连续参加的活动场数，取消的活动不算。")}</p>}
    </>
  );
}

export function Home() {
  const [home] = useApi<HomeResponse>("/api/public/home");
  const member = useMemberSession();
  const cta = member === "member" || member === "pending" ? t("报名") : t("登录 / 注册");
  return (
    <Page title={useSiteTitle()} bare>
      <Load result={home}>
        {(data) => {
          const next = data.currentEvents.find((e) => e.status === "open") ?? data.currentEvents[0];
          const others = data.currentEvents.filter((e) => e !== next);
          return (
            <>
              {next ? (
                <NextEvent e={next} cta={cta} />
              ) : (
                <>
                  <a class="button block" href="/me">
                    {cta}
                  </a>
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
              <ShareCardButton text={siteCardText(location.origin, t)} filename="share-card.png" />
            </>
          );
        }}
      </Load>
    </Page>
  );
}
