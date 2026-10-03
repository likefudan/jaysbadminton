import type { MyEvent, PublicEvent } from "../../shared/types";
import { formatDateZh } from "../../shared/time";
import { Card, Load, Page } from "../components";
import { EventInfo } from "../events";
import { useApi, useMemberSession } from "../hooks";
import { EventActions } from "../ShareCard";
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
        <Page title={e.title || formatDateZh(e.date, false)} eyebrow={`${e.date.slice(0, 4)} · 羽毛球活动`}>
          {member === "member" ? (
            <MemberView e={e} />
          ) : (
            <>
              <Card>
                <EventInfo e={e} publicView />
                <EventActions e={e} />
              </Card>
              {(member === "none" || member === "loading") && <p class="muted small">登录后即可报名；新朋友请先注册入群。</p>}
              {member === "pending" && <p class="muted small">你的入群申请正在等待管理员审核，通过后就能报名。</p>}
            </>
          )}
          <a class="button block" href="/me">
            {member === "member" || member === "pending" ? "我的活动" : "登录 / 注册"}
          </a>
          <a class="button secondary block" href="/">
            所有活动
          </a>
        </Page>
      )}
    </Load>
  );
}

/** The event as it appears on the member's own page; falls back to the public card when it isn't there (e.g. long settled). */
function MemberView(props: { e: PublicEvent }) {
  const [res, reload] = useApi<{ events: MyEvent[]; friendCap: number }>("/api/m/session/events");
  const mine = res.state === "ok" ? res.data.events.find((x) => x.id === props.e.id) : undefined;
  if (res.state === "loading") return null;
  if (res.state === "ok" && mine) return <SignupCard base="/api/m/session" e={mine} cap={res.data.friendCap} onChange={reload} />;
  return (
    <Card>
      <EventInfo e={props.e} publicView />
      <EventActions e={props.e} />
    </Card>
  );
}
