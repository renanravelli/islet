// Draws the island for a given state. No timers or shell calls here: the window (Island.tsx)
// and the onboarding preview drive it.

import type { Geometry, MeetingSession, Speaker } from "@islet/ui-types";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useT } from "../i18n/i18n";
import {
  CamIcon,
  CamOffIcon,
  CheckIcon,
  ChevronUpIcon,
  HandIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  PersonIcon,
  TabIcon,
} from "../shared/icons";
import {
  avatarColor,
  type Control,
  contour,
  controls,
  duration,
  earWidth,
  initials,
  type Mode,
  SIZE,
} from "./model";
import "./island.css";

export interface IslandViewProps {
  mode: Mode;
  session: MeetingSession | null;
  /** The speaker to show, held briefly by the caller so it does not flicker. */
  speaker: Speaker | null;
  /** Who spoke last, shown (as such) while nobody is speaking. */
  lastSpeaker?: Speaker | null;
  geometry: Geometry;
  now: number;
  /** For an ended session: how long the call lasted. */
  endedDuration?: number;
  /** The pointer is over the island: the compact island grows a little. */
  hovered?: boolean;
  /** A command sent and not confirmed yet: its button shows it is working. */
  pending?: Control["command"] | null;
  /** A command that just failed: its button flashes. */
  failed?: Control["command"] | null;
  onExpand?: () => void;
  onCollapse?: () => void;
  onCommand?: (control: Control["command"]) => void;
  onDismissAlert?: () => void;
  /** The onboarding preview is not interactive. */
  interactive?: boolean;
}

/** Waveform bar heights from the canvas, per place. */
const WAVE = {
  compact: [6, 12, 16, 9, 5],
  pill: [6, 12, 16, 9],
  expanded: [8, 14, 20, 12, 6, 10, 16],
  alert: [6, 13, 16, 8],
} as const;

/** The expanded island's content width: 560 minus the 20 + 20 padding. */
const EXPANDED_INNER = SIZE.expandedWidth - 40;
/** The alert's content width: 440 minus the 16 + 16 padding. */
const ALERT_INNER = SIZE.alertWidth - 32;

