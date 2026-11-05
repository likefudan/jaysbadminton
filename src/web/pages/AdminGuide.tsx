import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
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

function Step(props: { done?: boolean; optional?: boolean; children: ComponentChildren }) {
  return (
    <li class={props.done ? "done" : ""}>
      <span class="tick">{props.done ? "✓" : "○"}</span>
      <div>
        {props.children}
        {props.optional && <span class="badge">{t("可选")}</span>}
      </div>
    </li>
  );
}

/**
 * Whether a checklist starts open: decided once, when its statuses have loaded (`todo` is no longer
 * undefined), so a step getting done later doesn't fold the list away under the reader.
 */
function useOpenOnce(todo: boolean | undefined): boolean {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (todo !== undefined && open === null) setOpen(todo);
  }, [todo]);
  return open ?? false;
}

function Section(props: { title: string; open?: boolean; children: ComponentChildren }) {
  return (
    <details class="guide-section" open={props.open}>
      <summary>{props.title}</summary>
      <div class="guide-body">{props.children}</div>
    </details>
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

/** 使用指南: what to set up, how Venmo forwarding works and is tested, and how to recover access. */
export function AdminGuide(props: { base: string; telegram: Loaded<TelegramStatus> }) {
  const s = useStatus(props.base, props.telegram);
  const setupOpen = useOpenOnce(s ? !(s.venmo && s.telegram) : undefined);
  const organizers = props.telegram.state === "ok" && props.telegram.data.organizers;
  const telegramBot = props.telegram.state === "ok" && props.telegram.data.botReady;
  const join = `${location.origin}/login`; // 登录 / 注册: Google

  return (
    <Card title={t("使用指南")}>
      <Section title={t("一、第一次设置后要做的事")} open={setupOpen}>
        <ol class="checklist">
          <Step>
            {tx(
              "{b}。打开管理页需要「管理链接 + 群主密码」两样。如果是用初始密码登录的，请在「设置 → 账号与安全 → 修改群主密码」里改成你自己的。",
              { b: <b>{t("收藏管理链接")}</b> },
            )}
          </Step>
          <Step done={s?.telegram}>
            {tx(
              "{b}（「设置 → 高级设置 → Telegram 通知」→ 连接，然后发送测试消息）。所有提醒、账单提醒、收款异常都发到这里{x}；以后忘了管理链接也能在这里找回。",
              {
                b: <b>{t("连接 Telegram")}</b>,
                x: organizers && t("（组织者负责的活动的提醒发给组织者，见第四部分）"),
              },
            )}
          </Step>
          <Step>
            {tx(
              "{b}（「设置 → 账号与安全 → 备份网站密钥」，要先连接 Telegram）：密钥发到 Telegram 后存进密码管理器，再交给网站维护者存成 GitHub secret。万一 Cloudflare 里的密钥丢了，部署时会用它自动恢复，成员链接、管理链接和表格同步脚本才能继续显示和找回。",
              { b: <b>{t("备份网站密钥")}</b> },
            )}
          </Step>
          <Step done={s?.venmo}>
            {tx(
              "{b}（「设置 → 收款设置」，保存时要输入群主密码）：Venmo 用户名、Venmo 通知邮箱（Venmo 账户里登记的、收款通知发到的那个邮箱），Zelle 选填。",
              { b: <b>{t("填写收款设置")}</b> },
            )}
          </Step>
          <Step done={!!s?.email.lastAt}>
            {tx("{b}，让系统自动对账，见下面第二部分。", { b: <b>{t("设置 Venmo 邮件转发")}</b> })}
          </Step>
          <Step>
            {tx("{b}（「设置 → 高级设置」和「设置 → 收款设置」）：截止前几小时提醒、每天几点发账单提醒。", {
              b: <b>{t("检查提醒设置")}</b>,
            })}
          </Step>
          <Step done={s?.sheets} optional>
            {tx("{b}（「设置 → 高级设置 → Google 表格同步」）：每天把数据备份到你自己的 Google 表格。", {
              b: <b>{t("Google 表格同步")}</b>,
            })}
          </Step>
          <Step optional>{tx("{b}（「设置 → 外观和公共页面」）：网站标题和配色。", { b: <b>{t("外观")}</b> })}</Step>
          <Step>
            {tx(
              "{b}：把网站首页发到微信群，大家点「登录 / 注册」，用 Google 账号申请（新成员只能用 Google）。在「待审核」里通过后，对方直接用 Google 登录就能报名。",
              { b: <b>{t("邀请成员")}</b> },
            )}
            <div class="inline-copy">
              <code>{join}</code> <CopyButton text={join} label={t("复制")} />
            </div>
          </Step>
          <Step>{tx("{b}：在「活动」里新建，然后点「复制活动链接」发到群里。", { b: <b>{t("新建活动")}</b> })}</Step>
        </ol>
      </Section>

      <Section title={t("二、Venmo 收款邮件转发：设置与测试")}>
        <p class="small">
          {t(
            "系统读取 Venmo 发来的收款通知邮件，按备注里的付款编号自动记账。你的邮箱密码系统拿不到，只是用 Gmail 把 Venmo 的邮件转发过来；和羽毛球无关的收款会被忽略，不会保存。",
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
        <p class="muted small">
          {t(
            "成员付款时，备注里要带他专属页面上显示的付款编号（例如 xiaoming-jbm20261007-m002），系统才能自动记到他的账上。对不上的会进入「收款 → 待确认」，由你手动关联。",
          )}
        </p>
      </Section>

      <Section title={t("三、忘记密码或管理链接怎么办")}>
        <ul class="steps">
          <li>
            {tx(
              "{b}：在 Telegram 里给机器人发送「管理页面」，它会把链接发给你（只回复已连接的那个账号）。没连 Telegram 的话，请网站维护者在 GitHub → Actions → CI → Run workflow，「Use workflow from」选最新的版本标签（v 开头），勾选 reset_admin_link 运行一次（测试环境则选 main），然后打开 {code} {x}",
              {
                b: <b>{t("忘记管理链接")}</b>,
                code: <code>{location.origin}/admin</code>,
                x: t(
                  "用当前的群主密码重新生成（没在管理页改过密码的话，就是 GitHub 里的 ADMIN_PASSWORD，测试环境是 ADMIN_PASSWORD_STAGING）。",
                ),
              },
            )}
          </li>
          <li>
            {tx(
              "{b}：网站维护者把 GitHub 仓库里的 ADMIN_PASSWORD 改成一个新密码，然后在 Actions → CI → Run workflow 运行一次（「Use workflow from」选最新的版本标签，v 开头）。部署完成后用新密码登录，再到这里改成你自己的密码。所有设备会被退出登录。",
              { b: <b>{t("忘记密码")}</b> },
            )}
          </li>
          <li>{tx("{b}：用管理链接打开，输入密码即可；每台设备记住登录 30 天。", { b: <b>{t("换一部手机")}</b> })}</li>
          <li>
            {tx(
              "{b}：用「设置 → 账号与安全」里的「清空所有数据」重置网站，新群主用群主密码在 {code} 做初次设置，再按本指南走一遍。",
              {
                b: <b>{t("交接给新的群主")}</b>,
                code: <code>{location.origin}/admin</code>,
              },
            )}
          </li>
        </ul>
      </Section>

      {organizers && (
        <Section title={t("四、组织者")}>
          <ul class="steps">
            <li>
              {tx(
                "{b}：在「成员」里点对方的「设为组织者」。对方要是正常状态的成员，并且已经关联了 Google 账号（组织者只能用 Google 账号进入管理页）。系统会发邮件告诉他；邮件服务没配置时页面会提示，你要自己告诉他。",
                { b: <b>{t("任命")}</b> },
              )}
            </li>
            <li>
              {tx(
                "{b}（他的「设置」里有「给组织者的说明」）：填自己的收款设置（Venmo 用户名和通知邮箱，不填不能结算）、在自己的 Gmail 里设同样的 Venmo 邮件转发{x}。成员页最上面的「组织者」区块显示每个人做好了没有。",
                { b: <b>{t("他要做的事")}</b>, x: telegramBot && t("、连接自己的 Telegram") },
              )}
            </li>
            <li>
              {tx(
                "{b}：他发起的活动（以及结算前转交给他的），成员把钱付到他的 Venmo，他自己的账单自动算已付；你去打他的球也要付钱给他。",
                { b: <b>{t("钱进谁的账户")}</b> },
              )}
            </li>
            <li>
              {tx(
                "{b}：他的活动的提醒发给他；他没连 Telegram 时改发给你，消息开头写明原因。你另外收到三条抄送：发起、结算完成、收齐。",
                { b: <b>{t("通知")}</b> },
              )}
            </li>
            <li>
              {tx(
                "{b}：只能管理自己负责的活动和进了自己账户的收款；「待审核」「成员」只读，看不到成员的专属链接。你能看到、也能修改他的活动，每场的「操作记录」里写着谁改了什么。",
                { b: <b>{t("他能看到什么")}</b> },
              )}
            </li>
            <li>
              {tx(
                "{b}：活动页的「转交」把活动交给另一位组织者或你自己；成员页的「撤销组织者」会先列出受影响的活动：还没结算的转给你，已经在收款的由你接手管理，钱继续付到他的账户直到收齐。",
                { b: <b>{t("转交和撤销")}</b> },
              )}
            </li>
          </ul>
        </Section>
      )}

      {organizers && (
        <Section title={t("五、管理员")}>
          <ul class="steps">
            <li>
              {tx(
                "{b}：在「成员」里点「设为管理员」（组织者那一行是「升为管理员」，他原来的活动、收款设置和 Telegram 都保留）。条件和组织者一样：正常状态、已关联 Google。只有你能任命、降为组织者或撤销管理员。",
                { b: <b>{t("任命")}</b> },
              )}
            </li>
            <li>
              {tx(
                "{b}：和你一样管理整个群：审核申请、管理成员、任命和撤销组织者、管理和转交所有活动、确认所有收款、修改群设置、导出数据、查看表格同步状态。他也能发起自己的活动，钱进他自己的 Venmo，和组织者一样要填收款设置、设 Gmail 转发。",
                { b: <b>{t("他能做什么")}</b> },
              )}
            </li>
            <li>
              {tx(
                "{b}：任命和撤销管理员、群主密码和管理链接、备份密钥、清空数据、你自己的 Google 绑定和收款设置、表格同步的开关和脚本、付款诊断、永久删除活动和收款、删除成员。管理员也不能动你和其他管理员的成员记录（链接、停用）。",
                { b: <b>{t("只有你能做")}</b> },
              )}
            </li>
            <li>
              {tx(
                "{b}：新成员申请发给你和每位连了 Telegram 的管理员；他的活动的发起、结算完成、收齐抄送给你。别人把你收款的活动转走时你会收到通知。",
                { b: <b>{t("通知")}</b> },
              )}
            </li>
            <li>
              {tx("{b}：成员页最下面的「群操作记录」写着谁通过了申请、停用了谁、任命了谁、改了什么设置、导出了什么。", {
                b: <b>{t("群操作记录")}</b>,
              })}
            </li>
          </ul>
        </Section>
      )}
    </Card>
  );
}

/**
 * 给组织者的说明 (card 11): the three things an organizer sets up, ticked as they get done, and how
 * running an event works for them. `payment` and `forwarding` come from their payment profile,
 * `telegram` from the status the Telegram card shares, so connecting there ticks it here; null when
 * the site has no Telegram bot, so there is nothing to connect. Undefined means still loading.
 */
export function OrganizerGuide(props: {
  payment?: boolean;
  forwarding?: boolean;
  telegram?: boolean | null;
  /** 给管理员的说明: the same first steps; they run the whole group, not only their own events. */
  admin?: boolean;
}) {
  const { payment, forwarding, telegram } = props;
  // The first Venmo email can take days, so the list must not fold away when it ticks.
  const known = payment !== undefined && forwarding !== undefined && telegram !== undefined;
  const open = useOpenOnce(known ? !(payment && forwarding && telegram !== false) : undefined);
  return (
    <Card title={props.admin ? t("给管理员的说明") : t("给组织者的说明")}>
      <Section title={t("一、开始前要做的事")} open={open}>
        <ol class="checklist">
          <Step done={payment}>
            {tx(
              "{b}（设置里的「我的收款设置」）：Venmo 用户名、Venmo 通知邮箱（Venmo 账户里登记的、收款通知发到的那个邮箱），Zelle 选填。你负责的活动，成员把钱付到这里；没填好之前活动可以报名，但不能结算。",
              { b: <b>{t("填好收款设置")}</b> },
            )}
          </Step>
          <Step done={forwarding}>
            {tx(
              "{b}（设置里「Venmo 邮件转发」的步骤）：设好以后成员付款会自动记账；第一封 Venmo 收款邮件到了，转发状态会显示「已生效」。",
              { b: <b>{t("设置 Venmo 邮件转发")}</b> },
            )}
          </Step>
          {telegram !== null && (
            <Step done={telegram}>
              {tx(
                "{b}（设置里的「我的 Telegram」）：你负责的活动的报名截止、结算和收款提醒会发给你；没连接时这些提醒发给群主。",
                { b: <b>{t("连接你的 Telegram")}</b> },
              )}
            </Step>
          )}
        </ol>
      </Section>
      <Section title={t("二、怎么组织一场活动")}>
        <ul class="steps">
          <li>{t("在「活动」里点「＋ 新建活动」，你就是这场的负责人和收款人，然后「复制活动链接」发到群里。")}</li>
          <li>
            {t("截止后可以改名单、标记到场，填好场地费和用球数，预览后点 Finalize，成员就能看到账单并付钱给你。")}
          </li>
          <li>
            {t(
              "没有自动对上的 Venmo 付款在「收款 › 待确认」里，关联到对应的账单；Zelle 和现金在活动的账单里手动标记已付。全部付清后活动自动归档。",
            )}
          </li>
          {props.admin ? (
            <li>
              {t(
                "你还能像群主一样管理整个群：审核申请、管理成员、任命组织者、管理和转交所有活动、确认所有收款、修改群设置、导出数据。群主和管理员（包括你自己）的成员记录、任命管理员、密码和密钥、清空数据、永久删除只有群主能做。",
              )}
            </li>
          ) : (
            <li>
              {t(
                "群主能看到并修改你的活动，会收到发起、结算完成、收齐三条抄送。你看不到别人负责的活动和收款；「待审核」「成员」只能看，不能改。",
              )}
            </li>
          )}
          <li>
            {props.admin
              ? t("不想再当管理员时，点下面的「不再当管理员」，弹窗会先列出你的活动会怎么处理。")
              : t("不想再当组织者时，点下面的「不再当组织者」，弹窗会先列出你的活动会怎么处理。")}
          </li>
        </ul>
      </Section>
    </Card>
  );
}
