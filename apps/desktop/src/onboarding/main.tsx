import { createRoot } from "react-dom/client";
import { useAppInfo, usePreview, useSettings, useSnapshot } from "../shared/hooks";
import { WindowShell } from "../shared/Window";
import "../shared/tokens.css";
import "../shared/window.css";
import { inTauri } from "../shared/api";
import { Onboarding } from "./Onboarding";

// In a plain browser (development), ?step= opens a given step.
const step = (!inTauri && Number(new URLSearchParams(location.search).get("step"))) || undefined;

function App() {
  const info = useAppInfo();
  const settings = useSettings();
  const snapshot = useSnapshot();
  const preview = usePreview();
  const ready = Boolean(info && settings && snapshot);
  return (
    <WindowShell ready={ready}>
      {info && settings && snapshot && (
        <Onboarding
          info={info}
          settings={settings}
          snapshot={snapshot}
          preview={preview}
          initialStep={step}
        />
      )}
    </WindowShell>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
