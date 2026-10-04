import ReactDOM from "react-dom/client";
import App from "./App";
import { dismissSplash } from "./lib/splash";

// The app lifts the splash when it is ready (useDismissSplash). If that never
// happens, don't leave the user looking at it.
window.setTimeout(dismissSplash, 8000);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // <React.StrictMode>
  <App />,
  // </React.StrictMode>,
);
