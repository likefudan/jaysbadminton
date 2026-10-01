import { useState } from "preact/hooks";
import { checkUsername } from "../../shared/rules";
import type { MeResponse, MyEvent, PaymentStatus } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, Load, Page, SectionTitle, useAction } from "../components";
import { EventInfo } from "../events";
import { FriendsEditor } from "../FriendsEditor";
import { PaymentBox } from "../PaymentBox";
import { useApi } from "../hooks";
import { MyStatsCard } from "../Stats";

/** On your own page a settled event shows where your bill stands, not the group's. */
const BILL_STATUS: Record<PaymentStatus, { cls: string; label: string }> = {
  unpaid: { cls: "finalized", label: "待付款" },
  partial: { cls: "finalized", label: "部分付款" },
  paid: { cls: "settled", label: "已付清" },
};

export function Member(props: { token?: string }) {
  const base = `/api/m/${props.token}`;
  const [me, reload] = useApi<MeResponse>(`${base}/me`);
  return (
    <Load result={me}>
      {(m) => (
        <Page title={`你好，${m.username}`} eyebrow={`${m.id} · 专属页面`} subtitle="请不要把这个链接转发给别人。">
          {!m.active && <p class="hint">你的账号已停用，不能再报名活动。如果还有没付清的费用，可以在下面继续付款。</p>}
          <MyEvents base={base} />
          <MyStatsCard base={base} />
          <Rename base={base} current={m.username} onDone={reload} />
        </Page>
      )}
    </Load>
  );
}

function Rename(props: { base: string; current: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(props.current);
  const { busy, error, run, setError } = useAction();
  if (!open) {
    return (
      <button class="button secondary block" onClick={() => setOpen(true)}>
        修改用户名
      </button>
    );
  }
  async function save(e: Event) {
    e.preventDefault();
    const err = checkUsername(name);
    if (err) return setError(err);
    if (await run(() => api(`${props.base}/rename`, { username: name }))) {
      setOpen(false);
      props.onDone();
    }
  }
  return (
    <Card title="修改用户名">
      <form onSubmit={save}>
        <Field label="新用户名" value={name} onInput={setName} />
        {error && <p class="error">{error}</p>}
        <button class="button block" disabled={busy}>
          保存
        </button>
        <button class="button secondary block" type="button" onClick={() => setOpen(false)}>
          取消
        </button>
      </form>
    </Card>
  );
}

function MyEvents(props: { base: string }) {
  const [res, reload] = useApi<{ events: MyEvent[]; friendCap: number }>(`${props.base}/events`);
  return (
    <Load result={res}>
      {(r) => (
        <>
          <SectionTitle>我的活动</SectionTitle>
          {r.events.length === 0 && (
            <Card>
              <Empty>暂时没有活动</Empty>
            </Card>
          )}
          {r.events.map((e) => (
            <SignupCard key={e.id} base={props.base} e={e} cap={r.friendCap} onChange={reload} />
          ))}
        </>
      )}
    </Load>
  );
}

function SignupCard(props: { base: string; e: MyEvent; cap: number; onChange: () => void }) {
  const e = props.e;
  const [editing, setEditing] = useState(false);
  const [friends, setFriends] = useState<string[]>(e.myFriends ?? []);
  const { busy, error, run } = useAction();
  const signedUp = e.myFriends !== null;

  async function save() {
    if (await run(() => api(`${props.base}/events/${e.id}/signup`, { friends }))) {
      setEditing(false);
      props.onChange();
    }
  }
  async function cancel() {
    if (!confirm("确定取消报名吗？")) return;
    if (await run(() => api(`${props.base}/events/${e.id}/cancel`, {}))) props.onChange();
  }

  return (
    <Card>
      <EventInfo e={e} status={e.payment ? BILL_STATUS[e.payment.status] : undefined} />
      {signedUp && !editing && !e.payment && (
        <p class="ok">
          ✓ 已报名{e.myFriends!.length > 0 && `，带 ${e.myFriends!.length} 个朋友`}
        </p>
      )}
      {!signedUp && !e.canEdit && <p class="muted">你没有报名这次活动。</p>}
      {e.canEdit && editing && (
        <>
          <FriendsEditor friends={friends} max={props.cap} onChange={setFriends} />
          {error && <p class="error">{error}</p>}
          <button class="button block" disabled={busy} onClick={save}>
            {signedUp ? "保存修改" : "确认报名"}
          </button>
          <button class="button secondary block" disabled={busy} onClick={() => setEditing(false)}>
            返回
          </button>
        </>
      )}
      {e.canEdit && !editing && (
        <>
          {error && <p class="error">{error}</p>}
          {signedUp ? (
            <div class="inline">
              <button class="button secondary" onClick={() => { setFriends(e.myFriends ?? []); setEditing(true); }}>
                修改
              </button>
              <button class="button danger" disabled={busy} onClick={cancel}>
                取消报名
              </button>
            </div>
          ) : (
            <button class="button block" onClick={() => { setFriends([]); setEditing(true); }}>
              报名
            </button>
          )}
        </>
      )}
      {!e.canEdit && e.status === "closed" && signedUp && <p class="muted small">报名已截止，需要修改请联系管理员。费用会在活动后公布。</p>}
      {e.payment && <PaymentBox p={e.payment} />}
    </Card>
  );
}
