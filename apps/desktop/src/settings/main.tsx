import { createRoot } from "react-dom/client";
import { useAppInfo, useSettings, useSnapshot } from "../shared/hooks";
import { WindowShell } from "../shared/Window";
import "../shared/tokens.css";
import "../shared/window.css";
import { inTauri } from "../shared/api";
import { type Pane, Settings } from "./Settings";

// In a plain browser (development), ?pane= opens a given pane.
const pane = (!inTauri && (new URLSearchParams(location.search).get("pane") as Pane)) || undefined;

function App() {
  const info = useAppInfo();
  const settings = useSettings();
  const snapshot = useSnapshot();
  const ready = Boolean(info && settings && snapshot);
  return (
    <WindowShell ready={ready}>
      {info && settings && snapshot && (
        <Settings info={info} settings={settings} snapshot={snapshot} initialPane={pane} />
      )}
    </WindowShell>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
