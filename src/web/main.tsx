import { Fragment, render, type ComponentChildren } from "preact";
import { LocationProvider, Route, Router } from "preact-iso";
import { Admin } from "./pages/Admin";
import { EventPage } from "./pages/EventPage";
import { AdminSetup } from "./pages/AdminSetup";
import { Home } from "./pages/Home";
import { Member, MemberProfilePage } from "./pages/Member";
import { Account, AccountProfile } from "./pages/Account";
import { Privacy, Terms } from "./pages/Legal";
import { NotFound } from "./pages/NotFound";
import { PullToRefresh } from "./PullToRefresh";
import { useActiveLang } from "./i18n";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

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
