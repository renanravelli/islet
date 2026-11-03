// Live state from the shell: fetched once, then kept current by its events.

import type { AppInfo, AppSettings, UiSnapshot } from "@islet/ui-types";
import { useEffect, useState } from "react";
import { type Locale, resolveLocale } from "../i18n/i18n";
import { api, on } from "./api";

function useLive<T>(
  initial: () => Promise<T>,
  event: "snapshot" | "preview" | "settings" | "app-info",
): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    void initial().then((v) => alive && setValue((current) => current ?? v));
    const stop = on(event, (payload) => setValue(payload as T));
    return () => {
      alive = false;
      stop();
    };
    // `initial` and `event` are module-level constants: this subscribes once.
  }, [initial, event]);
  return value;
}

export const useSnapshot = () => useLive<UiSnapshot>(api.snapshot, "snapshot");
export const usePreview = () => useLive<UiSnapshot>(api.previewSnapshot, "preview");
export const useSettings = () => useLive<AppSettings>(api.settings, "settings");
export const useAppInfo = () => useLive<AppInfo>(api.appInfo, "app-info");

export function useAppLocale(): Locale | undefined {
  const settings = useSettings();
  const info = useAppInfo();
  if (!settings || !info) return undefined;
  return resolveLocale(settings.language, info.system_language);
}

/** Tells the shell the window has painted, so it can show it without a flash. */
export function useWindowReady(ready: boolean): void {
  useEffect(() => {
    if (ready) requestAnimationFrame(() => void api.windowReady());
  }, [ready]);
}
