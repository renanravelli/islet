import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../i18n/i18n";
import { useAppInfo, useAppLocale, useSettings, useSnapshot } from "../shared/hooks";
import "../shared/tokens.css";
import { Island } from "./Island";

function App() {
  const snapshot = useSnapshot();
  const settings = useSettings();
  const info = useAppInfo();
  const locale = useAppLocale();
  if (!snapshot || !settings || !info || !locale) return null;
  return (
    <LocaleProvider locale={locale}>
      <Island snapshot={snapshot} settings={settings} info={info} />
    </LocaleProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
