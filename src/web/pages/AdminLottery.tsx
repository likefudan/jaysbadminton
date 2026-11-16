import { useEffect, useState } from "preact/hooks";
import {
  LOTTERY_PRIZE_ROWS,
  type LotteryAdmin,
  type LotteryPrize,
  type LotteryRehearsal,
  type LotteryView,
  checkLottery,
} from "../../shared/lottery";
import { toPacific } from "../../shared/time";
import { api } from "../api";
import { Avatar } from "../Avatar";
import { Card, Field, Load, SettingRow, useAction } from "../components";
import { useApi } from "../hooks";
import { fmtInstant, t, tm } from "../i18n";
import { LotteryShow, num3, useClock } from "../Lottery";
import { Panel } from "../Panel";

/**
 * 设置 → 抽奖 (Ke Li 2026-11-16, 百人庆祝抽奖): for the Owner and admins. Set one up, 预演 it as
 * often as needed (only the one pressing sees it, it counts for nothing: 管理员可以提前进行预演
 * 检查错误) and publish it; it draws by itself when the countdown ends. The Owner can lock it so nobody changes
 * it until they unlock it.
 */

const GiftIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <rect x="3.5" y="9" width="17" height="11.5" rx="1.5" />
    <path d="M2.5 9h19M12 9v11.5M12 9c-1.5-3-5.5-4.5-6-2s3.5 2 6 2zM12 9c1.5-3 5.5-4.5 6-2s-3.5 2-6 2z" />
  </svg>
);

/** The menu row in 设置. */
export function LotteryRow(props: { current?: boolean; onClick: () => void }) {
  return (
    <section class="card set-list">
      <SettingRow icon={<GiftIcon />} label={t("抽奖")} current={props.current} onClick={props.onClick} />
    </section>
  );
}

interface FormValue {
  title: string;
  poolSize: string;
  prizes: { name: string; count: string }[];
  drawDate: string;
  drawTime: string;
}

/** Tomorrow in Pacific time: the draw starts by itself, so the form starts on a time ahead. */
const tomorrow = () => toPacific(new Date(Date.now() + 86_400_000)).date;

const blank = (): FormValue => ({
  title: t("百人庆祝抽奖"),
  poolSize: "100",
  prizes: [{ name: "", count: "1" }],
  drawDate: tomorrow(),
  drawTime: "20:00",
});

const fromView = (v: LotteryView): FormValue => {
  const p = toPacific(v.drawAt);
  return {
    title: v.title,
    poolSize: String(v.poolSize),
    prizes: v.prizes.map((x) => ({ name: x.name, count: String(x.count) })),
    drawDate: p.date,
    drawTime: p.time,
  };
};

const toBody = (f: FormValue) => ({
  title: f.title,
  poolSize: Number(f.poolSize),
  prizes: f.prizes.map((p) => ({ name: p.name.trim(), count: Number(p.count) })) as LotteryPrize[],
  drawDate: f.drawDate,
  drawTime: f.drawTime,
});

export function LotteryPage(props: { base: string }) {
  const [size, setSize] = useState(100);
  const [res, reload] = useApi<LotteryAdmin>(`${props.base}/lottery?size=${size}`);
  const [rehearsal, setRehearsal] = useState<LotteryRehearsal | null>(null);
  return (
    <Load result={res}>
      {(d) => (
        <>
          {d.current ? (
            <Current base={props.base} d={d} view={d.current} reload={reload} onRehearse={setRehearsal} />
          ) : (
            <Setup base={props.base} d={d} onSize={setSize} reload={reload} onRehearse={setRehearsal} />
          )}
          {rehearsal && <Rehearsal r={rehearsal} onClose={() => setRehearsal(null)} />}
        </>
      )}
    </Load>
  );
}

