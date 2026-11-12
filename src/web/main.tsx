import { Fragment, h, render, type ComponentChildren, type ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LocationProvider, Route, Router } from "preact-iso";
import { EventPage } from "./pages/EventPage";
import { Home } from "./pages/Home";
import { Member, MemberProfilePage } from "./pages/Member";
import { Account, AccountProfile } from "./pages/Account";
import { NotFound } from "./pages/NotFound";
import { PullToRefresh } from "./PullToRefresh";
import { addMessages, chosenLang, listeners, useActiveLang } from "./i18n";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import monoFont from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";

// Times and amounts are in the mono font, which the browser would only fetch once the first of them
// is drawn (after the page's data arrives): start it now, so they don't change shape a moment later.
{
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "font";
  link.type = "font/woff2";
  link.crossOrigin = "anonymous";
  link.href = monoFont;
  document.head.append(link);
}

/**
 * Pages most visitors never open download when first opened: the 管理页 with its texts (over half
 * of all the code), and the privacy policy and terms. After a new release the old files are gone,
 * so a page left open since before it fails to fetch them: load the site afresh, once.
 */
function later<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((err) => {
      const KEY = "reloaded-for-code";
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(KEY)) || 0;
        if (Date.now() - last > 60_000) sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        last = Date.now(); // no storage to remember the reload in: don't risk reloading for ever
      }
      if (Date.now() - last > 60_000) location.reload();
      throw err;
    });
}
const adminPages = later(() => import("./pages/adminPages"));
const legalPages = later(() => import("./pages/Legal"));
/**
 * The page once its code is here, nothing until then. Not preact-iso's lazy(): a route that
 * suspends keeps the page before it on screen as well, and going back through the 管理页's own
 * levels left two of them showing.
 */
function page<M, P>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>) {
  let Loaded: ComponentType<P> | null = null;
  return function Page(props: P) {
    const [, redraw] = useState(0);
    useEffect(() => {
      if (!Loaded)
        void load().then(
          (m) => {
            Loaded = pick(m);
            redraw((n) => n + 1);
          },
          () => {}, // later() is reloading the site
        );
    }, []);
    return Loaded ? h(Loaded as ComponentType<object>, props as object) : null;
  };
}
const Admin = page(adminPages, (m) => m.Admin);
const AdminSetup = page(adminPages, (m) => m.AdminSetup);
const Privacy = page(legalPages, (m) => m.Privacy);
const Terms = page(legalPages, (m) => m.Terms);

// Messages from the server are translated from the same tables (tm), and a few a member can get are
// worded in the admin pages' file: in 繁體 and English, fetch that too once the page is up.
const allMessages = () =>
  chosenLang() !== "zh-CN" && void import("./adminMessages").then((m) => addMessages(m.ADMIN_MESSAGES)).catch(() => {});
setTimeout(allMessages, 3000);
listeners.add(allMessages);

/** Renders the page in the chosen language, afresh when it changes. */
function Localized(props: { children: ComponentChildren }) {
  const lang = useActiveLang();
  return <Fragment key={lang}>{props.children}</Fragment>;
}

function App() {
  return (
    <LocationProvider>
      <Localized>
        <PullToRefresh />
        <Router>
          <Route path="/" component={Home} />
          <Route path="/join" component={Account} />
          <Route path="/recover" component={Account} />
          <Route path="/login" component={Account} />
          <Route path="/me" component={Account} />
          <Route path="/me/profile" component={AccountProfile} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/terms" component={Terms} />
          <Route path="/e/:code" component={EventPage} />
          <Route path="/m/:token" component={Member} />
          <Route path="/m/:token/profile" component={MemberProfilePage} />
          <Route path="/admin" component={AdminSetup} />
          <Route path="/admin/:token" component={Admin} />
          <Route default component={NotFound} />
        </Router>
      </Localized>
    </LocationProvider>
  );
}

render(<App />, document.getElementById("app")!);
