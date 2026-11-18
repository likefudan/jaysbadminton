import type { ComponentChildren, Ref } from "preact";
import { useRef } from "preact/hooks";
import { Card, CopyButton } from "../components";
import { type Loaded, useApi } from "../hooks";
import type { TelegramStatus } from "./AdminTelegram";
import { t, tx, fmtInstant } from "../i18n";

interface Status {
  venmo: boolean;
  telegram: boolean;
  sheets: boolean;
  email: { lastAt: string | null; outcome: string | null };
}

/**
 * Loads what is already set up, so the checklist can tick itself. The Telegram status is the one the
 * Telegram card on the same page holds, so connecting there ticks it here.
 */
function useStatus(base: string, telegram: Loaded<TelegramStatus>): Status | null {
  const [settings] = useApi<{ venmoUsername: string; venmoEmail: string }>(`${base}/settings`);
  const [sheets] = useApi<{ enabled: boolean }>(`${base}/sheets`);
  const [email] = useApi<Status["email"]>(`${base}/email-status`);
  if (settings.state !== "ok" || telegram.state !== "ok" || sheets.state !== "ok" || email.state !== "ok") return null;
  return {
    venmo: !!settings.data.venmoUsername && !!settings.data.venmoEmail,
    telegram: telegram.data.connected,
    sheets: sheets.data.enabled,
    email: email.data,
  };
}

/**
 * One line of 开始使用: a tick, what to do, a few words on why, and (while it is not done) a button
 * that goes straight to that setting (Ke Li 2026-11-13: the paths used to be spelled out in brackets).
 */
function Step(props: {
  done?: boolean;
  optional?: boolean;
  name: string;
  why: string;
  go?: () => void;
  /** 去设置 unless the button does something else (看步骤). */
  goLabel?: string;
}) {
  return (
    <li class={props.done ? "done" : ""}>
      <span class="tick">{props.done ? "✓" : ""}</span>
      <div class="ck-text">
        <b>{props.name}</b>
        {props.optional && <span class="badge">{t("可选")}</span>}
        <small>{props.why}</small>
      </div>
      {!props.done && props.go && (
        <button type="button" class="ck-go" onClick={props.go}>
          {props.goLabel ?? t("去设置")} ›
        </button>
      )}
    </li>
  );
}

/** 开始使用 · 还差 N 步, over the checklist; undefined while the statuses are loading. */
function Progress(props: { left: number | undefined }) {
  return (
    <h3 class="guide-head">
      {t("开始使用")}
      {props.left !== undefined && (
        <small class={props.left ? "" : "ok"}>
          {props.left ? t(" · 还差 {n} 步", { n: props.left }) : t(" · 都做好了 ✓")}
        </small>
      )}
    </h3>
  );
}

/** A question of 怎么做, closed until tapped. */
function Section(props: { title: string; r?: Ref<HTMLDetailsElement>; children: ComponentChildren }) {
  return (
    <details class="guide-section" ref={props.r}>
      <summary>{props.title}</summary>
      <div class="guide-body">{props.children}</div>
    </details>
  );
}

/** A how-to: a few short numbered steps. */
function Steps(props: { children: ComponentChildren[] }) {
  return (
    <ol class="steps">
      {props.children.filter(Boolean).map((c, i) => (
        <li key={i}>{c}</li>
      ))}
    </ol>
  );
}

/** 办一场活动, the same for everyone who runs one. */
function RunAnEvent(props: { deadlineWhere: string }) {
  return (
    <Section title={t("办一场活动")}>
      <Steps>
        {t("「活动」里点「＋ 新建活动」，选日期和场馆，点「创建活动」。")}
        {t("点「复制活动链接」，发到微信群，大家点开就能报名。")}
        {t("订好场地后，在活动页的「预定场地」填上场号。报名的人开始前 10 分钟会收到提醒。")}
        {t("有人临时要来：点名单右上角的「＋ 添加」。")}
        {t("打完球，填场地费和用球数，先点「预览每人金额」，再点「结算费用」，每个人就收到账单。")}
        {t("大家用 Venmo 付款，系统自动记账。全部付清后活动自动归档。")}
      </Steps>
      <p class="muted small">
        {t("没结算的话每 30 分钟提醒你一次。超过结算期限（默认 48 小时{where}）活动自动归档，不再收费。", {
          where: props.deadlineWhere,
        })}
      </p>
    </Section>
  );
}

