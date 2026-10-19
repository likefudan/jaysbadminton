import { useState } from "preact/hooks";
import type { EventSummary, HomeResponse, Leaderboard } from "../../shared/types";
import { toPacific } from "../../shared/time";
import { Empty, Load, Page, SectionTitle } from "../components";
import { EventLink, StatusPill } from "../events";
import { useApi, useMemberSession } from "../hooks";
import { useSiteTitle } from "../site";
import { siteCardText } from "../../shared/shareCard";
import { ShareCardButton } from "../ShareCard";
import { BOARDS } from "../Stats";
import { fmtInstant, t, tx, weekdayOf } from "../i18n";

const md = (date: string) => {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${m}/${d}`;
};

/** 今天 16:30 / 明天 16:30, else the full date and time. */
function deadlineText(iso: string): string {
  const p = toPacific(iso);
  const today = toPacific(new Date()).date;
  const tomorrow = toPacific(new Date(Date.now() + 86_400_000)).date;
  if (p.date === today) return t("今天 {time}", { time: p.time });
  if (p.date === tomorrow) return t("明天 {time}", { time: p.time });
  return fmtInstant(iso);
}

/** The next event as one big card; 我的活动 (or 登录 / 注册) sits in its corner. */
function NextEvent(props: { e: EventSummary; cta: string }) {
  const e = props.e;
  const status = e.status === "open" ? { cls: "open", label: t("报名中") } : { cls: "closed", label: t("已截止") };
  return (
    <section class="next-card">
      <a class="next-event" href={`/e/${e.code}`}>
        <span class="next-top">
          <StatusPill cls={status.cls} label={status.label} />
          {e.status === "open" && <span>{t("截止 {time}", { time: deadlineText(e.deadlineAt) })}</span>}
        </span>
        <span class="next-date">
          {md(e.date)}
          <small>
            {weekdayOf(e.date)} {e.startTime}
          </small>
        </span>
        <span class="next-title">{e.title || e.location}</span>
        {e.title && <span class="next-venue">{e.location}</span>}
        <span class="next-count">
          <span>{tx("{n} 人已报名", { n: <b>{e.headcount}</b> })}</span>
        </span>
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
      <h2 class="section-title with-seg">
        <span>{t("{year} 年排行榜", { year: props.board.year })}</span>
        <span class="seg mini">
          {BOARDS.map((x) => (
            <button type="button" key={x.key} class={x.key === tab ? "on" : ""} onClick={() => setTab(x.key)}>
              {t(x.label)}
            </button>
          ))}
        </span>
      </h2>
      {list.length === 0 ? (
        <Empty>{t("还没有出勤记录")}</Empty>
      ) : (
        <ol class="swipe ranks-swipe">
          {list.map((r, i) => (
            <li key={r.name} class={`rank-card p${i + 1}`}>
              <span class="rank-no">{i + 1}</span>
              <span class="who">{r.name}</span>
              <span class="value">
                {r.value}
                <small>{t(b.unit)}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      {tab === "streak" && <p class="muted small swipe-note">{t("连续参加的活动场数，取消的活动不算。")}</p>}
    </>
  );
}

function PastCard(props: { e: EventSummary }) {
  const e = props.e;
  return (
    <a class={e.status === "cancelled" ? "past-card cancelled" : "past-card"} href={`/e/${e.code}`}>
      <span class="past-date">
        {md(e.date)}
        <small>{weekdayOf(e.date)}</small>
      </span>
      <span class="past-title">{e.title || e.location}</span>
      <span class="past-count">{e.status === "cancelled" ? t("已取消") : t("{n} 人参加", { n: e.headcount })}</span>
    </a>
  );
}

export function Home() {
  const [home] = useApi<HomeResponse>("/api/public/home");
  const member = useMemberSession();
  const cta = member === "member" || member === "pending" ? t("我的活动") : t("登录 / 注册");
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
              <SectionTitle>{t("历史活动")}</SectionTitle>
              {data.pastEvents.length === 0 ? (
                <Empty>{t("还没有历史活动")}</Empty>
              ) : (
                <div class="swipe">
                  {data.pastEvents.map((e) => (
                    <PastCard key={e.id} e={e} />
                  ))}
                </div>
              )}
              <ShareCardButton text={siteCardText(location.origin, t)} filename="share-card.png" />
            </>
          );
        }}
      </Load>
    </Page>
  );
}
