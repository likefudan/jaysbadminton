import { useEffect } from "preact/hooks";

type Badged = Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

/**
 * The number on the home-screen icon: how many events are waiting for this member's payment
 * (Ke Li 2026-11-15). Set whenever 我的活动 loads; nothing where the browser has no badge.
 */
export function AppBadge(props: { count: number }) {
  useEffect(() => {
    const nav = navigator as Badged;
    try {
      void (props.count > 0 ? nav.setAppBadge?.(props.count) : nav.clearAppBadge?.())?.catch(() => {});
    } catch {
      // not allowed here: no badge
    }
  }, [props.count]);
  return null;
}
