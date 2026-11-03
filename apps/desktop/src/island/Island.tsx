// The island window: holds the interaction state and tells the shell its contour after every
// change, so the panel is always exactly the island's size.

import type { AppInfo, AppSettings, Command, UiSnapshot } from "@islet/ui-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, on } from "../shared/api";
import { useEndedDuration, useHeldSpeaker, useLastSpeaker, useNow } from "./hooks";
import { IslandView } from "./IslandView";
import { contour, IDLE_COLLAPSE_MS, mode as modeOf, type UiState } from "./model";

/** The island's resize transition: the panel shrinks once it is over. */
const SHRINK_DELAY_MS = 280;
/** Opened by hovering, the island closes this long after the pointer leaves. */
const HOVER_COLLAPSE_MS = 400;
/** How long a failed command's button flashes. */
const FAILED_FLASH_MS = 1200;

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
  const lastSpeaker = useLastSpeaker(session, speaker);
  const now = useNow(session?.status.phase === "active");
  const endedDuration = useEndedDuration(session);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [hovered, setHovered] = useState(false);
  /** Opened by the pointer (expand on hover): it closes when the pointer leaves. */
  const byHover = useRef(false);
  const [pending, setPending] = useState<Command | null>(null);
  const [failed, setFailed] = useState<Command | null>(null);

  const collapse = useCallback(() => setUi((u) => ({ ...u, expanded: false })), []);
  const expand = useCallback(() => {
    byHover.current = false;
    setUi((u) => ({ ...u, expanded: true }));
  }, []);

  // Nothing to expand without a live session; the alert comes back once Meet's notice ends.
  useEffect(() => {
    if (session?.status.phase !== "active") setUi((u) => ({ ...u, expanded: false }));
    if (!session?.signals.speaking_while_muted)
      setUi((u) => (u.alertDismissed ? { ...u, alertDismissed: false } : u));
  }, [session]);

  // Tell the shell the contour; it moves and resizes the panel to match. Growing, the panel
  // resizes first and the island animates inside it; shrinking, the island animates first.
  const { width, height } = contour(mode, info.geometry, hovered);
  const shown = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const send = () => {
      shown.current = { width, height };
      void api.islandLayout({
        visible: mode !== "hidden",
        width,
        height,
        focused: mode === "expanded",
        shadow: mode === "expanded" || mode === "alert" || !info.geometry.has_notch,
      });
    };
    const shrinks = width < shown.current.width || height < shown.current.height;
    if (!shrinks || mode === "hidden") {
      send();
      return;
    }
    const id = setTimeout(send, SHRINK_DELAY_MS);
    return () => clearTimeout(id);
  }, [mode, width, height, info.geometry.has_notch]);

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
    if (!session || pending) return;
    // No optimistic UI: the button shows a sent command, and the state changes only when the
    // provider confirms it.
    setPending(command);
    setFailed(null);
    api
      .execute(session.key, command)
      .catch(() => {
        setFailed(command);
        setTimeout(() => setFailed((f) => (f === command ? null : f)), FAILED_FLASH_MS);
      })
      .finally(() => setPending(null));
  };

  // The pointer: the panel reports it (WebKit tracks it only for the active app, and Islet never
  // is), and the DOM events cover the browser preview. Both may fire; the handlers are idempotent.
  const pointer = useCallback(
    (inside: boolean) => {
      setHovered(inside);
      if (inside) {
        clearTimeout(idle.current);
        if (mode === "compact" && settings.expand_on_hover) {
          byHover.current = true;
          setUi((u) => ({ ...u, expanded: true }));
        }
      } else if (mode === "expanded") {
        if (byHover.current) {
          clearTimeout(idle.current);
          idle.current = setTimeout(collapse, HOVER_COLLAPSE_MS);
        } else {
          armIdle();
        }
      }
    },
    [mode, settings.expand_on_hover, armIdle, collapse],
  );
  useEffect(() => on("island-hover", pointer), [pointer]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer tracking only; controls are real buttons
    <div
      className="island-root"
      onMouseEnter={() => pointer(true)}
      onMouseMove={() => mode === "expanded" && clearTimeout(idle.current)}
      onMouseLeave={() => pointer(false)}
    >
      <IslandView
        mode={mode}
        session={session}
        speaker={speaker}
        lastSpeaker={lastSpeaker}
        geometry={info.geometry}
        now={now}
        endedDuration={endedDuration}
        hovered={hovered}
        pending={pending}
        failed={failed}
        interactive
        onExpand={expand}
        onCollapse={collapse}
        onCommand={run}
        onDismissAlert={() => setUi((u) => ({ ...u, alertDismissed: true }))}
      />
    </div>
  );
}
