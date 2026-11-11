import { useState } from "preact/hooks";
import type { EventLikes, MyEvent } from "../shared/types";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { Load, useAction } from "./components";
import { useApi } from "./hooks";
import { t, tx } from "./i18n";
import { Panel } from "./Panel";

export const HeartIcon = (props: { size?: number; filled?: boolean }) => (
  <svg class="heart" viewBox="0 0 24 24" width={props.size ?? 18} height={props.size ?? 18} aria-hidden="true">
    <path
      fill={props.filled === false ? "none" : "currentColor"}
      stroke="currentColor"
      stroke-width={props.filled === false ? 2 : 0}
      stroke-linejoin="round"
      d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.4 4c2 0 3.6 1.1 4.6 2.7C13 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.4z"
    />
  </svg>
);

/**
 * 点赞 at the foot of an event card (Ke Li 2026-11-11): once it is over, likes for others who
 * played, up to a share of them, for some hours (both in 设置). Anonymous (her pick): they see how many they got, never from whom.
 */
export function LikeRow(props: { base: string; e: MyEvent; onChange: () => void }) {
  const l = props.e.likes;
  const [open, setOpen] = useState(false);
  if (!l || (!l.open && l.received === 0 && l.given === 0)) return null;
  return (
    <div class="kcal-foot like-foot">
      <div class="kcal-row like-row">
        <HeartIcon filled={l.received > 0} />
        <span class="kcal-text">
          {l.received > 0
            ? tx("收到 {n} 个赞", { n: <b class="kcal-num">{l.received}</b> })
            : l.open
              ? t("给一起打球的人点个赞")
              : t("这场没有收到赞")}
          <small>
            {l.given > 0
              ? t("你点了 {n} 个赞", { n: l.given })
              : l.open
                ? t("这场最多 {n} 个，匿名", { n: l.max })
                : t("你没有点赞")}
          </small>
        </span>
        {l.open &&
          (l.given > 0 ? (
            <button type="button" class="link-button" onClick={() => setOpen(true)}>
              {t("修改")}
            </button>
          ) : (
            <button type="button" class="button secondary" onClick={() => setOpen(true)}>
              {t("点个赞")}
            </button>
          ))}
      </div>
      {open && (
        <LikePanel
          base={props.base}
          eventId={props.e.id}
          onClose={() => {
            setOpen(false);
            props.onChange();
          }}
        />
      )}
    </div>
  );
}

function LikePanel(props: { base: string; eventId: number; onClose: () => void }) {
  const url = `${props.base}/events/${props.eventId}/likes`;
  const [res] = useApi<EventLikes>(url);
  return (
    <Panel title={t("点赞")} label={t("点赞")} onClose={props.onClose}>
      <Load result={res}>{(d) => <LikePicker url={url} initial={d} />}</Load>
    </Panel>
  );
}

function LikePicker(props: { url: string; initial: EventLikes }) {
  const [d, setD] = useState(props.initial);
  const { busy, error, run } = useAction();
  // Fewer than given once the share or the players change: none left, the likes given stay.
  const left = Math.max(0, d.max - d.given);
  async function toggle(id: string, on: boolean) {
    const next = await run(() => api<EventLikes>(props.url, { to: id, on }));
    if (next) setD(next);
  }
  return (
    <div class="like-panel">
      <p class="like-intro">
        {t("给这场打得开心的球友点个赞，最多 {n} 个。对方只看到收到几个赞，不会知道是谁点的。", { n: d.max })}
      </p>
      <p class="like-left">
        {d.open
          ? left > 0
            ? tx("还能点 {n} 个", { n: <b>{left}</b> })
            : t("{n} 个赞都点完了，点已赞的人可以撤回", { n: d.given })
          : t("点赞已截止，活动结束后 {n} 小时内可以点赞", { n: d.hours })}
      </p>
      {error && <p class="error">{error}</p>}
      {d.people.length === 0 ? (
        <p class="muted">{t("这场没有其他人可以点赞")}</p>
      ) : (
        <ul class="like-grid">
          {d.people.map((p) => {
            const full = !p.liked && left <= 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  class={`like-person${p.liked ? " on" : ""}`}
                  aria-pressed={p.liked}
                  disabled={busy || !d.open || full}
                  onClick={() => toggle(p.id, !p.liked)}
                >
                  <span class="like-face">
                    <Avatar src={p.avatar} size={56} />
                    <span class="like-badge">
                      <HeartIcon size={14} filled={p.liked} />
                    </span>
                  </span>
                  <span class="like-name">{p.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
