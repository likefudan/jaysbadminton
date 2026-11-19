import { useEffect } from "preact/hooks";

/** How far the page must move one way before the bars follow, so a shaky finger doesn't flicker them. */
const STEP = 10;

/**
 * Calls `set(true)` while the finger pushes `el` up (reading on) and `set(false)` when it pulls it
 * back down or comes near the top; the bounce past either end is ignored. Returns the unsubscribe.
 */
export function followScroll(el: HTMLElement | Window, set: (away: boolean) => void): () => void {
  const pos = () => {
    if (el instanceof Window) {
      const root = document.documentElement;
      return { y: window.scrollY, max: root.scrollHeight - window.innerHeight };
    }
    return { y: el.scrollTop, max: el.scrollHeight - el.clientHeight };
  };
  let last = pos().y;
  let hidden = false;
  const put = (v: boolean) => {
    if (v === hidden) return;
    hidden = v;
    set(v);
  };
  const onScroll = () => {
    const p = pos();
    const y = Math.min(Math.max(p.y, 0), Math.max(p.max, 0));
    if (y < 40) {
      last = y;
      put(false);
      return;
    }
    const dy = y - last;
    if (Math.abs(dy) < STEP) return;
    last = y;
    put(dy > 0);
  };
  el.addEventListener("scroll", onScroll, { passive: true });
  return () => el.removeEventListener("scroll", onScroll);
}

/**
 * Slides the top bar up and the app's bottom tabs down while the finger pushes the page up (reading
 * on), and both back in when it pulls the page down (Ke Li 2026-11-18). Sets `bars-away` on <html>;
 * the CSS does the sliding. Always shown near the top of the page and on a new page.
 */
export function useBarsAway(path: string) {
  useEffect(() => {
    const root = document.documentElement;
    const off = followScroll(window, (v) => root.classList.toggle("bars-away", v));
    return () => {
      off();
      root.classList.remove("bars-away");
    };
  }, [path]);
}