/** The how-tos every event runner shares, after 办一场活动. */
function EventHowTos(props: { admin: boolean }) {
  return (
    <>
      <Section title={t("这场不收钱，到场自付")}>
        <Steps>
          {t("新建活动时关掉「需要收款 + 自动对账」。")}
          {t("每个人到球馆自己付钱。活动结束 1 小时后自动结束，不用结算。")}
        </Steps>
      </Section>
      <Section title={t("有人付了钱，系统没记上")}>
        <Steps>
          {t("Venmo 付款：到「收款 › 待确认」找到那一笔，点「关联」，选他的账单。")}
          {t("Zelle 或现金：在活动页他的账单上点「标记已付」。")}
          {t("最常见的原因是付款备注里没带付款编号，提醒大家照付款页上的编号填。")}
        </Steps>
      </Section>
      <Section title={t("用球场排队")}>
        <Steps>
          {t("新建活动时打开「排队系统」，填每轮多少分钟。同一个场馆下次会记住。")}
          {t("大家在活动页的「球馆账号」里加自己的账号，在球场上登记在打或排队。")}
          {props.admin
            ? t("空着的账号太多时页面会提醒，比例在「设置 › 高级设置 › 空闲账号提醒」里改。")
            : t("空着的账号太多时页面会提醒你。")}
        </Steps>
      </Section>
    </>
  );
}

/**
 * Setting up Venmo 邮件转发: the same Gmail filter for the Owner and for organizers, pointed at the
 * one forwarding address. `confirm` is the step about Gmail's confirmation email, which differs.
 */
export function ForwardingSteps(props: { confirm: ComponentChildren; otherMail?: boolean; test?: ComponentChildren }) {
  const forward = `venmo@${location.hostname}`;
  return (
    <ol class="steps">
      <li>
        {tx("Venmo App →「Settings → Notifications」，确认收款（You receive a payment）的{b}是打开的。", {
          b: <b>{t("邮件通知")}</b>,
        })}
      </li>
      <li>
        {t("电脑上打开 Gmail →「设置 ⚙ → 查看所有设置 → 转发和 POP/IMAP → 添加转发地址」，填：")}
        <div class="inline-copy">
          <code>{forward}</code> <CopyButton text={forward} label={t("复制")} />
        </div>
      </li>
      <li>{props.confirm}</li>
      <li>
        {tx(
          "回到 Gmail，在搜索框输入 {code} → 点搜索框右边的「显示搜索选项」→「创建过滤器」→ 勾选「转发到」并选择上面的地址（建议同时加一个「Venmo」标签，{b}勾删除）→ 创建过滤器。",
          { code: <code>from:venmo@venmo.com</code>, b: <b>{t("不要")}</b> },
        )}
      </li>
      {props.otherMail && (
        <li>
          {t(
            "Venmo 通知邮箱不是 Gmail 的话（例如 Outlook），在那个邮箱里设一条规则，把 venmo@venmo.com 发来的邮件自动转发到上面的地址。",
          )}
        </li>
      )}
      <li>
        {props.test ??
          tx("{b}：请朋友用 Venmo 付你 $1（备注随便写，之后退回），过一两分钟刷新本页，看下面的「转发状态」。", {
            b: <b>{t("测试")}</b>,
          })}
      </li>
    </ol>
  );
}

