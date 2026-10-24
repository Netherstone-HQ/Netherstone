import ReactDOM from "react-dom/client";
import App from "./App";
import { suppressNativeContextMenu } from "./lib/native-context-menu";
import { reopenLastVault } from "./lib/open-vault";
import { dismissSplash } from "./lib/splash";

// The app lifts the splash when it is ready (useDismissSplash). If that never
// happens, don't leave the user looking at it.
window.setTimeout(dismissSplash, 8000);

// Dev builds keep it for Inspect.
if (!import.meta.env.DEV) suppressNativeContextMenu();

// Rust only touches files in the open vault, so it learns which one that is
// before the app asks for any.
void reopenLastVault().finally(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    // <React.StrictMode>
    <App />,
    // </React.StrictMode>,
  ),
);
