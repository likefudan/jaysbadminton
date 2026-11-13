import type { ReleaseEntry, ReleasesResponse } from "../../shared/types";
import { toPacific } from "../../shared/time";
import { Load, SettingRow } from "../components";
import { useApi } from "../hooks";
import { currentLang, fmtDay, t } from "../i18n";

/**
 * 设置 → 版本和更新记录 (Ke Li 2026-11-13, option A; organizers too): which version this site runs
 * and what each release changed, newest first, from this site's own records (src/worker/releases.ts).
 */

const day = (iso: string) => fmtDay(toPacific(iso).date);

const VersionIcon = () => (
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
    <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.5 8z" />
  </svg>
);

/** The menu row under 设置's groups, with the version on the right. */
export function VersionRow(props: { base: string; current?: boolean; onClick: () => void }) {
  // Just the version: the health check carries it, without the list.
  const [r] = useApi<{ version?: string }>("/api/health");
  return (
    <section class="card set-list">
      <SettingRow
        icon={<VersionIcon />}
        label={t("版本和更新记录")}
        value={r.state === "ok" ? r.data.version : undefined}
        current={props.current}
        onClick={props.onClick}
      />
    </section>
  );
}

function Lines(props: { release: ReleaseEntry }) {
  const { lines, changes } = props.release;
  const items = lines ? lines[currentLang()] : changes;
  if (!items.length)
    return <p class="ver-none">{lines ? t("这次没有大家能看到的变化，只是内部改进。") : t("这次没有记下改动。")}</p>;
  return (
    <ul class="ver-lines">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

export function VersionsPage(props: { base: string }) {
  const [r] = useApi<ReleasesResponse>(`${props.base}/releases`);
  return (
    <Load result={r}>
      {({ current, releases }) => {
        const now = releases.find((x) => x.tag === current);
        return (
          <>
            <section class="card ver-now">
              <div class="ver-label">{t("当前版本")}</div>
              <div class="ver-tag">{current ?? t("未知")}</div>
              {now && <div class="ver-sub">{t("{date}发布", { date: day(now.at) })}</div>}
            </section>
            <h3 class="ver-h">{t("更新记录")}</h3>
            {releases.length === 0 && <p class="muted">{t("还没有正式版的更新记录。")}</p>}
            {releases.map((x) => (
              <section class="card ver-item" key={x.tag}>
                <div class="ver-head">
                  <strong>{x.tag}</strong>
                  {x.tag === current && <span class="badge ver-cur">{t("当前")}</span>}
                  <span class="ver-date">{day(x.at)}</span>
                </div>
                <Lines release={x} />
              </section>
            ))}
          </>
        );
      }}
    </Load>
  );
}
