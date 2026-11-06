import { useEffect, useState } from "preact/hooks";
import { onRefreshing, refreshAll } from "./hooks";
import { standalone } from "./Install";
import { panelOpen } from "./Panel";
import { t } from "./i18n";

const PULL_PX = 70;

/**
 * 下拉刷新 for the app on the home screen, which has no reload button and (on iPhone) no
 * pull-to-refresh of its own. In a browser tab the browser's own reload does this.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => onRefreshing(setBusy), []);
  useEffect(() => {
    if (!standalone()) return;
    let startY: number | null = null;
    let dy = 0;
    const start = (e: TouchEvent) => {
      // A panel scrolls on its own; pulling it down is not a refresh.
      startY = !panelOpen() && window.scrollY <= 0 && e.touches.length === 1 ? (e.touches[0]?.clientY ?? null) : null;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (startY === null || y === undefined) return;
      dy = y - startY;
      setPull(dy > 0 && window.scrollY <= 0 ? Math.min(dy, PULL_PX * 1.6) : 0);
    };
    const end = () => {
      if (startY !== null && dy >= PULL_PX) refreshAll();
      startY = null;
      dy = 0;
      setPull(0);
    };
    addEventListener("touchstart", start, { passive: true });
    addEventListener("touchmove", move, { passive: true });
    addEventListener("touchend", end);
    addEventListener("touchcancel", end);
    return () => {
      removeEventListener("touchstart", start);
      removeEventListener("touchmove", move);
      removeEventListener("touchend", end);
      removeEventListener("touchcancel", end);
    };
  }, []);
  if (!busy && pull < 12) return null;
  const label = busy ? t("刷新中…") : pull >= PULL_PX ? t("松开刷新") : t("下拉刷新");
  return (
    <div
      class="pull-refresh"
      role="status"
      style={{ transform: `translateY(${busy ? 0 : Math.min(pull - PULL_PX, 0)}px)` }}
    >
      {label}
    </div>
  );
}
