// The calibration session as data. docs/meet-adapter/calibration-session.md describes the same
// steps; extension/test/calibration.test.ts fails if the two diverge.

import type { Toggle } from "@islet/protocol-ts";

export interface SelfState {
  mic: Toggle;
  cam: Toggle;
  hand: Toggle;
}

/** What the page must show for a wait to end. */
export type Condition =
  | { kind: "inCall"; value: boolean }
  | { kind: "participants"; count: number }
  | { kind: "remoteHand" }
  | { kind: "speakingWhileMuted" }
  | { kind: "activeSpeaker" };

/** What a snapshot is expected to show; written next to it as .expected.json. */
export interface Expected {
  inCall: boolean;
  self?: SelfState;
  participant_count?: number;
  speaking?: boolean;
  speaking_while_muted?: boolean;
}

export type Action =
  /** Show one instruction, then wait until the page shows `until` (or isletContinue()). */
  | { kind: "wait"; ask: string; until: Condition; timeoutMs: number }
  /** Put the Mac in this state through isletDebug.execute and confirm it with readState. */
  | { kind: "set"; self: SelfState }
  /** Show one instruction without waiting. */
  | { kind: "tell"; text: string }
  /** Show one instruction, then wait a fixed time (isletContinue() skips it). */
  | { kind: "pause"; text: string; ms: number }
  | { kind: "capture" }
  /** Toggle mic, camera and hand through execute and time each confirmation. */
  | { kind: "commands" }
  /** How long Meet's "are you talking?" notice stays on screen. */
  | { kind: "noticeDuration" }
  /** Sample the active speaker for a while: how stable is it? */
  | { kind: "speakerStability" }
  /** Leave through execute; record any dialog's button labels without clicking them. */
  | { kind: "leave" }
  /** Where Meet draws participant photos and whether their pixels are readable (avatars.ts). */
  | { kind: "avatarProbe"; label: string };

export interface Step {
  number: number;
  /** Also the snapshot's name: meet-real-<id>.<locale>.html. */
  id: string;
  title: string;
  /** Run the step only when the page shows this at the start. */
  onlyIf?: Condition;
  /** Left out of the whole session; run by name or through a preset. */
  onDemand?: boolean;
  actions: Action[];
  expected?: Expected;
}

const MINUTE = 60_000;
const ON_OFF_OFF: SelfState = { mic: "on", cam: "off", hand: "off" };
const ALL_OFF: SelfState = { mic: "off", cam: "off", hand: "off" };

