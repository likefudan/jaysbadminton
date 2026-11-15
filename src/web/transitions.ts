type Transitioning = Document & { startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> } };

/**
 * Going from page to page as in an app (Ke Li 2026-11-15): an event's page slides in from the
 * right, other pages cross-fade. A tap on a link to another page of the site, once everything on
 * the page has had its say (a drag that ends on a card is not a tap), is kept from the router
 * (preact-iso) and handed to it inside the browser's view transition instead. Browsers without
 * view transitions, and people who asked for less motion, go as before. Going back is left to
 * the browser: the iPhone's swipe back brings its own animation.
 */
let route: ((url: string) => void) | null = null;
/** The router's own way to go to a page, from inside it (main.tsx). */
export function setRouter(go: (url: string) => void) {
  route = go;
}

export function startTransitions() {
  const doc = document as Transitioning;
  if (!doc.startViewTransition) return;
  // Before the router's own listener on the window: this one is added first.
  addEventListener("click", (e) => {
    if (!route || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.composedPath().find((el) => (el as Element).nodeName === "A" && (el as HTMLAnchorElement).href) as
      | HTMLAnchorElement
      | undefined;
    if (!a || a.origin !== location.origin || a.hasAttribute("download") || !/^(_?self)?$/i.test(a.target)) return;
    if ((a.getAttribute("href") ?? "").startsWith("#")) return;
    if (a.pathname === location.pathname || a.pathname.startsWith("/api/")) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const go = route;
    const url = a.href.replace(location.origin, "");
    const root = document.documentElement;
    root.dataset.nav = a.pathname.startsWith("/e/") ? "in" : "fade";
    const done = () => delete root.dataset.nav;
    try {
      doc
        .startViewTransition?.(() => {
          go(url);
          // The router draws the new page in a moment (no frames are drawn while the browser waits here).
          return new Promise<void>((drawn) => setTimeout(() => setTimeout(drawn, 0), 0));
        })
        .finished.then(done, done);
    } catch {
      done();
      go(url);
    }
  });
}
