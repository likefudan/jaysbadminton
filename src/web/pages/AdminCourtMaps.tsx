import { useState } from "preact/hooks";
import { type CourtMapVenue, courtMapPlace } from "../../shared/courtMap";
import { toPacific } from "../../shared/time";
import { Load, SettingRow } from "../components";
import { CourtMapManager } from "../CourtMap";
import { useApi } from "../hooks";
import { fmtDay, t } from "../i18n";

/**
 * 设置 → 球场图 (Ke Li 2026-11-15: 在设置里管理，活动卡片上只是用来看): the venues we play at, one
 * plan each, by address. A venue opens to add its plan from a photo, change it, remove it or bring
 * back an earlier one. For the Owner, admins and organizers.
 */

const MapIcon = () => (
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
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 12h18M9 4v16M15 4v16" />
  </svg>
);

interface Listing {
  venues: CourtMapVenue[];
  photo: boolean;
}

const placeOf = (v: CourtMapVenue) => courtMapPlace(v.venue, v.address);

/** The menu row in 设置 that opens the page. */
export function CourtMapsRow(props: { current?: boolean; onClick: () => void }) {
  return (
    <section class="card set-list">
      <SettingRow icon={<MapIcon />} label={t("球场图")} current={props.current} onClick={props.onClick} />
    </section>
  );
}

export function CourtMapsPage(props: { base: string }) {
  const [list, reload] = useApi<Listing>(`${props.base}/court-maps`);
  // The venue open, by place, so it shows the fresh plan after a save.
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Load result={list}>
      {(d) => {
        const venue = d.venues.find((v) => placeOf(v) === open);
        return (
          <>
            <p class="muted small cm-intro">
              {t("每个球馆一张图，按地址对应。活动卡片上的「球场图」只能看，在这里添加和修改。")}
            </p>
            {d.venues.length === 0 ? (
              <p class="muted">{t("还没有球馆。新建一次活动后，球馆会出现在这里。")}</p>
            ) : (
              <section class="card set-list">
                {d.venues.map((v) => (
                  <SettingRow
                    key={placeOf(v)}
                    label={v.venue}
                    sub={v.address || undefined}
                    value={
                      v.map
                        ? t("{n} 片 · {day}", {
                            n: v.map.items.filter((i) => i.kind === "court").length,
                            day: v.updatedAt ? fmtDay(toPacific(v.updatedAt).date) : "",
                          })
                        : t("未添加")
                    }
                    onClick={() => setOpen(placeOf(v))}
                  />
                ))}
              </section>
            )}
            {venue && (
              <CourtMapManager
                base={props.base}
                venue={venue}
                photo={d.photo}
                onClose={() => setOpen(null)}
                onChange={reload}
              />
            )}
          </>
        );
      }}
    </Load>
  );
}
