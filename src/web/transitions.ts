type Transitioning = Document & { startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> } };

/**
 * Going from page to page as in an app (Ke Li 2026-11-15): an event's page slides in from the
 * right, other pages cross-fade. A tap on a link to another page of the site is held back, and
 * made again inside the browser's view transition, where the router (preact-iso) takes it as
 * usual. Browsers without view transitions, and people who asked for less motion, go as before.
 * Going back is left to the browser: the iPhone's swipe back brings its own animation.
 */
export function startTransitions() {
  const doc = document as Transitioning;
  if (!doc.startViewTransition) return;
  let again = false;
  addEventListener(
    "click",
    (e) => {
      if (again || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
      if (a.pathname === location.pathname || a.pathname.startsWith("/api/")) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const root = document.documentElement;
      root.dataset.nav = a.pathname.startsWith("/e/") ? "in" : "fade";
      const done = () => delete root.dataset.nav;
      try {
        doc
          .startViewTransition?.(() => {
            again = true;
            try {
              a.click();
            } finally {
              again = false;
            }
            // The router draws the new page in a moment (no frames are drawn while the browser waits here).
            return new Promise<void>((drawn) => setTimeout(() => setTimeout(drawn, 0), 0));
          })
          .finished.then(done, done);
      } catch {
        done();
      }
    },
    true,
  );
}
