// Shared wiring for the onboarding and settings windows: language, readiness, ⌘,.

import type { ReactNode } from "react";
import { useEffect } from "react";
import { LocaleProvider } from "../i18n/i18n";
import { api } from "./api";
import { useAppLocale, useWindowReady } from "./hooks";

export function WindowShell({ ready, children }: { ready: boolean; children: ReactNode }) {
  const locale = useAppLocale();
  useWindowReady(ready && locale !== undefined);
  useEffect(() => {
    // ⌘, opens the settings from any Islet window.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        void api.openWindow("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (locale) document.documentElement.lang = locale;
  }, [locale]);
  if (!locale) return null;
  return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
}
