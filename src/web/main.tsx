import { render } from "preact";
import { LocationProvider, Route, Router } from "preact-iso";
import { Admin } from "./pages/Admin";
import { EventPage } from "./pages/EventPage";
import { AdminSetup } from "./pages/AdminSetup";
import { Home } from "./pages/Home";
import { Join } from "./pages/Join";
import { Member, MemberProfilePage } from "./pages/Member";
import { Account, AccountProfile } from "./pages/Account";
import { Privacy, Terms } from "./pages/Legal";
import { NotFound } from "./pages/NotFound";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={Home} />
        <Route path="/join" component={Join} />
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
    </LocationProvider>
  );
}

render(<App />, document.getElementById("app")!);
