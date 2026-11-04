// The UI's only way to talk to the shell (apps/desktop/src-tauri/src/commands.rs). Outside
// Tauri (the Vite dev server in a browser, tests) it falls back to an in-memory stand-in.

import type {
  AppInfo,
  AppSettings,
  BridgeState,
  Command,
  CommandError,
  IslandLayout,
  Link,
  Requirements,
  SessionKey,
  UiSnapshot,
  UpdateState,
} from "@islet/ui-types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type Events = {
  snapshot: UiSnapshot;
  preview: UiSnapshot;
  settings: AppSettings;
  "app-info": AppInfo;
  update: UpdateState;
  "island-toggle": null;
  "island-blur": null;
  /** The pointer entered (true) or left (false) the island panel. */
  "island-hover": boolean;
};

const fallback = {
  settings: {
    language: "auto",
    expand_on_hover: false,
    show_participant_names: true,
    muted_speaking_alert: false,
    onboarding_completed_at: null,
    meet_pip_tip_ack: false,
    check_for_updates: false,
  } satisfies AppSettings as AppSettings,
  info: {
    version: "0.1.0",
    system_language: typeof navigator === "undefined" ? "en" : navigator.language,
    geometry: { has_notch: true, notch_width: 185, top_inset: 32 },
    shortcuts: { toggle_island: true, toggle_mic: true },
    bridge: { state: "ready" },
    demo: false,
  } satisfies AppInfo as AppInfo,
  snapshot: { primary: null, providers: [] } satisfies UiSnapshot as UiSnapshot,
  requirements: { chrome: true, in_applications: true } satisfies Requirements as Requirements,
  update: { state: "idle" } satisfies UpdateState as UpdateState,
};

async function call<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  offline: () => T,
): Promise<T> {
  return inTauri ? invoke<T>(command, args) : offline();
}

export const api = {
  appInfo: () => call<AppInfo>("app_info", undefined, () => fallback.info),
  snapshot: () => call<UiSnapshot>("snapshot", undefined, () => fallback.snapshot),
  previewSnapshot: () => call<UiSnapshot>("preview_snapshot", undefined, () => fallback.snapshot),
  settings: () => call<AppSettings>("settings", undefined, () => fallback.settings),
  setSettings: (settings: AppSettings) =>
    call<AppSettings>("set_settings", { settings }, () => {
      fallback.settings = settings;
      return settings;
    }),
  finishOnboarding: () => call<void>("finish_onboarding", undefined, () => undefined),
  execute: (key: SessionKey, command: Command) =>
    call<void>("execute", { key, command }, () => undefined) as Promise<void>,
  islandLayout: (layout: IslandLayout) => call<void>("island_layout", { layout }, () => undefined),
  windowReady: () => call<void>("window_ready", undefined, () => undefined),
  openWindow: (label: "onboarding" | "settings") =>
    call<void>("open_window", { label }, () => undefined),
  repairBridge: () => call<BridgeState>("repair_bridge", undefined, () => fallback.info.bridge),
  requirements: () => call<Requirements>("requirements", undefined, () => fallback.requirements),
  autostart: () => call<boolean>("autostart", undefined, () => false),
  setAutostart: (on: boolean) => call<boolean>("set_autostart", { on }, () => on),
  diagnostics: () => call<string>("diagnostics", undefined, () => "Islet (offline preview)\n"),
  openLink: (link: Link) => call<void>("open_link", { link }, () => undefined),
  openLogs: () => call<void>("open_logs", undefined, () => undefined),
  updateState: () => call<UpdateState>("update_state", undefined, () => fallback.update),
  checkForUpdates: () =>
    call<UpdateState>("check_for_updates", undefined, (): UpdateState => ({ state: "up_to_date" })),
  installUpdate: () => call<void>("install_update", undefined, () => undefined),
};

/** Subscribes to a shell event; returns the unsubscribe function. */
export function on<E extends keyof Events>(
  event: E,
  handler: (payload: Events[E]) => void,
): () => void {
  if (!inTauri) return () => {};
  const stop = listen<Events[E]>(event, (e) => handler(e.payload));
  return () => {
    void stop.then((unlisten) => unlisten());
  };
}

export type { CommandError };
