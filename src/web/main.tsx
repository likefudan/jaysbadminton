import { render } from "preact";
import { LocationProvider, Route, Router } from "preact-iso";
import { ComingSoon } from "./pages/ComingSoon";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import "./styles.css";

function App() {
  return (
    <LocationProvider>
      <Router>
        <Route path="/" component={Home} />
        <Route path="/join" component={ComingSoon} />
        <Route default component={NotFound} />
      </Router>
    </LocationProvider>
  );
}

render(<App />, document.getElementById("app")!);
