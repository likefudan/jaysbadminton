import { useState } from "preact/hooks";
import type { EventSummary, HomeResponse, Leaderboard, MyEvent, MyEventsResponse } from "../../shared/types";
import { Empty, Load, Page, SectionTitle } from "../components";
import { CourtsLine, EventHero, EventLink, MiniEventCard, mineStatus, onCard } from "../events";
import { useApi, useMemberSession } from "../hooks";
import { useSiteTitle } from "../site";
import { siteCardText } from "../../shared/shareCard";
import { ShareCardButton } from "../ShareCard";
import { BOARDS } from "../Stats";
import { kcalText } from "../Calories";
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

/**
 * A member's card colour, the rule on 我的活动 (Ke Li): coral for the ones they (or their friends)
 * are on until the bill comes, light for ones they could still join, plain for the rest.
 */
function toneFor(e: EventSummary, own: MyEvent | undefined): "hero" | "soft" | "plain" {
  if (own && onCard(own)) return "hero";
  return e.status === "open" ? "soft" : "plain";
}

/** All the current events for a signed-in member, soonest first, each in the same card (Ke Li). */
function MyEvents(props: { events: EventSummary[] }) {
  const [res] = useApi<MyEventsResponse>("/api/m/session/events");
  if (res.state === "loading") return null;
  const mine = res.state === "ok" ? res.data.events : [];
  return (
    <>
      {props.events.map((e) => {
        const own = mine.find((x) => x.id === e.id);
        const cta = own?.selfSignedUp || e.status !== "open" ? t("查看") : t("报名");
        return (
          <NextEvent
            key={e.id}
            e={e}
            cta={cta}
            ctaHref={`/e/${e.code}`}
            mine={own ? mineStatus(own) : null}
            courts={own?.courts}
            tone={toneFor(e, own)}
          />
        );
      })}
    </>
  );
}

/** How many show before 查看全部: the podium plus three rows. */
const LEADERS_SHOWN = 6;

/**
 * 排行榜 (Ke Li picked the podium): the top three on steps, 1st in the middle with a crown,
 * the rest as rows below, so it doesn't look like the event cards above it.
 */
function Leaders(props: { board: Leaderboard }) {
  const [tab, setTab] = useState<(typeof BOARDS)[number]["key"]>(BOARDS[0].key);
  const [all, setAll] = useState(false);
  const b = BOARDS.find((x) => x.key === tab)!;
  const list = props.board[tab];
  const value = (v: number) => (
    <span class="value">
      {tab === "calories" ? kcalText(v) : v}
      <small>{t(b.unit)}</small>
    </span>
  );
  // 2nd, 1st, 3rd from left to right; a missing place stays an empty column.
  const podium = [list[1], list[0], list[2]];
  const rest = list.slice(3, all ? undefined : LEADERS_SHOWN);
  return (
    <>
      <SectionTitle>{t("{year} 年排行榜", { year: props.board.year })}</SectionTitle>
      <div class="seg board-tabs">
        {BOARDS.map((x) => (
          <button
            type="button"
            key={x.key}
            class={x.key === tab ? "on" : ""}
            onClick={() => {
              setTab(x.key);
              setAll(false);
            }}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty>{tab === "calories" ? t("还没有人加入能量榜") : t("还没有出勤记录")}</Empty>
      ) : (
        <div class="card board">
          <ol class="podium">
            {podium.map((r, i) =>
              r ? (
                <li key={r.name} class={`place p${r.rank}`}>
                  {r.rank === 1 && (
                    <span class="crown" aria-hidden="true">
                      👑
                    </span>
                  )}
                  <span class="who">{r.name}</span>
                  {value(r.value)}
                  <span class="step">{r.rank}</span>
                </li>
              ) : (
                <li key={`empty${i}`} class="place empty" aria-hidden="true" />
              ),
            )}
          </ol>
          {rest.length > 0 && (
            <ol class="board-rows">
              {rest.map((r) => (
                <li key={r.name}>
                  <span class="rank-no">{r.rank}</span>
                  <span class="who">{r.name}</span>
                  {value(r.value)}
                </li>
              ))}
            </ol>
          )}
          {list.length > LEADERS_SHOWN && (
            <button type="button" class="board-more" onClick={() => setAll(!all)}>
              {all ? t("收起") : t("查看全部 {n} 人", { n: list.length })}
            </button>
          )}
        </div>
      )}
      {tab === "calories" && <p class="muted small swipe-note">{t("在「个人信息」里加入")}</p>}
    </>
  );
}

export function Home() {
  const [home] = useApi<HomeResponse>("/api/public/home");
  const member = useMemberSession();
  const cta = t("报名");
  return (
    <Page title={useSiteTitle()} bare>
      <Load result={home}>
        {(data) => {
          const next = data.currentEvents.find((e) => e.status === "open") ?? data.currentEvents[0];
          const others = data.currentEvents.filter((e) => e !== next);
          return (
            <>
              {member === "member" && data.currentEvents.length > 0 ? (
                <MyEvents events={data.currentEvents} />
              ) : next ? (
                // Signed out: nothing on the card, 登录 / 注册 is in the top bar (Ke Li).
                <NextEvent e={next} cta={member === "pending" ? cta : null} />
              ) : (
                <>
                  {(member === "member" || member === "pending") && (
                    <a class="button block" href="/me">
                      {cta}
                    </a>
                  )}
                  <Empty>{t("暂时没有活动")}</Empty>
                </>
              )}
              {member !== "member" && others.length > 0 && (
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
              <ShareCardButton text={siteCardText(location.origin, t)} />
            </>
          );
        }}
      </Load>
    </Page>
  );
}
