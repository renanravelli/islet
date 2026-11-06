import type { PromptView } from "@islet/ui-types";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../i18n/i18n";
import { api, on } from "../shared/api";
import { useAppLocale } from "../shared/hooks";
import "../shared/tokens.css";
import { UpdatePrompt } from "./UpdatePrompt";

function App() {
  const locale = useAppLocale();
  const [view, setView] = useState<PromptView | null>(null);
  useEffect(() => {
    let heard = false;
    void api.updatePrompt().then((v) => !heard && setView(v));
    const stop = on("update-prompt", (v) => {
      heard = true;
      setView(v);
    });
    return stop;
  }, []);
  const onLayout = useCallback((height: number) => void api.updatePromptLayout(height), []);
  if (!locale || !view) return null;
  return (
    <LocaleProvider locale={locale}>
      <UpdatePrompt
        view={view}
        onAnswer={(answer) => void api.updatePromptAnswer(answer)}
        onLayout={onLayout}
      />
    </LocaleProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
