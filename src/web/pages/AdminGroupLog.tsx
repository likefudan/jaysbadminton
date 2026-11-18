import { useEffect, useState } from "preact/hooks";
import type { AuditEntry } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, useAction } from "../components";
import { fmtInstant, t } from "../i18n";

/**
 * 群操作记录 (Ke Li 2026-11-18): a row in 设置 → 高级设置 opening its own page, rather than a fold at
 * the bottom of 成员, since it covers settings, exports and AI costs as much as members. The Owner
 * and admins; organizers have no 高级设置 and the server refuses them anyway.
 */
export function GroupLogRow(props: { open: () => void }) {
  return (
    <Card>
      <button type="button" class="menu-row" onClick={props.open}>
        <span>
          <strong>{t("群操作记录")}</strong>
          <small>{t("谁通过了申请、改了设置、导出了数据")}</small>
        </span>
        <span class="chevron">›</span>
      </button>
    </Card>
  );
}

/** Who did what to the group, newest first, a page at a time. */
export function GroupLogPage(props: { base: string }) {
  const [pages, setPages] = useState<AuditEntry[][]>([]);
  const [more, setMore] = useState(true);
  const { busy, error, run } = useAction();
  async function next() {
    const flat = pages.flat();
    const last = flat[flat.length - 1];
    const r = await run(() =>
      api<{ entries: AuditEntry[]; more: boolean }>(`${props.base}/group-audit${last ? `?before=${last.id}` : ""}`),
    );
    if (!r) return;
    setPages((p) => [...p, r.entries]);
    setMore(r.more);
  }
  useEffect(() => {
    void next();
  }, []);
  const entries = pages.flat();
  return (
    <Card>
      {error && <p class="error">{error}</p>}
      {pages.length > 0 && entries.length === 0 && <Empty>{t("还没有记录")}</Empty>}
      <ul class="audit">
        {entries.map((a) => (
          <li key={a.id}>
            <small class="muted">
              {fmtInstant(a.at)} · {a.actor}
            </small>
            <div>{a.detail}</div>
          </li>
        ))}
      </ul>
      {pages.length > 0 && more && (
        <button type="button" class="button secondary block" disabled={busy} onClick={next}>
          {t("显示更早的记录")}
        </button>
      )}
    </Card>
  );
}
