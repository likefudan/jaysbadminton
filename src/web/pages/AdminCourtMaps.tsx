import { useEffect, useState } from "preact/hooks";
import { type CourtMapPastVenue, type CourtMapVenue, courtMapPlace } from "../../shared/courtMap";
import { toPacific } from "../../shared/time";
import { AddressInput } from "../AddressInput";
import { Field, Load, SettingRow } from "../components";
import { CourtMapManager } from "../CourtMap";
import { Panel } from "../Panel";
import { useApi } from "../hooks";
import { fmtDay, t } from "../i18n";

/**
 * 设置 → 球场图 (Ke Li 2026-11-15: 在设置里管理，活动卡片上只是用来看): the venues we play at, one
 * plan each, by address. A venue opens to add its plan from a photo, change it, remove it or bring
 * back an earlier one. For the Owner, admins and organizers.
 */

export const MapIcon = () => (
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
  past: CourtMapPastVenue[];
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
  // The venue open. The list has its fresh plan after a save; a venue no longer on 最近的场馆 leaves
  // the list when its plan is deleted, and stays open as it was so 以前的图 can bring the plan back.
  const [open, setOpen] = useState<CourtMapVenue | null>(null);
  // 添加球馆 (Ke Li 2026-11-15): a venue not on the list is typed in, name and address.
  const [adding, setAdding] = useState(false);
  // A photo is being read in the background (Ke Li: 过一会儿回来看结果): look again every few
  // seconds while this page is open, so the answer shows without a reload.
  const waiting = list.state === "ok" && list.data.venues.some((v) => v.read?.state === "pending");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [waiting]);
  return (
    <Load result={list}>
      {(d) => {
        const venue =
          open &&
          (d.venues.find((v) => placeOf(v) === placeOf(open)) ?? {
            ...open,
            map: null,
            updatedAt: null,
            savedBy: null,
            read: null,
          });
        return (
          <>
            <p class="muted small cm-intro">
              {t("每个球馆一张图，按地址对应。活动卡片上的「球场图」只能看，在这里添加和修改。")}
            </p>
            {d.venues.length === 0 ? (
              <p class="muted">{t("还没有球馆。点「添加球馆」，填上名称和地址。")}</p>
            ) : (
              <section class="card set-list">
                {d.venues.map((v) => (
                  <SettingRow
                    key={placeOf(v)}
                    label={v.venue}
                    sub={v.address || undefined}
                    value={
                      v.read?.state === "pending"
                        ? t("正在识别…")
                        : v.read?.state === "ready"
                          ? t("识别好了，待核对")
                          : v.read
                            ? t("没有识别出来")
                            : v.map
                              ? t("{n} 片 · {day}", {
                                  n: v.map.items.filter((i) => i.kind === "court").length,
                                  day: v.updatedAt ? fmtDay(toPacific(v.updatedAt).date) : "",
                                })
                              : t("未添加")
                    }
                    onClick={() => setOpen(v)}
                  />
                ))}
              </section>
            )}
            <button type="button" class="button secondary block cm-add-venue" onClick={() => setAdding(true)}>
              {t("＋ 添加球馆")}
            </button>
            {adding && (
              <AddVenue
                base={props.base}
                past={d.past}
                onClose={() => setAdding(false)}
                onDone={(v) => {
                  // The venue opens once this panel has taken its history entry back: opened at
                  // once, that step back would close the venue's panel instead.
                  addEventListener(
                    "popstate",
                    () => setOpen({ ...v, map: null, updatedAt: null, savedBy: null, read: null }),
                    { once: true },
                  );
                  setAdding(false);
                }}
              />
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

/**
 * 添加球馆 (Ke Li 2026-11-15: 1和2都做): a venue of an earlier event picked from the list, or its
 * name and address typed in (the address with suggestions, as in 新建活动).
 * Nothing is kept yet: it opens the venue to add its plan, and the venue is on the list once it
 * has one. An address already on the list opens that venue.
 */
function AddVenue(props: {
  base: string;
  past: CourtMapPastVenue[];
  onClose: () => void;
  onDone: (v: { venue: string; address: string }) => void;
}) {
  const [venue, setVenue] = useState("");
  const [address, setAddress] = useState("");
  const name = venue.trim();
  return (
    <Panel title={t("添加球馆")} label={t("添加球馆")} onClose={props.onClose}>
      {props.past.length > 0 && (
        <>
          <h3 class="cm-add-title">{t("历史活动的球馆")}</h3>
          <section class="card set-list">
            {props.past.map((v) => (
              <SettingRow
                key={courtMapPlace(v.venue, v.address)}
                label={v.venue}
                sub={v.address || undefined}
                value={t("最近活动 {day}", { day: fmtDay(v.date) })}
                onClick={() => props.onDone({ venue: v.venue, address: v.address })}
              />
            ))}
          </section>
          <h3 class="cm-add-title">{t("或者自己填写")}</h3>
        </>
      )}
      <Field label={t("场馆")} value={venue} onInput={setVenue} />
      <AddressInput
        base={props.base}
        value={address}
        onInput={setAddress}
        onPlace={(found) => !venue.trim() && setVenue(found)}
      />
      <p class="muted small">{t("球场图按地址对应活动，地址请和活动里填的一样。")}</p>
      <button
        type="button"
        class="button block"
        disabled={!name || [...name].length > 60 || [...address.trim()].length > 200}
        onClick={() => props.onDone({ venue: name, address: address.trim() })}
      >
        {t("下一步")}
      </button>
    </Panel>
  );
}
