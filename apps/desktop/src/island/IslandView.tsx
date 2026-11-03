// Draws the island for a given state. No timers or shell calls here: the window (Island.tsx)
// and the onboarding preview drive it.

import type { Geometry, MeetingSession, Speaker } from "@islet/ui-types";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useT } from "../i18n/i18n";
import {
  CamIcon,
  CamOffIcon,
  ChevronUpIcon,
  HandIcon,
  LeaveIcon,
  MicIcon,
  MicOffIcon,
  PersonIcon,
  TabIcon,
} from "../shared/icons";
import { type Control, contour, controls, duration, initials, type Mode, SIZE } from "./model";
import "./island.css";

export interface IslandViewProps {
  mode: Mode;
  session: MeetingSession | null;
  /** The speaker to show, held briefly by the caller so it does not flicker. */
  speaker: Speaker | null;
  geometry: Geometry;
  now: number;
  /** For an ended session: how long the call lasted. */
  endedDuration?: number;
  onExpand?: () => void;
  onCollapse?: () => void;
  onCommand?: (control: Control["command"]) => void;
  onDismissAlert?: () => void;
  /** The onboarding preview is not interactive. */
  interactive?: boolean;
}

export function IslandView(props: IslandViewProps) {
  const { mode, geometry } = props;
  const reduced = useReducedMotion();
  if (mode === "hidden" || !props.session) return null;
  const { width, height } = contour(mode, geometry);
  const pill = !geometry.has_notch;
  const radius =
    mode === "expanded"
      ? SIZE.expandedRadius
      : mode === "alert"
        ? SIZE.alertRadius
        : pill
          ? SIZE.pillHeight / 2
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
          initial={reduced ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
        >
          {mode === "expanded" ? (
            <Expanded {...props} />
          ) : mode === "alert" ? (
            <Alert {...props} />
          ) : (
            <Compact {...props} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Avatar({ speaker, size }: { speaker: Speaker | null; size: number }) {
  const letters = initials(speaker?.display_name);
  return (
    <span
      className={`avatar ${speaker ? "speaking" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {letters ?? <PersonIcon size={Math.round(size * 0.6)} />}
    </span>
  );
}

function Wave({ active }: { active: boolean }) {
  return (
    <span className={`wave ${active ? "active" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
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

function Compact(props: IslandViewProps) {
  const t = useT();
  const session = props.session as MeetingSession;
  const ended = props.mode === "ended";
  const left: ReactNode = ended ? (
    <span className="ended-label">{t("island.ended")}</span>
  ) : (
    <>
      <Avatar speaker={props.speaker} size={20} />
      <Wave active={props.speaker !== null} />
    </>
  );
  const right: ReactNode = (
    <>
      {!ended && session.hand === "on" && (
        <span className="status-icon attention" role="img" aria-label={t("island.hand_lower")}>
          <HandIcon size={14} />
        </span>
      )}
      {!ended && <MicStatus session={session} />}
      <Timer session={session} now={props.now} endedDuration={props.endedDuration} />
      {!ended && <DegradedDot session={session} />}
    </>
  );
  const body = (
    <>
      <span className="ear left">{left}</span>
      <span className="notch-gap" />
      <span className="ear right">{right}</span>
    </>
  );
  if (!props.interactive || ended) {
    return <div className="compact">{body}</div>;
  }
  return (
    <button
      type="button"
      className="compact"
      aria-label={t("island.expand")}
      onClick={props.onExpand}
    >
      {body}
    </button>
  );
}

function Expanded(props: IslandViewProps) {
  const t = useT();
  const session = props.session as MeetingSession;
  const speaker = props.speaker;
  return (
    <div className="expanded" style={{ paddingTop: 0 }}>
      <div
        className="top-strip"
        style={{ height: props.geometry.has_notch ? props.geometry.top_inset : SIZE.pillHeight }}
      >
        <span className="title">{session.title ?? ""}</span>
        <span
          className="notch-gap"
          style={{ width: props.geometry.has_notch ? props.geometry.notch_width : 0 }}
        />
        <span className="top-right">
          <Timer session={session} now={props.now} />
          <DegradedDot session={session} />
          <button
            type="button"
            className="collapse"
            aria-label={t("island.collapse")}
            onClick={props.onCollapse}
          >
            <ChevronUpIcon size={16} />
          </button>
        </span>
      </div>
      <div className="speaking">
        <Avatar speaker={speaker} size={32} />
        <div className="speaking-text">
          <span className="speaking-label">{t("island.speaking_now")}</span>
          <span className="speaking-name">
            {speaker?.display_name ? speaker.display_name : null}
            <Wave active={speaker !== null} />
          </span>
        </div>
        {session.participant_count !== null && (
          <span className="participants">
            {t("island.participants", { n: session.participant_count })}
          </span>
        )}
      </div>
      <div className="controls">
        {controls(session).map((control) => (
          <div className="control" key={control.command}>
            <button
              type="button"
              className={`control-button look-${control.look}`}
              aria-label={t(control.aria)}
              aria-pressed={control.command === "toggle_hand" ? session.hand === "on" : undefined}
              onClick={() => props.onCommand?.(control.command)}
            >
              <ControlIcon control={control} />
            </button>
            <span className="control-label" aria-hidden="true">
              {t(control.label)}
            </span>
          </div>
        ))}
      </div>
    </div>
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
  return (
    <div className="alert">
      <div style={{ height: props.geometry.has_notch ? props.geometry.top_inset : 0 }} />
      <div className="alert-body" role="alert">
        <span className="status-icon danger">
          <MicOffIcon size={18} />
        </span>
        <span className="alert-text">{t("island.alert")}</span>
        <button type="button" className="alert-button dismiss" onClick={props.onDismissAlert}>
          {t("island.alert_dismiss")}
        </button>
        <button
          type="button"
          className="alert-button unmute"
          onClick={() => props.onCommand?.("toggle_mic")}
        >
          {t("island.alert_unmute")}
        </button>
      </div>
    </div>
  );
}
