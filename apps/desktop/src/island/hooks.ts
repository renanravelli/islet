// Small time-based helpers for the island.

import type { MeetingSession, Speaker } from "@islet/ui-types";
import { useEffect, useRef, useState } from "react";
import { SPEAKER_HOLD_MS } from "./model";

/** The current time, ticking every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * The active speaker, held for SPEAKER_HOLD_MS after Meet's indicator goes off: it follows
 * the voice's level and flickers. A different session starts fresh.
 */
export function useHeldSpeaker(session: MeetingSession | null): Speaker | null {
  const [held, setHeld] = useState<Speaker | null>(null);
  const sessionId = session ? `${session.key.provider}/${session.key.id}` : null;
  const current = session?.status.phase === "active" ? session.active_speaker : null;
  const lastKey = useRef(sessionId);

  useEffect(() => {
    if (lastKey.current !== sessionId) {
      lastKey.current = sessionId;
      setHeld(current);
      return;
    }
    if (current) {
      setHeld(current);
      return;
    }
    const id = setTimeout(() => setHeld(null), SPEAKER_HOLD_MS);
    return () => clearTimeout(id);
  }, [sessionId, current]);

  return current ?? held;
}

/** For an ended session: the call's length, frozen when it ended. */
export function useEndedDuration(session: MeetingSession | null): number | undefined {
  const frozen = useRef<{ id: string; ms: number } | null>(null);
  if (session?.status.phase !== "ended") {
    frozen.current = null;
    return undefined;
  }
  if (!session) return undefined;
  const id = `${session.key.provider}/${session.key.id}`;
  if (frozen.current?.id !== id) frozen.current = { id, ms: Date.now() - session.started_at };
  return frozen.current.ms;
}
