// The island's rules as pure functions: which state to show, how big its contour is, which
// controls to offer. The component renders what these return; the tests check them.

import type { AppSettings, Command, Geometry, MeetingSession, Toggle } from "@islet/ui-types";
import type { Key } from "../i18n/i18n";

export type Mode = "hidden" | "compact" | "expanded" | "alert" | "ended";

/** Sizes from the approved mock (CLAUDE.md, "Design tokens"), in points. */
export const SIZE = {
  compactWidth: 390,
  ear: 88,
  earPadding: 14,
  compactRadius: 14,
  pillWidth: 340,
  pillHeight: 34,
  expandedWidth: 560,
  expandedRadius: 28,
  /** Below the top strip: 14 + the 99 speaker tile + 16 + 44 buttons + 6 + 13 labels + 18. */
  expandedBody: 210,
  alertWidth: 440,
  alertRadius: 22,
  /** Below the top strip: 10 + one 19 line + 12 + 44 buttons + 14. */
  alertBody: 99,
  /** Under the pointer the compact island and the pill grow a little: the hover cue. */
  hoverGrowWidth: 16,
  hoverGrowHeight: 3,
} as const;

/** Avatar backgrounds from the canvas; white initials pass 4.5:1 on each. */
const AVATAR_COLORS = ["#5E5CE6", "#0B7A75", "#B4581E"] as const;
/** Names seen so far and their color, in memory only (never stored or logged). */
const avatarColors = new Map<string, string>();
const MAX_REMEMBERED = 200;

/**
 * A color per person, given in the order people first appear, as the canvas shows them: the
 * first three people never share a color, and each keeps theirs while the app runs.
 */
export function avatarColor(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  let color = avatarColors.get(name);
  if (color === undefined) {
    if (avatarColors.size >= MAX_REMEMBERED) avatarColors.clear();
    color = AVATAR_COLORS[avatarColors.size % AVATAR_COLORS.length] as string;
    avatarColors.set(name, color);
  }
  return color;
}

/**
 * How long a speaker stays shown after Meet's indicator goes off: it follows the voice's level.
 * Measured 2026-11-03 while one person spoke without stopping: the indicator went off for up to
 * 2 s between words, and Chrome in the background adds about a second (ADR 0005).
 */
export const SPEAKER_HOLD_MS = 3000;
/** The expanded island collapses after this long without the pointer over it. */
export const IDLE_COLLAPSE_MS = 6000;

export interface UiState {
  expanded: boolean;
  /** "Ignore" on the alert, until Meet's notice goes away. */
  alertDismissed: boolean;
}

export function mode(session: MeetingSession | null, ui: UiState, settings: AppSettings): Mode {
  if (!session) return "hidden";
  if (session.status.phase === "ended") return "ended";
  if (ui.expanded) return "expanded";
  if (
    settings.muted_speaking_alert &&
    session.signals.speaking_while_muted &&
    session.mic !== "on" &&
    !ui.alertDismissed
  ) {
    return "alert";
  }
  return "compact";
}

/** The island window's size: exactly its contour, so no invisible area takes clicks. */
/**
 * The right ear's items, measured in Chrome with the island's font (12 pt semibold, tabular
 * digits): a timer digit is 7.9 wide and a colon 4; icons are 14, the degraded dot 6, gaps 7.
 */
const EAR_ITEMS = { icon: 14, dot: 6, gap: 7, digit: 7.9, colon: 4 } as const;

/**
 * The width of each ear around the notch: the mock's 88, or more when the right ear holds the
 * hand, the camera, an hour-long timer or the degraded dot, so nothing slides under the notch.
 * Both ears match, which keeps the notch centered.
 */
