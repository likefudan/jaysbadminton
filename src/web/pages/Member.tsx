import { useState } from "preact/hooks";
import { checkUsername } from "../../shared/rules";
import type { MeResponse } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, Load, Page, useAction } from "../components";
import { useApi } from "../hooks";

export function Member(props: { token?: string }) {
  const base = `/api/m/${props.token}`;
  const [me, reload] = useApi<MeResponse>(`${base}/me`);
  return (
    <Load result={me}>
      {(m) => (
        <Page title={`你好，${m.username}`}>
          <p class="muted">
            成员编号 {m.id}。这是你的专属页面，请不要把链接转发给别人。
          </p>
          <Card title="本周活动">
            <Empty>报名功能即将开放</Empty>
          </Card>
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