export function IslandView(props: IslandViewProps) {
  const { mode, geometry } = props;
  const reduced = useReducedMotion();
  if (mode === "hidden" || !props.session) return null;
  const { width, height } = contour(
    mode,
    geometry,
    props.hovered,
    earWidth(props.session, mode, props.now, props.endedDuration),
  );
  const pill = !geometry.has_notch;
  const radius =
    mode === "expanded"
      ? SIZE.expandedRadius
      : mode === "alert"
        ? SIZE.alertRadius
        : pill
          ? height / 2
          : SIZE.compactRadius;
  return (
    <div
      className={`island mode-${mode} ${pill ? "pill" : "notch"}`}
      style={{
        width,
        height,
        // With a notch the island hangs from the screen edge: only its bottom corners round.
        borderRadius: pill ? radius : `0 0 ${radius}px ${radius}px`,
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={mode}
          className="island-content"
          initial={reduced ? false : { opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={reduced ? undefined : { opacity: 0, filter: "blur(4px)" }}
          transition={{ duration: reduced ? 0 : 0.2 }}
        >
          {mode === "expanded" ? (
            <Expanded {...props} />
          ) : mode === "alert" ? (
            <Alert {...props} />
          ) : pill ? (
            <Pill {...props} />
          ) : (
            <Compact {...props} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Avatar({
  speaker,
  size,
  speaking = speaker !== null,
}: {
  speaker: Speaker | null;
  size: number;
  /** The green ring; off for the last speaker. */
  speaking?: boolean;
}) {
  const letters = initials(speaker?.display_name);
  return (
    <span
      className={`avatar ${speaking ? "is-speaking" : ""}`}
      style={{
        width: size,
        height: size,
        // As in the canvas: 8 pt initials at 20, 9 at 24, 15 at 44.
        fontSize: Math.round(size * (size >= 40 ? 0.34 : 0.38)),
        background: avatarColor(speaker?.display_name),
      }}
      aria-hidden="true"
    >
      {letters ?? <PersonIcon size={Math.round(size * 0.6)} />}
    </span>
  );
}

function Wave({
  bars,
  active,
  tone,
}: {
  bars: readonly number[];
  active: boolean;
  tone?: "attention";
}) {
  return (
    <span
      className={`wave ${active ? "active" : ""} ${tone ?? ""}`}
      style={{ height: Math.max(...bars), gap: bars.length > 5 ? 3 : 2 }}
      aria-hidden="true"
    >
      {bars.map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of bars
        <i key={i} style={{ "--h": `${h}px` } as CSSProperties} />
      ))}
    </span>
  );
}

function MicStatus({ session }: { session: MeetingSession }) {
  const t = useT();
  if (session.mic === "unknown") {
    return (
      <span className="status-icon unknown" role="img" aria-label={t("island.unknown")}>
        <MicIcon size={14} />
      </span>
    );
  }
  return session.mic === "off" ? (
    <span className="status-icon danger" role="img" aria-label={t("island.mic_muted")}>
      <MicOffIcon size={14} />
    </span>
  ) : (
    <span className="status-icon" role="img" aria-label={t("island.mic")}>
      <MicIcon size={14} />
    </span>
  );
}

/** Shown only while the camera is on, so the user knows they are on video. */
function CamStatus({ session }: { session: MeetingSession }) {
  const t = useT();
  if (session.cam !== "on") return null;
  return (
    <span className="status-icon" role="img" aria-label={t("island.cam")}>
      <CamIcon size={14} />
    </span>
  );
}

function HandStatus({ session }: { session: MeetingSession }) {
  const t = useT();
  if (session.hand !== "on") return null;
  return (
    <span className="status-icon attention" role="img" aria-label={t("island.hand_lower")}>
      <HandIcon size={14} />
    </span>
  );
}

function DegradedDot({ session }: { session: MeetingSession }) {
  const t = useT();
  if (session.health.status === "ok") return null;
  return (
    <span
      className="degraded-dot"
      role="img"
      title={t("island.degraded_tooltip")}
      aria-label={t("island.degraded_tooltip")}
    />
  );
}

function Timer({
  session,
  now,
  endedDuration,
}: {
  session: MeetingSession;
  now: number;
  endedDuration?: number;
}) {
  return (
    <span className="timer tabular">{duration(endedDuration ?? now - session.started_at)}</span>
  );
}

/** The compact island is a button that expands it, except in the preview and once ended. */
function Expandable({
  props,
  className,
  children,
}: {
  props: IslandViewProps;
  className: string;
  children: ReactNode;
}) {
  const t = useT();
  if (!props.interactive || props.mode === "ended") {
    return <div className={className}>{children}</div>;
  }
  return (
    <button
      type="button"
      className={className}
      aria-label={t("island.expand")}
      onClick={props.onExpand}
    >
      {children}
    </button>
  );
}

/** Whom the island shows: the speaker, else who spoke last, else the user. */
function shownSpeaker(props: IslandViewProps): Speaker | null {
  return props.speaker ?? props.lastSpeaker ?? props.session?.self_participant ?? null;
}

function EndedLabel() {
  const t = useT();
  return (
    <span className="ended-label">
      <CheckIcon size={14} stroke={2.2} />
      {t("island.ended")}
    </span>
  );
}

function Compact(props: IslandViewProps) {
  const session = props.session as MeetingSession;
  const ended = props.mode === "ended";
  const ear = { width: earWidth(session, props.mode, props.now, props.endedDuration) };
  return (
    <Expandable props={props} className={`compact ${ended ? "ended" : ""}`}>
      <span className="ear left" style={ear}>
        {ended ? (
          <EndedLabel />
        ) : (
          <>
            <Avatar speaker={shownSpeaker(props)} speaking={props.speaker !== null} size={20} />
            <Wave bars={WAVE.compact} active={props.speaker !== null} />
          </>
        )}
      </span>
      <span className="notch-gap" style={{ width: props.geometry.notch_width }} />
      <span className="ear right" style={ear}>
        {!ended && <HandStatus session={session} />}
        {!ended && <CamStatus session={session} />}
        {!ended && <MicStatus session={session} />}
        <Timer session={session} now={props.now} endedDuration={props.endedDuration} />
        {!ended && <DegradedDot session={session} />}
      </span>
    </Expandable>
  );
}

/** No notch: the same island as a floating pill below the menu bar. */
function Pill(props: IslandViewProps) {
  const session = props.session as MeetingSession;
  const ended = props.mode === "ended";
  return (
    <Expandable props={props} className={`pill-body ${ended ? "ended" : ""}`}>
      <span className="pill-side">
        {ended ? (
          <EndedLabel />
        ) : (
          <>
            <Avatar speaker={shownSpeaker(props)} speaking={props.speaker !== null} size={20} />
            <Wave bars={WAVE.pill} active={props.speaker !== null} />
          </>
        )}
      </span>
      <span className="pill-title">{ended ? "" : (session.title ?? "")}</span>
      <span className="pill-side">
        {!ended && <HandStatus session={session} />}
        {!ended && <CamStatus session={session} />}
        {!ended && <MicStatus session={session} />}
        <Timer session={session} now={props.now} endedDuration={props.endedDuration} />
        {!ended && <DegradedDot session={session} />}
      </span>
    </Expandable>
  );
}

/** The strip level with the notch: content at both sides, nothing behind the camera. */
function TopStrip({
  geometry,
  inner,
  left,
  right,
}: {
  geometry: Geometry;
  inner: number;
  left: ReactNode;
  right: ReactNode;
}) {
  const gap = geometry.has_notch ? geometry.notch_width : 0;
  const side = Math.max(0, (inner - gap) / 2);
  return (
    <div
      className="top-strip"
      style={{ height: geometry.has_notch ? geometry.top_inset : SIZE.pillHeight }}
    >
      <span className="top-left" style={{ width: side }}>
        {left}
      </span>
      <span className="notch-gap" style={{ width: gap }} />
      <span className="top-right" style={{ width: side }}>
        {right}
      </span>
    </div>
  );
}

function Expanded(props: IslandViewProps) {
  const t = useT();
  const session = props.session as MeetingSession;
  const speaker = props.speaker;
  // Nobody speaking: the last speaker, or before anyone spoke the user, each labelled as such
  // and without the ring or a moving wave.
  const shown = shownSpeaker(props);
  const name = shown?.display_name ?? null;
  return (
    <div className="expanded">
      <TopStrip
        geometry={props.geometry}
        inner={EXPANDED_INNER}
        left={<span className="title">{session.title ?? ""}</span>}
        right={
          <>
            <Timer session={session} now={props.now} />
            <DegradedDot session={session} />
            <button
              type="button"
              className="collapse"
              aria-label={t("island.collapse")}
              onClick={props.onCollapse}
            >
              <ChevronUpIcon size={14} stroke={2.2} />
            </button>
          </>
        }
      />
      <div className="speaking">
        <div className={`speaker-tile ${speaker ? "is-speaking" : ""}`} aria-hidden="true">
          <Avatar speaker={shown} speaking={speaker !== null} size={44} />
          {name && <span className="tile-name">{name}</span>}
        </div>
        <div className="speaking-text">
          <span className="speaking-label">
            {t(
              speaker || !shown
                ? "island.speaking_now"
                : props.lastSpeaker
                  ? "island.last_speaker"
                  : "island.you",
            )}
          </span>
          <span className="speaking-name">
            {name && <span className="name">{name}</span>}
            <Wave bars={WAVE.expanded} active={speaker !== null} />
          </span>
          <Participants session={session} />
        </div>
      </div>
      <div className="controls">
        {controls(session).map((control) => {
          const pending = props.pending === control.command;
          const failed = props.failed === control.command;
          return (
            <div className="control" key={control.command}>
              <button
                type="button"
                className={`control-button look-${control.look} ${pending ? "pending" : ""} ${failed ? "failed" : ""}`}
                aria-label={t(control.aria)}
                aria-busy={pending || undefined}
                aria-pressed={control.command === "toggle_hand" ? session.hand === "on" : undefined}
                onClick={() => !pending && props.onCommand?.(control.command)}
              >
                <ControlIcon control={control} />
              </button>
              <span className="control-label" aria-hidden="true">
                {t(control.label)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The avatar row: a few known participants, "+N" for the rest, and the count. */
function Participants({ session }: { session: MeetingSession }) {
  const t = useT();
  const count = session.participant_count;
  const shown = session.participants;
  if (count === null && shown.length === 0) return null;
  const rest = count === null ? 0 : count - shown.length;
  return (
    <span className="participants">
      {shown.length > 0 && (
        <span className="avatar-stack" aria-hidden="true">
          {shown.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat or be hidden
            <Avatar key={i} speaker={p} speaking={false} size={24} />
          ))}
          {rest > 0 && <span className="avatar more">+{rest}</span>}
        </span>
      )}
      {count !== null && t("island.participants", { n: count })}
    </span>
  );
}

function ControlIcon({ control }: { control: Control }) {
  switch (control.command) {
    case "toggle_mic":
      return control.look === "off" ? <MicOffIcon /> : <MicIcon />;
    case "toggle_cam":
      return control.look === "off" ? <CamOffIcon /> : <CamIcon />;
    case "toggle_hand":
      return <HandIcon />;
    case "focus_tab":
      return <TabIcon />;
    case "leave":
      return <LeaveIcon />;
  }
}

function Alert(props: IslandViewProps) {
  const t = useT();
  const pending = props.pending === "toggle_mic";
  return (
    <div className="alert" role="alert">
      <TopStrip
        geometry={props.geometry}
        inner={ALERT_INNER}
        left={
          <span className="alert-tag">
            <MicOffIcon size={14} />
            {t("island.mic_muted")}
          </span>
        }
        right={
          <span className="alert-tag">
            {t("island.you")}
            <Wave bars={WAVE.alert} active tone="attention" />
          </span>
        }
      />
      <p className="alert-text">{t("island.alert")}</p>
      <div className="alert-actions">
        <button type="button" className="alert-button dismiss" onClick={props.onDismissAlert}>
          {t("island.alert_dismiss")}
        </button>
        <button
          type="button"
          className={`alert-button unmute ${pending ? "pending" : ""} ${props.failed === "toggle_mic" ? "failed" : ""}`}
          aria-busy={pending || undefined}
          onClick={() => !pending && props.onCommand?.("toggle_mic")}
        >
          <MicIcon size={16} />
          {t("island.alert_unmute")}
        </button>
      </div>
    </div>
  );
}
