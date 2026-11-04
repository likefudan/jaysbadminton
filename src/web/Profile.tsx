import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { toPacific } from "../shared/time";
import type { ActivityDay, MeResponse, MemberProfile, MyCalories } from "../shared/types";
import { checkUsername } from "../shared/rules";
import { api } from "./api";
import { Card, Field, SettingRow, useAction } from "./components";
import { ShortcutRow } from "./Calories";
import { InstallRow } from "./Install";
import { PushRow } from "./Push";
import { fmtDate, fmtDay, month, t, tk, tx } from "./i18n";

const STATUS_LABEL: Record<ActivityDay["status"], string> = {
  done: tk("已参加"),
  absent: tk("缺席"),
  upcoming: tk("已报名"),
};
const WEEKDAY_LABELS = ["", tk("一"), "", tk("三"), "", tk("五"), ""];

/** "2026年3月14日 19:05" in Pacific time. */
function formatJoined(iso: string): string {
  const p = toPacific(iso);
  return `${fmtDay(p.date)} ${p.time}`;
}

const day = (date: string) => Date.parse(`${date}T12:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86400_000;

const countOf = (activity: ActivityDay[], s: ActivityDay["status"]) => activity.filter((a) => a.status === s).length;

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
export function Heatmap(props: { activity: ActivityDay[]; summary?: boolean }) {
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

  const count = (s: ActivityDay["status"]) => countOf(props.activity, s);
  const pickedList = picked ? (byDate.get(picked) ?? []) : [];

  return (
    <div class="heatmap">
      {props.summary !== false && (
        <p class="heatmap-summary">
          {tx("过去一年参加 {done} 次 · 缺席 {absent} 次 · 即将参加 {upcoming} 次", {
            done: <strong>{count("done")}</strong>,
            absent: <strong>{count("absent")}</strong>,
            upcoming: <strong>{count("upcoming")}</strong>,
          })}
        </p>
      )}
      <div class="heatmap-body">
        <div class="heatmap-days" aria-hidden="true">
          {WEEKDAY_LABELS.map((l, i) => (
            <span key={i}>{l && t(l)}</span>
          ))}
        </div>
        <div class="heatmap-scroll" ref={scroller}>
          <div class="heatmap-months" aria-hidden="true">
            {weeks.map((w, i) => {
              const firstOfMonth = w.find((d) => d.endsWith("-01"));
              return (
                <span key={i}>{firstOfMonth || i === 0 ? month(Number((firstOfMonth ?? w[0]!).slice(5, 7))) : ""}</span>
              );
            })}
          </div>
          <div class="heatmap-grid" role="group" aria-label={t("活动热力图")}>
            {weeks.map((w, i) => (
              <div class="heatmap-week" key={i}>
                {w.map((d) => {
                  const list = byDate.get(d);
                  const status = list ? cellStatus(list) : null;
                  const label = `${fmtDate(d)}${list ? `${t("：")}${list.map((a) => `${a.title} ${t(STATUS_LABEL[a.status])}`).join(t("，"))}` : ""}`;
                  return (
                    <button
                      key={d}
                      type="button"
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
          {t("已参加")}
        </span>
        <span>
          <i class="heatmap-cell absent" />
          {t("缺席")}
        </span>
        <span>
          <i class="heatmap-cell upcoming" />
          {t("已报名")}
        </span>
      </div>
      {pickedList.length > 0 && (
        <div class="heatmap-detail">
          {pickedList.map((a) => (
            <p key={a.code}>
              <span class={`heatmap-cell ${a.status}`} />
              <strong>{fmtDate(a.date)}</strong> {a.title}
              <small>
                {a.location} · {t(STATUS_LABEL[a.status])}
              </small>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A member's 个人信息 in the admin's view: the basics, the 备注名 (editable; the member never sees
 * it) and the activity map.
 */
export function ProfileCard(props: {
  profile: MemberProfile;
  base: string;
  /** An organizer looking: the 备注名 shows, but only the Owner changes it. */
  noteReadOnly?: boolean;
  /** The 组织者 feature is on: organizers see the 备注名 too, and the label says so. */
  organizers?: boolean;
  onChange: () => void;
}) {
  const p = props.profile;
  return (
    <Card title={t("个人信息")} class="profile">
      <dl class="profile-info">
        <NoteRow
          base={props.base}
          note={p.adminNote ?? ""}
          readOnly={!!props.noteReadOnly}
          label={props.organizers ? t("备注名（只有群主、管理员和组织者能看到）") : t("备注名（只有群主能看到）")}
          onChange={props.onChange}
        />
        <div>
          <dt>{t("名字")}</dt>
          <dd>{p.username}</dd>
        </div>
        <div>
          <dt>{t("微信名")}</dt>
          <dd>{p.wechatNickname}</dd>
        </div>
        <div>
          <dt>{t("邮箱")}</dt>
          <dd>
            {p.email ?? <span class="muted">{t("未填写")}</span>}
            {p.emailFromGoogle && <small class="muted"> {t("（Google）")}</small>}
          </dd>
        </div>
        <div>
          <dt>{t("入群时间")}</dt>
          <dd>{formatJoined(p.joinedAt)}</dd>
        </div>
      </dl>
      <h3 class="profile-sub">{t("活动记录")}</h3>
      <Heatmap activity={p.activity} />
    </Card>
  );
}

/**
 * The top of a member's own 个人信息, in the accent like the next-event card on 我的活动: who they
 * are, and the year at a glance (the same counts as the activity map).
 */
export function ProfileHero(props: { profile: MemberProfile }) {
  const p = props.profile;
  const nums: [number, string][] = [
    [countOf(p.activity, "done"), t("过去一年打球")],
    [countOf(p.activity, "absent"), t("缺席")],
    [countOf(p.activity, "upcoming"), t("即将参加")],
  ];
  return (
    <section class="card ev-card tone-hero me-card">
      <div class="ev-head">
        <div class="me-top">
          <span class="me-avatar" aria-hidden="true">
            {[...p.username][0]?.toUpperCase()}
          </span>
          <div>
            <h2 class="me-name">{p.username}</h2>
            <p class="me-sub">
              {t("微信名 {name}", { name: p.wechatNickname })} ·{" "}
              {t("{date}入群", { date: fmtDay(toPacific(p.joinedAt).date) })}
            </p>
          </div>
        </div>
        <dl class="me-nums">
          {nums.map(([n, label]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{n}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** 资料与设置 on a member's own 个人信息: one row each, opening underneath to change it. */
export function ProfileSettings(props: {
  me: MeResponse;
  /** Null while it loads (or if it failed): the rest doesn't need it. */
  profile: MemberProfile | null;
  base: string;
  home: string;
  /** 卡路里快捷指令 (null while it loads). */
  shortcut: MyCalories["shortcut"] | null;
  onChange: () => void;
}) {
  const p = props.profile;
  return (
    <section class="card set-list">
      <SettingRow
        icon={<UserIcon />}
        label={t("名字")}
        value={props.me.username}
        panel={(close) => (
          <RenameForm base={props.base} current={props.me.username} onDone={props.onChange} close={close} />
        )}
      />
      {p && (
        <SettingRow
          icon={<MailIcon />}
          label={t("邮箱")}
          value={p.email ?? <span class="muted">{t("未填写")}</span>}
          panel={(close) => (
            <EmailForm
              base={props.base}
              initial={p.emailFromGoogle ? "" : (p.email ?? "")}
              fromGoogle={p.emailFromGoogle}
              onDone={props.onChange}
              close={close}
            />
          )}
        />
      )}
      <InstallRow home={props.home} />
      <PushRow base={props.base} home={props.home} memberId={props.me.id} />
      <ShortcutRow shortcut={props.shortcut} />
    </section>
  );
}

function RenameForm(props: { base: string; current: string; onDone: () => void; close: () => void }) {
  const [name, setName] = useState(props.current);
  const { busy, error, run, setError } = useAction();
  async function save(e: Event) {
    e.preventDefault();
    const err = checkUsername(name);
    if (err) return setError(err);
    if (await run(() => api(`${props.base}/rename`, { username: name }))) {
      props.close();
      props.onDone();
    }
  }
  return (
    <form onSubmit={save}>
      <Field label={t("新用户名")} value={name} onInput={setName} />
      {error && <p class="error">{error}</p>}
      <div class="inline">
        <button type="submit" class="button" disabled={busy}>
          {t("保存")}
        </button>
        <button class="button secondary" type="button" onClick={props.close}>
          {t("取消")}
        </button>
      </div>
    </form>
  );
}

function EmailForm(props: {
  base: string;
  initial: string;
  fromGoogle: boolean;
  onDone: () => void;
  close: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const { busy, error, run } = useAction();
  async function save(e: Event) {
    e.preventDefault();
    if (await run(() => api(`${props.base}/email`, { email: value }))) {
      props.close();
      props.onDone();
    }
  }
  return (
    <form onSubmit={save}>
      {props.fromGoogle && <p class="muted small">{t("现在用的是 Google 账号的邮箱。")}</p>}
      <Field label={t("邮箱")} type="email" value={value} onInput={setValue} autocomplete="email" />
      <p class="muted small">{t("留空则用 Google 邮箱")}</p>
      {error && <p class="error">{error}</p>}
      <div class="inline">
        <button type="submit" class="button" disabled={busy}>
          {t("保存")}
        </button>
        <button class="button secondary" type="button" onClick={props.close}>
          {t("取消")}
        </button>
      </div>
    </form>
  );
}

const UserIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </svg>
);
const MailIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M4 7l8 6 8-6" />
  </svg>
);

function NoteRow(props: { base: string; note: string; readOnly: boolean; label: string; onChange: () => void }) {
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
        <Field label={props.label} value={value} onInput={setValue} />
        {error && <p class="error">{error}</p>}
        <div class="inline">
          <button type="submit" class="button" disabled={busy}>
            {t("保存")}
          </button>
          <button class="button secondary" type="button" onClick={() => setEditing(false)}>
            {t("取消")}
          </button>
        </div>
      </form>
    );
  }
  return (
    <div>
      <dt>{t("备注名")}</dt>
      <dd>
        {props.note || <span class="muted">{t("未填写")}</span>}
        {!props.readOnly && (
          <button
            type="button"
            class="profile-action"
            onClick={() => {
              setValue(props.note);
              setEditing(true);
            }}
          >
            {props.note ? t("修改") : t("添加")}
          </button>
        )}
      </dd>
    </div>
  );
}