export function earWidth(
  session: MeetingSession | null,
  m: Mode,
  now: number,
  endedDuration?: number,
): number {
  if (!session) return SIZE.ear;
  const timer = duration(endedDuration ?? now - session.started_at);
  const colons = timer.split(":").length - 1;
  const items = [(timer.length - colons) * EAR_ITEMS.digit + colons * EAR_ITEMS.colon];
  if (m !== "ended") {
    items.push(EAR_ITEMS.icon);
    if (session.cam === "on") items.push(EAR_ITEMS.icon);
    if (session.hand === "on") items.push(EAR_ITEMS.icon);
    if (session.health.status !== "ok") items.push(EAR_ITEMS.dot);
  }
  const content = items.reduce((sum, w) => sum + w, 0) + EAR_ITEMS.gap * (items.length - 1);
  return Math.max(SIZE.ear, Math.ceil(content));
}

export function contour(
  m: Mode,
  geometry: Geometry,
  hovered = false,
  ear: number = SIZE.ear,
): { width: number; height: number } {
  const top = geometry.has_notch ? geometry.top_inset : SIZE.pillHeight;
  switch (m) {
    case "hidden":
      return { width: 0, height: 0 };
    case "compact":
    case "ended": {
      const base = geometry.has_notch
        ? {
            width: Math.max(SIZE.compactWidth, geometry.notch_width + 2 * (ear + SIZE.earPadding)),
            height: top,
          }
        : { width: SIZE.pillWidth, height: SIZE.pillHeight };
      return hovered && m === "compact"
        ? {
            width: base.width + SIZE.hoverGrowWidth,
            height: base.height + SIZE.hoverGrowHeight,
          }
        : base;
    }
    case "expanded":
      return { width: SIZE.expandedWidth, height: top + SIZE.expandedBody };
    case "alert":
      return { width: SIZE.alertWidth, height: top + SIZE.alertBody };
  }
}

export interface Control {
  command: Command;
  /** The visible 11 pt label. */
  label: Key;
  /** What pressing it does, for VoiceOver. */
  aria: Key;
  /** Off (slashed, white button), on, raised (amber), unknown (neutral) or plain. */
  look: "on" | "off" | "raised" | "unknown" | "plain" | "danger";
}

function toggleLook(toggle: Toggle): Control["look"] {
  return toggle === "on" ? "on" : toggle === "off" ? "off" : "unknown";
}

/** The expanded island's buttons, only for commands the session declares. Chat is hidden. */
export function controls(session: MeetingSession): Control[] {
  const has = (c: Command) => session.capabilities.includes(c);
  const out: Control[] = [];
  if (has("toggle_mic")) {
    out.push({
      command: "toggle_mic",
      label: session.mic === "off" ? "island.mic_muted" : "island.mic",
      aria:
        session.mic === "on"
          ? "island.mic_aria_mute"
          : session.mic === "off"
            ? "island.mic_aria_unmute"
            : "island.unknown",
      look: toggleLook(session.mic),
    });
  }
  if (has("toggle_cam")) {
    out.push({
      command: "toggle_cam",
      label: session.cam === "off" ? "island.cam_off" : "island.cam",
      aria:
        session.cam === "on"
          ? "island.cam_aria_off"
          : session.cam === "off"
            ? "island.cam_aria_on"
            : "island.unknown",
      look: toggleLook(session.cam),
    });
  }
  if (has("toggle_hand")) {
    const raised = session.hand === "on";
    out.push({
      command: "toggle_hand",
      label: raised ? "island.hand_lower" : "island.hand_raise",
      aria:
        session.hand === "unknown"
          ? "island.unknown"
          : raised
            ? "island.hand_lower"
            : "island.hand_raise",
      look: session.hand === "unknown" ? "unknown" : raised ? "raised" : "plain",
    });
  }
  if (has("focus_tab")) {
    out.push({
      command: "focus_tab",
      label: "island.open_tab",
      aria: "island.open_tab_aria",
      look: "plain",
    });
  }
  if (has("leave")) {
    out.push({
      command: "leave",
      label: "island.leave",
      aria: "island.leave_aria",
      look: "danger",
    });
  }
  return out;
}

/** "4:07" or "1:02:03", from milliseconds. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Up to two initials, or null when there is no name (names hidden: a generic avatar). */
export function initials(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || null;
}
