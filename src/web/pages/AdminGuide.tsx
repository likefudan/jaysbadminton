import type { ComponentChildren } from "preact";
import { formatInstantZh } from "../../shared/time";
import { Card, CopyButton } from "../components";
import { useApi } from "../hooks";

interface Status {
  venmo: boolean;
  telegram: boolean;
  sheets: boolean;
  email: { lastAt: string | null; outcome: string | null };
}

/** Loads what is already set up, so the checklist can tick itself. */
function useStatus(base: string): Status | null {
  const [settings] = useApi<{ venmoUsername: string; venmoEmail: string }>(`${base}/settings`);
  const [telegram] = useApi<{ connected: boolean }>(`${base}/telegram`);
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
        {props.optional && <span class="badge">可选</span>}
      </div>
    </li>
  );
}

function Section(props: { title: string; open?: boolean; children: ComponentChildren }) {
  return (
    <details class="guide-section" open={props.open}>
      <summary>{props.title}</summary>
      <div class="guide-body">{props.children}</div>
    </details>
  );
}

/** 使用指南: what to set up, how Venmo forwarding works and is tested, and how to recover access. */
export function AdminGuide(props: { base: string }) {
  const s = useStatus(props.base);
  const host = location.hostname;
  const forward = `venmo@${host}`;
  const join = `${location.origin}/login`; // 登录 / 注册: Google or email

  return (
    <Card title="使用指南">
      <Section title="一、第一次设置后要做的事" open={!!s && !(s.venmo && s.telegram)}>
        <ol class="checklist">
          <Step>
            <b>收藏管理链接</b>。打开管理页需要「管理链接 +
            群主密码」两样。如果是用初始密码登录的，请在上面「修改群主密码」里改成你自己的。
          </Step>
          <Step done={s?.telegram}>
            <b>连接 Telegram</b>（上面「Telegram 通知」→
            连接，然后发送测试消息）。所有提醒、账单提醒、收款异常都发到这里；以后忘了管理链接也能在这里找回。
          </Step>
          <Step>
            <b>备份网站密钥</b>（「设置 → 备份网站密钥」，要先连接 Telegram）：密钥发到 Telegram
            后存进密码管理器，再交给网站维护者存成 GitHub secret。万一 Cloudflare
            里的密钥丢了，部署时会用它自动恢复，成员链接、管理链接和表格同步脚本才能继续显示和找回。
          </Step>
          <Step done={s?.venmo}>
            <b>填写收款设置</b>（上面「收款设置」，保存时要输入群主密码）：Venmo 用户名、Venmo 通知邮箱（Venmo
            账户里登记的、收款通知发到的那个邮箱），Zelle 选填。
          </Step>
          <Step done={!!s?.email.lastAt}>
            <b>设置 Venmo 邮件转发</b>，让系统自动对账，见下面第二部分。
          </Step>
          <Step>
            <b>检查提醒设置</b>：截止前几小时提醒、每天几点发账单提醒。
          </Step>
          <Step done={s?.sheets} optional>
            <b>Google 表格同步</b>（上面「Google 表格同步 ›」）：每天把数据备份到你自己的 Google 表格。
          </Step>
          <Step optional>
            <b>外观</b>：网站标题和配色。
          </Step>
          <Step>
            <b>邀请成员</b>：把网站首页发到微信群，大家点「登录 / 注册」，用 Google
            账号或邮箱申请。在「待审核」里通过后：用 Google
            申请的人直接登录就能报名；用邮箱注册的人会自动收到专属链接的邮件（没收到可以在成员列表重试，或者把链接私发给对方；成员自己也能在「找回我的专属链接」里再要一次）。
            <div class="inline-copy">
              <code>{join}</code> <CopyButton text={join} label="复制" />
            </div>
          </Step>
          <Step>
            <b>新建活动</b>：在「活动」里新建，然后点「复制活动链接」发到群里。
          </Step>
        </ol>
      </Section>

      <Section title="二、Venmo 收款邮件转发：设置与测试">
        <p class="small">
          系统读取 Venmo 发来的收款通知邮件，按备注里的付款编号自动记账。你的邮箱密码系统拿不到，只是用 Gmail 把 Venmo
          的邮件转发过来；和羽毛球无关的收款会被忽略，不会保存。
        </p>
        <ol class="steps">
          <li>
            Venmo App →「Settings → Notifications」，确认收款（You receive a payment）的<b>邮件通知</b>是打开的。
          </li>
          <li>
            电脑上打开 Gmail →「设置 ⚙ → 查看所有设置 → 转发和 POP/IMAP → 添加转发地址」，填：
            <div class="inline-copy">
              <code>{forward}</code> <CopyButton text={forward} label="复制" />
            </div>
          </li>
          <li>
            Gmail 会往这个地址发一封确认邮件，系统会把它<b>转到你的 Telegram</b>（需要先连接
            Telegram）。把里面的确认码填回 Gmail，或打开里面的确认链接。
          </li>
          <li>
            回到 Gmail，在搜索框输入 <code>from:venmo@venmo.com</code> → 点搜索框右边的「显示搜索选项」→「创建过滤器」→
            勾选「转发到」并选择上面的地址（建议同时加一个「Venmo」标签，<b>不要</b>勾删除）→ 创建过滤器。
          </li>
          <li>
            <b>测试</b>：请朋友用 Venmo 付你 $1（备注随便写，之后退回），过一两分钟刷新本页，看下面的「转发状态」。
          </li>
        </ol>
        <div class="status-line">
          <b>转发状态：</b>
          {!s ? (
            "加载中…"
          ) : s.email.lastAt ? (
            <>
              {formatInstantZh(s.email.lastAt)} 收到 —— {s.email.outcome}
            </>
          ) : (
            "还没有收到过邮件"
          )}
        </div>
        <p class="muted small">
          成员付款时，备注里要带他专属页面上显示的付款编号（例如
          xiaoming-jbm20261007-m002），系统才能自动记到他的账上。对不上的会进入「收款 → 待确认」，由你手动关联。
        </p>
      </Section>

      <Section title="三、忘记密码或管理链接怎么办">
        <ul class="steps">
          <li>
            <b>忘记管理链接</b>：在 Telegram
            里给机器人发送「管理页面」，它会把链接发给你（只回复已连接的那个账号）。没连 Telegram 的话，请网站维护者在
            GitHub → Actions → CI → Run workflow，「Use workflow from」选最新的版本标签（v 开头），勾选 reset_admin_link
            运行一次（测试环境则选 main），然后打开 <code>{location.origin}/admin</code>{" "}
            用当前的群主密码重新生成（没在管理页改过密码的话，就是 GitHub 里的 ADMIN_PASSWORD，测试环境是
            ADMIN_PASSWORD_STAGING）。
          </li>
          <li>
            <b>忘记密码</b>：网站维护者把 GitHub 仓库里的 ADMIN_PASSWORD 改成一个新密码，然后在 Actions → CI → Run
            workflow 运行一次（「Use workflow from」选最新的版本标签，v
            开头）。部署完成后用新密码登录，再到这里改成你自己的密码。所有设备会被退出登录。
          </li>
          <li>
            <b>换一部手机</b>：用管理链接打开，输入密码即可；每台设备记住登录 30 天。
          </li>
          <li>
            <b>交接给新的群主</b>：用下面的「清空所有数据」重置网站，新群主用群主密码在{" "}
            <code>{location.origin}/admin</code> 做初次设置，再按本指南走一遍。
          </li>
        </ul>
      </Section>
    </Card>
  );
}