/** 使用指南 (the Owner's): what is left to set up, then how to do each thing. */
export function AdminGuide(props: {
  base: string;
  telegram: Loaded<TelegramStatus>;
  /** Opens one of 设置's sub-pages. */
  go: (sub: "pay" | "advanced" | "sheets") => void;
}) {
  const s = useStatus(props.base, props.telegram);
  const organizers = props.telegram.state === "ok" && props.telegram.data.organizers;
  const join = `${location.origin}/login`; // 登录 / 注册: Google
  const admin = `${location.origin}/admin`;
  const venmo = useRef<HTMLDetailsElement>(null);
  const showVenmo = () => {
    if (!venmo.current) return;
    venmo.current.open = true;
    venmo.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Google 表格同步 is optional and doesn't count.
  const left = s ? [s.venmo, s.telegram, !!s.email.lastAt].filter((d) => !d).length : undefined;

  return (
    <Card title={t("使用指南")}>
      <Progress left={left} />
      <ol class="checklist">
        <Step done={s?.venmo} name={t("填写收款设置")} why={t("成员把钱付到这个 Venmo")} go={() => props.go("pay")} />
        <Step
          done={s?.telegram}
          name={t("连接 Telegram")}
          why={t("提醒和收款异常发到这里，忘了管理链接也靠它找回")}
          go={() => props.go("advanced")}
        />
        <Step
          done={s ? !!s.email.lastAt : undefined}
          name={t("设置 Venmo 邮件转发")}
          why={t("成员付款后自动记账")}
          go={showVenmo}
          goLabel={t("看步骤")}
        />
        <Step
          done={s?.sheets}
          optional
          name={t("Google 表格同步")}
          why={t("每天把数据备份到你自己的表格")}
          go={() => props.go("sheets")}
        />
      </ol>

      <h3 class="guide-head">{t("怎么做")}</h3>
      <Section title={t("邀请成员")}>
        <Steps>
          <>
            {t("把登录页发到微信群：")}
            <div class="inline-copy">
              <code>{join}</code> <CopyButton text={join} label={t("复制")} />
            </div>
          </>
          {t("新成员点「登录 / 注册」，用 Google 账号申请。")}
          {t("你在「成员」最上面的待审核申请里点「通过」，对方用 Google 登录就能报名。")}
          {t("不想每个都审：在「设置 › 入群和报名」打开「入群不需要审核」。")}
        </Steps>
      </Section>
      <RunAnEvent deadlineWhere={t("，在「设置 › 收款设置」里改")} />
      <EventHowTos admin />
      <Section title={t("Venmo 自动记账（邮件转发）")} r={venmo}>
        <p class="small">
          {t(
            "系统读 Venmo 发来的收款通知邮件，按备注里的付款编号记账。你的邮箱密码系统拿不到，只是让 Gmail 把 Venmo 的邮件转过来；和羽毛球无关的收款会被忽略，不保存。",
          )}
        </p>
        <ForwardingSteps
          confirm={tx(
            "Gmail 会往这个地址发一封确认邮件，系统会把它{b}（需要先连接 Telegram）。把里面的确认码填回 Gmail，或打开里面的确认链接。",
            { b: <b>{t("转到你的 Telegram")}</b> },
          )}
        />
        <div class="status-line">
          <b>{t("转发状态：")}</b>
          {!s
            ? t("加载中…")
            : s.email.lastAt
              ? t("{time} 收到 —— {outcome}", { time: fmtInstant(s.email.lastAt), outcome: s.email.outcome ?? "" })
              : t("还没有收到过邮件")}
        </div>
      </Section>
      <Section title={t("提醒什么时候发")}>
        <Steps>
          {t("报名截止前几小时提醒：「设置 › 高级设置」。")}
          {t("每天几点催没付的账单：「设置 › 收款设置」。")}
        </Steps>
      </Section>
      {organizers && (
        <Section title={t("请人帮忙管理（组织者、管理员）")}>
          <Steps>
            {t("「成员」里点开那个人，点「设为组织者」或「设为管理员」。他要先用 Google 登录过。")}
            {t("组织者只管自己发起的活动，钱进他自己的 Venmo，你去打他的球也付给他。")}
            {t("管理员和你一样管整个群：审核、成员、所有活动和收款、群设置，也能发起自己的活动。")}
            {t("他在自己的「设置」里填收款、设邮件转发、连 Telegram。成员页最上面能看到他做好了没有。")}
            {t("他的活动的提醒发给他，你只收到三条抄送：发起、结算完成、收齐。")}
            {t("撤销时页面会先列出受影响的活动：没结算的转给你，在收款的钱继续付到他账户直到收齐。")}
          </Steps>
          <p class="muted small">
            {t(
              "只有你能做：任命和撤销管理员、群主密码和管理链接、清空数据、永久删除活动和收款、删除成员。谁做了什么都记在「设置 › 高级设置 › 群操作记录」。",
            )}
          </p>
        </Section>
      )}
      <Section title={t("忘了管理链接或密码")}>
        <Steps>
          {t("忘了链接：在 Telegram 里给机器人发「管理页面」，它把链接发给你。")}
          <>
            {tx("没连 Telegram：请网站维护者重置管理链接，然后打开 {code}，用群主密码重新生成。", {
              code: <code>{admin}</code>,
            })}
          </>
          {t(
            "忘了密码：请网站维护者重置群主密码，用新密码登录后，到「设置 › 账号与安全」改成你自己的。所有设备会退出登录。",
          )}
        </Steps>
        <p class="muted small">
          {t(
            "给网站维护者：GitHub › Actions › CI › Run workflow，「Use workflow from」选最新的版本标签（v 开头，测试环境选 main）。重置链接勾选 reset_admin_link；重置密码先改仓库的 ADMIN_PASSWORD（测试环境是 ADMIN_PASSWORD_STAGING）再运行。",
          )}
        </p>
      </Section>
      <Section title={t("换手机、交接给新群主")}>
        <Steps>
          {t("换手机：用管理链接打开，输入群主密码。每台设备记住登录 30 天，所以管理链接要收藏好。")}
          {t("还在用初始密码的话，到「设置 › 账号与安全 › 修改群主密码」改成你自己的。")}
          <>
            {tx("交接：用「设置 › 账号与安全」里的「清空所有数据」重置网站，新群主在 {code} 用群主密码重新设置。", {
              code: <code>{admin}</code>,
            })}
          </>
        </Steps>
      </Section>
    </Card>
  );
}

/**
 * 给组织者的说明 / 给管理员的说明: the same shape as the Owner's guide. `payment` and `forwarding`
 * come from their payment profile, `telegram` from the status the Telegram card shares, so
 * connecting there ticks it here; null when the site has no Telegram bot, so there is nothing to
 * connect. Undefined means still loading.
 */
export function OrganizerGuide(props: {
  payment?: boolean;
  forwarding?: boolean;
  telegram?: boolean | null;
  /** 给管理员的说明: they run the whole group, and their settings are one level down (`go`). */
  admin?: boolean;
  go?: (sub: "pay" | "advanced") => void;
}) {
  const { payment, forwarding, telegram, go } = props;
  const known = payment !== undefined && forwarding !== undefined && telegram !== undefined;
  const left = known ? [payment, forwarding, telegram !== false].filter((d) => !d).length : undefined;
  return (
    <Card title={props.admin ? t("给管理员的说明") : t("给组织者的说明")}>
      <Progress left={left} />
      <ol class="checklist">
        <Step
          done={payment}
          name={t("填写收款设置")}
          why={go ? t("要收场地费才需要，成员把钱付到这里") : t("在上面的「我的收款设置」，要收场地费才需要")}
          go={go && (() => go("pay"))}
        />
        <Step
          done={forwarding}
          name={t("设置 Venmo 邮件转发")}
          why={go ? t("付款自动记账，第一封收款邮件到了就算做好") : t("照上面「Venmo 邮件转发」的步骤，付款自动记账")}
          go={go && (() => go("pay"))}
          goLabel={t("看步骤")}
        />
        {telegram !== null && (
          <Step
            done={telegram}
            name={t("连接 Telegram")}
            why={
              props.admin ? t("你的活动的提醒和新成员申请发给你") : t("在上面的「我的 Telegram」，没连接时提醒发给群主")
            }
            go={go && (() => go("advanced"))}
          />
        )}
      </ol>

      <h3 class="guide-head">{t("怎么做")}</h3>
      <RunAnEvent deadlineWhere={props.admin ? t("，在「设置 › 收款设置」里改") : ""} />
      <EventHowTos admin={!!props.admin} />
      {props.admin ? (
        <>
          <Section title={t("管理整个群")}>
            <Steps>
              {t(
                "你和群主一样能审核申请、管理成员、任命组织者、管理和转交所有活动、确认所有收款、改群设置、导出数据。",
              )}
              {t("不想每个申请都审：在「设置 › 入群和报名」打开「入群不需要审核」，每天有人数上限。")}
              {t("已经开始的活动也能补建，建好就是截止状态，不发通知。")}
              {t("球场排队里你还能批量删除球场、清空账号。")}
            </Steps>
            <p class="muted small">
              {t("只有群主能做：任命管理员、密码和管理链接、清空数据、永久删除，以及修改群主和管理员的成员记录。")}
            </p>
          </Section>
          <Section title={t("不再当管理员")}>
            <p>{t("点下面的「不再当管理员」，弹窗会先列出你的活动会怎么处理。")}</p>
          </Section>
        </>
      ) : (
        <>
          <Section title={t("我能看到什么")}>
            <Steps>
              {t("你管自己发起的活动和进了你账户的收款，看不到别人的活动和收款。")}
              {t("「成员」和待审核申请只能看。")}
              {t("群主和管理员能看到并修改你的活动；群主会收到发起、结算完成、收齐三条抄送。")}
            </Steps>
          </Section>
          <Section title={t("不再当组织者")}>
            <p>{t("点下面的「不再当组织者」，弹窗会先列出你的活动会怎么处理。")}</p>
          </Section>
        </>
      )}
    </Card>
  );
}
