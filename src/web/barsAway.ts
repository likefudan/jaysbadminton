import { useEffect } from "preact/hooks";

/** How far the page must move one way before the bars follow, so a shaky finger doesn't flicker them. */
const STEP = 10;

/**
 * Slides the top bar up and the app's bottom tabs down while the finger pushes the page up (reading
 * on), and both back in when it pulls the page down (Ke Li 2026-11-18). Sets `bars-away` on <html>;
 * the CSS does the sliding. Always shown near the top of the page and on a new page; the bounce past
 * either end of the page is ignored.
 */
export function useBarsAway(path: string) {
  useEffect(() => {
    const root = document.documentElement;
    let last = window.scrollY;
    let hidden = false;
    const set = (v: boolean) => {
      if (v === hidden) return;
      hidden = v;
      root.classList.toggle("bars-away", v);
    };
    const onScroll = () => {
      const max = root.scrollHeight - window.innerHeight;
      const y = Math.min(Math.max(window.scrollY, 0), Math.max(max, 0));
      if (y < 40) {
        last = y;
        set(false);
        return;
      }
      const dy = y - last;
      if (Math.abs(dy) < STEP) return;
      last = y;
      set(dy > 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      root.classList.remove("bars-away");
    };
  }, [path]);
}
