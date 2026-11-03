// The island window: holds the interaction state and tells the shell its contour after every
// change, so the panel is always exactly the island's size.

import type { AppInfo, AppSettings, Command, UiSnapshot } from "@islet/ui-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, on } from "../shared/api";
import { useEndedDuration, useHeldSpeaker, useNow } from "./hooks";
import { IslandView } from "./IslandView";
import { contour, IDLE_COLLAPSE_MS, mode as modeOf, type UiState } from "./model";

export function Island({
  snapshot,
  settings,
  info,
}: {
  snapshot: UiSnapshot;
  settings: AppSettings;
  info: AppInfo;
}) {
  const session = snapshot.primary;
  const [ui, setUi] = useState<UiState>({ expanded: false, alertDismissed: false });
  const mode = modeOf(session, ui, settings);
  const speaker = useHeldSpeaker(session);
  const now = useNow(session?.status.phase === "active");
  const endedDuration = useEndedDuration(session);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const collapse = useCallback(() => setUi((u) => ({ ...u, expanded: false })), []);
  const expand = useCallback(() => setUi((u) => ({ ...u, expanded: true })), []);

  // Nothing to expand without a live session; the alert comes back once Meet's notice ends.
  useEffect(() => {
    if (session?.status.phase !== "active") setUi((u) => ({ ...u, expanded: false }));
    if (!session?.signals.speaking_while_muted)
      setUi((u) => (u.alertDismissed ? { ...u, alertDismissed: false } : u));
  }, [session]);

  // Tell the shell the contour; it moves and resizes the panel to match.
  const { width, height } = contour(mode, info.geometry);
  useEffect(() => {
    void api.islandLayout({
      visible: mode !== "hidden",
      width,
      height,
      focused: mode === "expanded",
    });
  }, [mode, width, height]);

  // Collapse: Esc, a click elsewhere (the panel loses key status), the chevron, or 6 s idle.
  const armIdle = useCallback(() => {
    clearTimeout(idle.current);
    idle.current = setTimeout(collapse, IDLE_COLLAPSE_MS);
  }, [collapse]);
  useEffect(() => {
    if (mode !== "expanded") {
      clearTimeout(idle.current);
      return;
    }
    armIdle();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && collapse();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(idle.current);
    };
  }, [mode, armIdle, collapse]);
  useEffect(() => on("island-blur", collapse), [collapse]);
  useEffect(
    () =>
      on("island-toggle", () => {
        setUi((u) => ({ ...u, expanded: !u.expanded }));
      }),
    [],
  );

  const run = (command: Command) => {
    if (!session) return;
    // No optimistic UI: the island changes only when the provider confirms.
    api.execute(session.key, command).catch(() => {});
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer tracking only; controls are real buttons
    <div
      className="island-root"
      onMouseEnter={() => {
        if (mode === "expanded") clearTimeout(idle.current);
        else if (mode === "compact" && settings.expand_on_hover) expand();
      }}
      onMouseMove={() => mode === "expanded" && clearTimeout(idle.current)}
      onMouseLeave={() => mode === "expanded" && armIdle()}
    >
      <IslandView
        mode={mode}
        session={session}
        speaker={speaker}
        geometry={info.geometry}
        now={now}
        endedDuration={endedDuration}
        interactive
        onExpand={expand}
        onCollapse={collapse}
        onCommand={run}
        onDismissAlert={() => setUi((u) => ({ ...u, alertDismissed: true }))}
      />
    </div>
  );
}