function LotteryForm(props: {
  value: FormValue;
  onChange: (f: FormValue) => void;
  /** The list is locked once published: its size can't change. */
  sizeFixed?: boolean;
}) {
  const f = props.value;
  const set = (patch: Partial<FormValue>) => props.onChange({ ...f, ...patch });
  const setPrize = (i: number, patch: Partial<FormValue["prizes"][number]>) =>
    set({ prizes: f.prizes.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <>
      <Field label={t("名字")} value={f.title} onInput={(v) => set({ title: v })} />
      {!props.sizeFixed && (
        <Field
          label={t("参加的人：前多少名入群的")}
          type="number"
          value={f.poolSize}
          onInput={(v) => set({ poolSize: v })}
          hint={t("按入群通过的先后算，群主和管理员也算，已停用的成员保留名次。")}
        />
      )}
      <div class="field">
        <span>{t("奖品（按开奖顺序，压轴的放最后）")}</span>
        {f.prizes.map((p, i) => (
          <div class="lot-prize-row" key={i}>
            <input
              type="text"
              value={p.name}
              placeholder={t("例如：黑航空 一桶")}
              aria-label={t("奖品名称")}
              onInput={(e) => setPrize(i, { name: (e.target as HTMLInputElement).value })}
            />
            <span class="muted">×</span>
            <input
              type="number"
              min={1}
              value={p.count}
              aria-label={t("数量")}
              onInput={(e) => setPrize(i, { count: (e.target as HTMLInputElement).value })}
            />
            {f.prizes.length > 1 && (
              <button
                type="button"
                class="link-button"
                aria-label={t("删除")}
                onClick={() => set({ prizes: f.prizes.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {f.prizes.length < LOTTERY_PRIZE_ROWS && (
          <button
            type="button"
            class="link-button"
            onClick={() => set({ prizes: [...f.prizes, { name: "", count: "1" }] })}
          >
            {t("＋ 再加一种奖品")}
          </button>
        )}
      </div>
      <div class="lot-when">
        <Field label={t("开奖日期")} type="date" value={f.drawDate} onInput={(v) => set({ drawDate: v })} />
        <Field label={t("开奖时间")} type="time" value={f.drawTime} onInput={(v) => set({ drawTime: v })} />
      </div>
    </>
  );
}

/** Before publishing: the form, the list it would lock, 预演 and 公布抽奖. */
function Setup(props: {
  base: string;
  d: LotteryAdmin;
  onSize: (n: number) => void;
  reload: () => void;
  onRehearse: (r: LotteryRehearsal) => void;
}) {
  const [f, setF] = useState<FormValue>(blank);
  const [list, setList] = useState(false);
  // Those among the first N who won't take part (Ke Li 2026-11-16: 手动选择).
  const [off, setOff] = useState<string[]>([]);
  const act = useAction();
  const n = Number(f.poolSize);
  // The preview follows the size typed, a moment after typing stops.
  useEffect(() => {
    if (!Number.isInteger(n) || n < 1 || n > 1000) return;
    const id = setTimeout(() => props.onSize(n), 400);
    return () => clearTimeout(id);
  }, [n]);
  const check = () => {
    const b = toBody(f);
    const err = checkLottery(b);
    if (err) throw new Error(tm(err));
    return { ...b, exclude: off };
  };
  const rehearse = async () => {
    const r = await act.run(() => api<LotteryRehearsal>(`${props.base}/lottery/rehearse`, check()));
    if (r) props.onRehearse(r);
  };
  const publish = async () => {
    if (!confirm(t("公布后名单就锁定了，大家会收到推送。确定公布吗？"))) return;
    if (await act.run(() => api(`${props.base}/lottery`, check()))) props.reload();
  };
  const all = props.d.preview;
  const preview = all.filter((e) => !off.includes(e.id));
  const out = all.length - preview.length;
  return (
    <>
      <Card title={t("新的抽奖")}>
        <LotteryForm value={f} onChange={setF} />
      </Card>
      <Card title={t("名单（公布时锁定）")}>
        <p>
          {t("现在的前 {n} 名：{k} 人", { n: Number.isInteger(n) ? n : 0, k: all.length })}
          {all.length < n && <span class="muted"> {t("（群里一共只有 {k} 人）", { k: props.d.members })}</span>}
          {out > 0 && <span>{t("，去掉 {x} 人，{k} 人参加", { x: out, k: preview.length })}</span>}
        </p>
        <div class="lot-faces">
          {preview.slice(0, 12).map((e) => (
            <Avatar key={e.rank} src={e.avatar} size={28} />
          ))}
          {preview.length > 12 && <span class="muted small">+{preview.length - 12}</span>}
        </div>
        <button type="button" class="link-button" onClick={() => setList(true)}>
          {t("查看名单，选不参加的人")}
        </button>
        <p class="muted small">
          {t("开了推送的成员：{n} 人。公布、开奖前半小时和开奖时会推送给他们。", { n: props.d.pushMembers })}
        </p>
      </Card>
      {act.error && <p class="error">{act.error}</p>}
      <button type="button" class="button secondary block" disabled={act.busy} onClick={rehearse}>
        {t("预演一遍（只有你看得到）")}
      </button>
      <button type="button" class="button block" disabled={act.busy} onClick={publish}>
        {t("公布抽奖")}
      </button>
      {list && <ListPanel entries={all} off={off} onChange={setOff} onClose={() => setList(false)} />}
    </>
  );
}

/**
 * The list, and who of it won't take part: ticked off by hand while it can still change (before
 * publishing, or published and not locked); afterwards only to look at.
 */
function ListPanel(props: {
  entries: LotteryView["entries"];
  off: string[];
  onChange?: (off: string[]) => void;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
}) {
  const { off, onChange } = props;
  const taking = props.entries.length - props.entries.filter((e) => off.includes(e.id)).length;
  return (
    <Panel title={t("抽奖名单")} label={t("抽奖名单")} onClose={props.onClose}>
      <section class="card">
        <p>
          {t("{k} 人参加", { k: taking })}
          {taking < props.entries.length && (
            <span class="muted"> {t("· {x} 人不参加", { x: props.entries.length - taking })}</span>
          )}
        </p>
        {onChange && <p class="muted small">{t("去掉勾的人不参加抽奖，号码不变，也不会有别人补上。")}</p>}
        {props.error && <p class="error">{props.error}</p>}
        <ol class="lot-list">
          {props.entries.map((e) => {
            const out = off.includes(e.id);
            return (
              <li key={e.rank} class={out ? "out" : ""}>
                {onChange && (
                  <input
                    type="checkbox"
                    checked={!out}
                    disabled={props.busy}
                    aria-label={t("{name} 参加", { name: e.name })}
                    onChange={() => onChange(out ? off.filter((id) => id !== e.id) : [...off, e.id])}
                  />
                )}
                <span class="lot-no">{num3(e.rank)}</span>
                <Avatar src={e.avatar} size={24} />
                <span>{e.name}</span>
                {out && <span class="lot-out">{t("不参加")}</span>}
              </li>
            );
          })}
        </ol>
      </section>
    </Panel>
  );
}

/** Published (or drawn): where it stands, and what can be done. */
function Current(props: {
  base: string;
  d: LotteryAdmin;
  view: LotteryView;
  reload: () => void;
  onRehearse: (r: LotteryRehearsal) => void;
}) {
  const v = props.view;
  const [editing, setEditing] = useState<FormValue | null>(null);
  const [watch, setWatch] = useState(false);
  const [list, setList] = useState(false);
  const act = useAction();
  const post = async (path: string, body: unknown = {}) => {
    if (await act.run(() => api(`${props.base}/lottery/${v.id}/${path}`, body))) {
      props.reload();
      return true;
    }
    return false;
  };
  const rehearse = async () => {
    const r = await act.run(() => api<LotteryRehearsal>(`${props.base}/lottery/rehearse`, {}));
    if (r) props.onRehearse(r);
  };
  const open = v.status === "open";
  return (
    <>
      <Card title={v.title}>
        <p>
          <span class={open ? "lot-status" : "lot-status done"}>{open ? t("已公布") : t("已开奖")}</span>{" "}
          {v.locked && <span class="lot-status locked">{t("🔒 群主已锁定")}</span>}
        </p>
        <p>
          {open
            ? t("{time} 倒计时结束自动开奖", { time: fmtInstant(v.drawAt) })
            : t("{time} 开的奖", { time: fmtInstant(v.drawAt) })}
        </p>
        <p class="muted small">
          {t("名单 {n} 人 · 奖品 {k} 份 · {w} 人在看", { n: v.entries.length, k: v.draws, w: v.watching })}
          {props.d.excluded.length > 0 && t(" · {x} 人不参加", { x: props.d.excluded.length })}
        </p>
        <p class="muted small">{v.prizes.map((p) => `${p.name} ×${p.count}`).join(t("、"))}</p>
        <p class="lot-code">
          {t("指纹")} {v.seedHash.slice(0, 16)}…
        </p>
        <button type="button" class="link-button" onClick={() => setList(true)}>
          {open && !v.locked ? t("查看名单，选不参加的人") : t("查看完整名单（{n} 人）", { n: v.entries.length })}
        </button>
      </Card>
      {act.error && <p class="error">{act.error}</p>}
      {open ? (
        <>
          <button type="button" class="button block" onClick={() => setWatch(true)}>
            {t("看倒计时")}
          </button>
          <button type="button" class="button secondary block" disabled={act.busy} onClick={rehearse}>
            {t("预演一遍（只有你看得到）")}
          </button>
          <button
            type="button"
            class="button secondary block"
            disabled={act.busy || v.locked}
            onClick={() => setEditing(fromView(v))}
          >
            {t("修改时间和奖品")}
          </button>
          {props.d.canLock && (
            <button
              type="button"
              class="button secondary block"
              disabled={act.busy}
              onClick={() => post(v.locked ? "unlock" : "lock")}
            >
              {v.locked ? t("解锁") : t("锁定（锁定后谁都不能改时间、奖品或取消）")}
            </button>
          )}
          {v.locked && !props.d.canLock && <p class="muted small">{t("群主锁定了这个抽奖，要改请找群主解锁。")}</p>}
          <button
            type="button"
            class="button secondary block danger"
            disabled={act.busy || v.locked}
            onClick={() => confirm(t("取消这个抽奖？")) && post("cancel")}
          >
            {t("取消抽奖")}
          </button>
        </>
      ) : (
        <>
          <button type="button" class="button block" onClick={() => setWatch(true)}>
            {t("看开奖")}
          </button>
          <button
            type="button"
            class="button secondary block"
            disabled={act.busy}
            onClick={() => confirm(t("从大家的「我的活动」里收起这次的结果？")) && post("hide")}
          >
            {t("从我的活动收起")}
          </button>
        </>
      )}
      {editing && (
        <Panel title={t("修改抽奖")} label={t("修改抽奖")} onClose={() => setEditing(null)}>
          <Card>
            <LotteryForm value={editing} onChange={setEditing} sizeFixed />
            {act.error && <p class="error">{act.error}</p>}
            <button
              type="button"
              class="button block"
              disabled={act.busy}
              onClick={async () => (await post("edit", toBody(editing))) && setEditing(null)}
            >
              {t("保存")}
            </button>
          </Card>
        </Panel>
      )}
      {watch && <Watch base={props.base} first={v} onClose={() => setWatch(false)} />}
      {list && (
        <ListPanel
          entries={[...v.entries, ...props.d.excluded].sort((a, b) => a.rank - b.rank)}
          off={props.d.excluded.map((e) => e.id)}
          onChange={open && !v.locked ? (off) => void post("exclude", { exclude: off }) : undefined}
          busy={act.busy}
          error={act.error}
          onClose={() => setList(false)}
        />
      )}
    </>
  );
}

/** 看开奖 on the 管理页: the same page as members', asked again every 2 seconds. */
function Watch(props: { base: string; first: LotteryView; onClose: () => void }) {
  const [view, setView] = useState(props.first);
  const clock = useClock(view);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<LotteryAdmin>(`${props.base}/lottery`)
        .then((d) => alive && d.current && setView(d.current))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [props.base]);
  return (
    <Panel title={view.title} label={view.title} onClose={props.onClose}>
      <LotteryShow view={view} clock={clock} />
    </Panel>
  );
}

/** 预演: the draw as everyone will see it, then what the checks found. */
function Rehearsal(props: { r: LotteryRehearsal; onClose: () => void }) {
  const { view, checks: c } = props.r;
  const clock = useClock(view);
  const ok = (good: boolean) => (good ? "✓" : "⚠️");
  return (
    <Panel title={t("预演")} label={t("预演")} onClose={props.onClose}>
      <LotteryShow view={view} clock={clock} />
      <Card title={t("检查结果")}>
        <ul class="lot-checks">
          <li>
            {ok(c.entries + c.excluded === c.poolSize)}{" "}
            {c.entries + c.excluded === c.poolSize
              ? t("名单 {n} 人，人数够", { n: c.entries })
              : t("名单只有 {n} 人，不到 {size} 人", { n: c.entries + c.excluded, size: c.poolSize })}
            {c.excluded > 0 && t("（{x} 人不参加）", { x: c.excluded })}
          </li>
          <li>
            {ok(c.noAvatar === 0)}{" "}
            {c.noAvatar === 0 ? t("每个人都有头像") : t("{n} 人没有头像，墙上显示名字的第一个字", { n: c.noAvatar })}
          </li>
          <li>
            {ok(c.myDevices > 0)}{" "}
            {c.myDevices > 0
              ? t("预演推送已发到你的 {n} 台设备，看看收到没有", { n: c.myDevices })
              : t("你还没开推送，收不到预演推送")}
          </li>
          <li>
            {ok(c.telegram)}{" "}
            {c.telegram
              ? t("预演结果已发到你的 Telegram，里面有可复制到微信的文字")
              : t("Telegram 没发出去（没绑定或机器人没设置）")}
          </li>
          <li>
            {ok(c.pushMembers > 0)} {t("开了推送的成员：{n} 人", { n: c.pushMembers })}
          </li>
        </ul>
        <p class="muted small">
          {t("这次预演用的是另一个随机数，和正式开奖的结果没有关系；别人看不到，也收不到通知。")}
        </p>
      </Card>
    </Panel>
  );
}