export const STEPS: Step[] = [
  {
    number: 1,
    id: "lobby",
    title: "Lobby",
    onlyIf: { kind: "inCall", value: false },
    actions: [{ kind: "capture" }],
    expected: { inCall: false },
  },
  {
    number: 2,
    id: "in-call-mic-on",
    title: "Both in the call",
    actions: [
      {
        kind: "wait",
        ask: "Join the call on the Mac.",
        until: { kind: "inCall", value: true },
        timeoutMs: 3 * MINUTE,
      },
      { kind: "set", self: ON_OFF_OFF },
      {
        kind: "wait",
        ask: "Join from the iPhone with the meeting code, then admit it on the Mac.",
        until: { kind: "participants", count: 2 },
        timeoutMs: 3 * MINUTE,
      },
      { kind: "capture" },
    ],
    expected: { inCall: true, self: ON_OFF_OFF, participant_count: 2 },
  },
  {
    number: 3,
    id: "in-call-mic-off",
    title: "Mic off, camera on, hand raised",
    actions: [{ kind: "set", self: { mic: "off", cam: "on", hand: "on" } }, { kind: "capture" }],
    expected: { inCall: true, self: { mic: "off", cam: "on", hand: "on" }, participant_count: 2 },
  },
  {
    number: 4,
    id: "commands",
    title: "Commands through Islet",
    actions: [{ kind: "commands" }],
  },
  {
    number: 5,
    id: "remote-hand",
    title: "The iPhone raises its hand",
    actions: [
      { kind: "set", self: ON_OFF_OFF },
      {
        kind: "wait",
        ask: "On the iPhone: mute, turn the camera on and raise the hand.",
        until: { kind: "remoteHand" },
        timeoutMs: 2 * MINUTE,
      },
      { kind: "capture" },
      { kind: "tell", text: "Lower the iPhone's hand." },
    ],
    expected: { inCall: true, self: ON_OFF_OFF, participant_count: 2 },
  },
  {
    number: 6,
    id: "silence",
    title: "Nobody talks",
    actions: [
      { kind: "set", self: ALL_OFF },
      { kind: "pause", text: "Mute the iPhone. Nobody talks for the next 10 s.", ms: 10_000 },
      { kind: "capture" },
      { kind: "speakerStability" },
    ],
    expected: { inCall: true, self: ALL_OFF, speaking: false },
  },
  {
    number: 7,
    id: "speaking-mac",
    title: "The Mac talks",
    actions: [
      { kind: "set", self: ON_OFF_OFF },
      {
        kind: "wait",
        ask: "On the Mac, keep talking with the mic on until the runner moves on. The iPhone stays muted.",
        until: { kind: "activeSpeaker" },
        timeoutMs: 90_000,
      },
      { kind: "capture" },
      { kind: "speakerStability" },
    ],
    expected: { inCall: true, self: ON_OFF_OFF, speaking: true },
  },
  {
    number: 8,
    id: "speaking",
    title: "The iPhone talks",
    actions: [
      { kind: "set", self: ALL_OFF },
      { kind: "pause", text: "Stop talking on the Mac.", ms: 5000 },
      {
        kind: "wait",
        ask: "Unmute the iPhone and keep talking until the runner moves on.",
        until: { kind: "activeSpeaker" },
        timeoutMs: 90_000,
      },
      { kind: "capture" },
      { kind: "speakerStability" },
    ],
    expected: { inCall: true, self: ALL_OFF, speaking: true },
  },
  {
    number: 9,
    id: "muted-speaking",
    title: "Talking with the mic off",
    actions: [
      { kind: "set", self: ALL_OFF },
      { kind: "tell", text: "Mute the iPhone." },
      {
        kind: "wait",
        ask: "On the Mac, keep talking with the mic off until Meet shows its notice.",
        until: { kind: "speakingWhileMuted" },
        timeoutMs: 90_000,
      },
      { kind: "capture" },
      { kind: "noticeDuration" },
    ],
    expected: { inCall: true, self: ALL_OFF, speaking_while_muted: true },
  },
  {
    number: 10,
    id: "leave",
    title: "Leave",
    actions: [
      { kind: "leave" },
      { kind: "tell", text: "On the iPhone, check that the call goes on without the Mac." },
    ],
  },
  {
    number: 11,
    id: "left",
    title: "After leaving",
    onlyIf: { kind: "inCall", value: false },
    actions: [{ kind: "capture" }],
    expected: { inCall: false },
  },
  {
    number: 12,
    id: "avatars",
    title: "Participant photos",
    onlyIf: { kind: "inCall", value: true },
    onDemand: true,
    actions: [
      { kind: "set", self: ALL_OFF },
      {
        kind: "pause",
        text: "On the iPhone, turn the camera off and stay in the call.",
        ms: 10_000,
      },
      { kind: "avatarProbe", label: "tiles" },
      {
        kind: "pause",
        text: "On the Mac, open the People panel (top bar) and leave it open.",
        ms: 10_000,
      },
      { kind: "avatarProbe", label: "people-panel" },
      {
        kind: "pause",
        text: "Close the People panel. On the iPhone, turn the camera on.",
        ms: 10_000,
      },
      { kind: "avatarProbe", label: "camera-on" },
    ],
  },
];

/** Named subsets of the steps, run with runCalibration("<name>"). */
export const PRESETS: Record<string, string[]> = {
  /** Who speaks, the muted notice and leaving as the host, from inside a call or the lobby. */
  short: [
    "in-call-mic-on",
    "silence",
    "speaking-mac",
    "speaking",
    "muted-speaking",
    "leave",
    "left",
  ],
  /** Where Meet draws participant photos, for real avatars on the island. */
  avatars: ["in-call-mic-on", "avatars"],
};
