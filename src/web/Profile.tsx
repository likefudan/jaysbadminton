import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatDateZh, toPacific } from "../shared/time";
import type { ActivityDay, MemberProfile } from "../shared/types";
import { api } from "./api";
import { Card, Field, useAction } from "./components";

const STATUS_LABEL: Record<ActivityDay["status"], string> = { done: "已参加", absent: "缺席", upcoming: "已报名" };
const WEEKDAY_LABELS = ["", "一", "", "三", "", "五", ""];

/** "2026年3月14日 19:05" in Pacific time. */
function formatJoined(iso: string): string {
  const p = toPacific(iso);
  const [y, m, d] = p.date.split("-").map(Number);
  return `${y}年${m}月${d}日 ${p.time}`;
}

const day = (date: string) => Date.parse(`${date}T12:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86400_000;

/** One cell's colour when a day has several events: anything still ahead wins, then attended. */
function cellStatus(list: ActivityDay[]): ActivityDay["status"] {
  if (list.some((a) => a.status === "upcoming")) return "upcoming";
  if (list.some((a) => a.status === "done")) return "done";
  return "absent";
}

/**
 * GitHub-style map: one column per week (Sunday on top), about a year back to today, stretched to
 * the last event already signed up for. Tapping a coloured day shows what it was.
 */
export function Heatmap(props: { activity: ActivityDay[] }) {
  const today = toPacific(new Date()).date;
  const byDate = new Map<string, ActivityDay[]>();
  for (const a of props.activity) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  const last = props.activity.reduce((max, a) => (a.date > max ? a.date : max), today);
  const endT = day(last) + (6 - new Date(day(last)).getUTCDay()) * DAY;
  const firstT = day(today) - 52 * 7 * DAY;
  const startT = firstT - new Date(firstT).getUTCDay() * DAY;

  const weeks: string[][] = [];
  for (let t = startT; t <= endT; t += 7 * DAY) weeks.push(Array.from({ length: 7 }, (_, i) => iso(t + i * DAY)));

  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, []);

  const count = (s: ActivityDay["status"]) => props.activity.filter((a) => a.status === s).length;
  const pickedList = picked ? (byDate.get(picked) ?? []) : [];

  return (
    <div class="heatmap">
      <p class="heatmap-summary">
        过去一年参加 <strong>{count("done")}</strong> 次 · 缺席 <strong>{count("absent")}</strong> 次 · 即将参加{" "}
        <strong>{count("upcoming")}</strong> 次
      </p>
      <div class="heatmap-body">
        <div class="heatmap-days" aria-hidden="true">
          {WEEKDAY_LABELS.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        <div class="heatmap-scroll" ref={scroller}>
          <div class="heatmap-months" aria-hidden="true">
            {weeks.map((w, i) => {
              const firstOfMonth = w.find((d) => d.endsWith("-01"));
              return (
                <span key={i}>{firstOfMonth || i === 0 ? `${Number((firstOfMonth ?? w[0]!).slice(5, 7))}月` : ""}</span>
              );
            })}
          </div>
          <div class="heatmap-grid" role="grid" aria-label="活动热力图">
            {weeks.map((w, i) => (
              <div class="heatmap-week" key={i} role="row">
                {w.map((d) => {
                  const list = byDate.get(d);
                  const status = list ? cellStatus(list) : null;
                  const label = `${formatDateZh(d)}${list ? `：${list.map((a) => `${a.title} ${STATUS_LABEL[a.status]}`).join("，")}` : ""}`;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="gridcell"
                      class={`heatmap-cell${status ? ` ${status}` : ""}${d > today && !list ? " future" : ""}${picked === d ? " picked" : ""}`}
                      title={label}
                      aria-label={label}
                      disabled={!list}
                      onClick={() => setPicked(picked === d ? null : d)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div class="heatmap-legend">
        <span>
          <i class="heatmap-cell done" />
          已参加
        </span>
        <span>
          <i class="heatmap-cell absent" />
          缺席
        </span>
        <span>
          <i class="heatmap-cell upcoming" />
          已报名
        </span>
      </div>
      {pickedList.length > 0 && (
        <div class="heatmap-detail">
          {pickedList.map((a) => (
            <p key={a.code}>
              <span class={`heatmap-cell ${a.status}`} />
              <strong>{formatDateZh(a.date)}</strong> {a.title}
              <small>
                {a.location} · {STATUS_LABEL[a.status]}
              </small>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 个人信息: the basics and the activity map. On the member's own page the email is editable; in the
 * admin's view the 备注名 is (the member never sees it).
 */
export function ProfileCard(props: {
  profile: MemberProfile;
  base: string;
  mode: "member" | "admin";
  onChange: () => void;
}) {
  const p = props.profile;
  return (
    <Card title="个人信息" class="profile">
      <dl class="profile-info">
        {props.mode === "admin" && <NoteRow base={props.base} note={p.adminNote ?? ""} onChange={props.onChange} />}
        <div>
          <dt>名字</dt>
          <dd>{p.username}</dd>
        </div>
        <div>
          <dt>微信名</dt>
          <dd>{p.wechatNickname}</dd>
        </div>
        {props.mode === "member" ? (
          <EmailRow base={props.base} email={p.email} fromGoogle={p.emailFromGoogle} onChange={props.onChange} />
        ) : (
          <div>
            <dt>邮箱</dt>
            <dd>
              {p.email ?? <span class="muted">未填写</span>}
              {p.emailFromGoogle && <small class="muted"> （Google）</small>}
            </dd>
          </div>
        )}
        <div>
          <dt>入群时间</dt>
          <dd>{formatJoined(p.joinedAt)}</dd>
        </div>
      </dl>
      <h3 class="profile-sub">活动记录</h3>
      <Heatmap activity={p.activity} />
    </Card>
  );
}

function EmailRow(props: { base: string; email: string | null; fromGoogle: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const { busy, error, run } = useAction();
  async function save(e: Event) {
    e.preventDefault();
    if (await run(() => api(`${props.base}/email`, { email: value }))) {
      setEditing(false);
      props.onChange();
    }
  }
  if (editing) {
    return (
      <form class="profile-edit" onSubmit={save}>
        <Field label="邮箱" type="email" value={value} onInput={setValue} autocomplete="email" />
        <p class="muted small">留空保存会改回 Google 账号的邮箱（如果有）。</p>
        {error && <p class="error">{error}</p>}
        <div class="inline">
          <button class="button" disabled={busy}>
            保存
          </button>
          <button class="button secondary" type="button" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      </form>
    );
  }
  return (
    <div>
      <dt>邮箱</dt>
      <dd>
        {props.email ?? <span class="muted">未填写</span>}
        {props.fromGoogle && <small class="muted"> （Google）</small>}
        <button
          class="profile-action"
          onClick={() => {
            setValue(props.fromGoogle ? "" : (props.email ?? ""));
            setEditing(true);
          }}
        >
          {props.email ? "修改" : "填写"}
        </button>
      </dd>
    </div>
  );
}

function NoteRow(props: { base: string; note: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.note);
  const { busy, error, run } = useAction();
  async function save(e: Event) {
    e.preventDefault();
    if (await run(() => api(`${props.base}/note`, { note: value }))) {
      setEditing(false);
      props.onChange();
    }
  }
  if (editing) {
    return (
      <form class="profile-edit" onSubmit={save}>
        <Field label="备注名（只有管理员能看到）" value={value} onInput={setValue} />
        {error && <p class="error">{error}</p>}
        <div class="inline">
          <button class="button" disabled={busy}>
            保存
          </button>
          <button class="button secondary" type="button" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      </form>
    );
  }
  return (
    <div>
      <dt>备注名</dt>
      <dd>
        {props.note || <span class="muted">未填写</span>}
        <button
          class="profile-action"
          onClick={() => {
            setValue(props.note);
            setEditing(true);
          }}
        >
          {props.note ? "修改" : "添加"}
        </button>
      </dd>
    </div>
  );
}
