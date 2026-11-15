import { courtPhase, type QueueCourt, QUEUE_SOON_MIN } from "../shared/courtQueue";
import type { MyEvent } from "../shared/types";
import { Panel } from "./Panel";
import { t } from "./i18n";

export function hasCourtMap(event: Pick<MyEvent, "address" | "location">) {
  const venue = `${event.location} ${event.address}`;
  return /\b48900\s+milmont\b/i.test(venue) || (/\bbintang\b/i.test(venue) && /\bfremont\b/i.test(venue));
}

// Bintang Fremont, read left to right from the venue's posted floor plan.
const ROWS = [
  [53, 52, 51, 50, 49, 48],
  [47, 46, 45, 44, 43, 42, 41],
  [40, 39, 38, 37, 36, 35, 34],
  [33, 32, 31, 30, 29, 28, 27],
  [26, 25, 24, 23, 22, 21, 20],
  [19, 18, 17, 16, 15, 14, 13],
  [12, 11, 10, 9, 8, 7, 6],
  [5, null, null, 4, 3, 2, 1],
];

type Tone = "play" | "soon" | "queued" | "unregistered";

export function CourtMap(props: { courts: QueueCourt[]; now: number; onClose: () => void }) {
  const tones = new Map<number, Tone>();
  for (const court of props.courts) {
    const phase = courtPhase(court, props.now);
    if (phase.phase === "playing") {
      tones.set(court.court, phase.minutes <= QUEUE_SOON_MIN ? "soon" : "play");
    } else if (phase.phase === "queued" && !tones.has(court.court)) {
      tones.set(court.court, "queued");
    }
  }
  const labels: Record<Tone, string> = {
    play: t("在打"),
    soon: t("{n} 分钟内", { n: QUEUE_SOON_MIN }),
    queued: t("排队中"),
    unregistered: t("未登记"),
  };

  const title = t("球场图");
  return (
    <Panel title={title} label={title} compact class="cq-map-panel" onClose={props.onClose}>
      <ul class="cq-map-grid">
        {ROWS.flatMap((row, y) =>
          row.flatMap((n, x) => {
            if (n === null) return [];
            const tone = tones.get(n) ?? "unregistered";
            const label = t("{n} 号场：{status}", { n, status: labels[tone] });
            return (
              <li
                key={n}
                class={`cq-map-court ${tone}${y === 3 ? " across-aisle" : ""}`}
                style={{ gridColumn: `${2 * x + (y === 0 ? 2 : 1)} / span 2`, gridRow: y + 1 }}
                title={label}
              >
                <span aria-hidden="true">{n}</span>
                <span class="sr-only">{label}</span>
              </li>
            );
          }),
        )}
      </ul>
      <ul class="cq-map-key">
        {(Object.keys(labels) as Tone[]).map((tone) => (
          <li key={tone}>
            <i class={tone} aria-hidden="true" />
            {labels[tone]}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
