// The Meet adapter: reads the call state from the page and performs commands (docs/adr/0004).
//
// It reads only the call controls, the participant tiles' names, the participant count, the
// meeting title and Meet's "are you talking?" notice, each through selectors.json. It never
// reads the chat, never captures audio or video and makes no network requests.

import type { Action, CommandErrorCode, DegradedReason, Toggle } from "@islet/protocol-ts";
import type { TabAction, TabState } from "../../shared/messages";
import {
  DEGRADED_REASON,
  isOnScreen,
  matchAll,
  type Registry,
  type ReportedKey,
  readToggle,
  resolve,
  SELECTORS,
  type SelectorKey,
} from "./selectors";

/** How long a command waits to see its effect before reporting `not_confirmed`. */
export const CONFIRM_TIMEOUT_MS = 1500;
const CONFIRM_POLL_MS = 50;

/** Longest name or title kept; anything longer is cut. */
const MAX_TEXT = 200;

/** A control that would end the meeting for everyone. Islet never clicks one. */
const ENDS_FOR_EVERYONE = /encerrar|para todos|for everyone|for all|end (the )?(call|meeting)/i;

const MEETING_CODE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)/;

/** How many names the avatar row needs (islet-core's MAX_PARTICIPANTS). */
export const MAX_PARTICIPANTS = 3;

const TOGGLES = [
  { action: "toggle_mic", key: "micButton", field: "mic" },
  { action: "toggle_cam", key: "camButton", field: "cam" },
  { action: "toggle_hand", key: "handButton", field: "hand" },
] as const satisfies { action: TabAction; key: SelectorKey; field: keyof TabState["self"] }[];

export interface Reading {
  /** Everything but `started_at`, which the session tracks. */
  state: Omit<TabState, "started_at">;
  /** Required keys that could not be resolved or read. */
  failed: ReportedKey[];
}

export class MeetAdapter {
  constructor(
    private readonly root: Document,
    private readonly registry: Registry = SELECTORS,
  ) {}

  private find(key: SelectorKey): Element | null {
    const entry = this.registry.keys[key];
    return resolve(this.root, entry.strategies, entry.onScreen ? isOnScreen : undefined);
  }

  private toggle(key: SelectorKey): { value: Toggle; found: boolean } {
    const el = this.find(key);
    if (!el) return { value: "unknown", found: false };
    return { value: readToggle(el, this.registry.keys[key].state ?? []), found: true };
  }

  /** In a call (not the lobby, not the home page): the Leave button exists. */
  detectInCall(): boolean {
    return this.find("leaveButton") !== null;
  }

  readState(): Reading {
    const failed = new Set<ReportedKey>();
    const fail = (key: ReportedKey) => {
      if (this.registry.keys[key].required) failed.add(key);
    };

    const leave = this.find("leaveButton");
    if (!leave) fail("leaveButton");

    const self: TabState["self"] = { mic: "unknown", cam: "unknown", hand: "unknown" };
    const capabilities: Action[] = [];
    for (const { action, key, field } of TOGGLES) {
      const { value, found } = this.toggle(key);
      self[field] = value;
      if (found) capabilities.push(action);
      if (value === "unknown") fail(key);
    }
    if (leave) capabilities.push("leave");
    capabilities.push("focus_tab");

    // In an instant meeting the title slot shows the meeting code; the island shows it too,
    // as Meet does.
    const title = text(this.find("meetingTitle"));
    if (title === undefined) fail("meetingTitle");

    let activeSpeaker: string | undefined;
    const tile = this.find("activeSpeaker");
    if (tile) {
      activeSpeaker = text(resolve(tile, this.registry.keys.activeSpeaker.name ?? []));
      if (activeSpeaker === undefined) fail("activeSpeaker");
    }

    const count = this.find("participantCount");
    const countText = count
      ? (resolve(count, this.registry.keys.participantCount.count ?? []) ?? count)
      : null;
    const participants = countText ? firstNumber(countText) : undefined;
    if (participants === undefined) fail("participantCount");

    const degraded: DegradedReason[] = [...failed].map((key) => DEGRADED_REASON[key]);
    const state: Reading["state"] = {
      meeting_code: meetingCode(this.root.location?.pathname ?? ""),
      self,
      signals: { speaking_while_muted: this.find("mutedSpeakingNotice") !== null },
      capabilities,
      health: degraded.length > 0 ? "degraded" : "ok",
    };
    if (title !== undefined) state.title = title;
    if (activeSpeaker !== undefined) state.active_speaker = { display_name: activeSpeaker };
    if (participants !== undefined) state.participant_count = participants;
    const people = this.participants();
    if (people.length > 0) state.participants = people;
    const ownTile = this.find("selfTile");
    const selfName = ownTile
      ? text(resolve(ownTile, this.registry.keys.selfTile.name ?? []))
      : undefined;
    if (selfName !== undefined) state.self_participant = { display_name: selfName };
    if (degraded.length > 0) state.degraded_reasons = degraded;
    return { state, failed: [...failed] };
  }

  /** Up to MAX_PARTICIPANTS names from the participant tiles, in page order, each once. */
  private participants(): { display_name: string }[] {
    const entry = this.registry.keys.participantTile;
    for (const strategy of entry.strategies) {
      const tiles = matchAll(this.root, strategy);
      if (tiles.length === 0) continue;
      const names: string[] = [];
      for (const tile of tiles) {
        const name = text(resolve(tile, entry.name ?? []));
        if (name !== undefined && !names.includes(name)) names.push(name);
        if (names.length === MAX_PARTICIPANTS) break;
      }
      return names.map((display_name) => ({ display_name }));
    }
    return [];
  }

  /** Clicks the control and waits until the change shows on the page. */
  async execute(action: TabAction): Promise<CommandErrorCode | null> {
    if (action === "leave") return this.leave();

    const key = TOGGLES.find((toggle) => toggle.action === action)?.key;
    if (!key) return "unsupported";
    const el = this.find(key);
    if (!el) return "control_not_found";
    const before = this.toggle(key).value;
    click(el);
    const confirmed = await this.waitFor(() => {
      const now = this.toggle(key).value;
      return now !== "unknown" && now !== before;
    });
    return confirmed ? null : "not_confirmed";
  }

  /**
   * Leaves the call, and only leaves: when Meet asks the host whether to end the call for
   * everyone, it picks the plain "leave" choice. Both clicks share the 1.5 s confirmation.
   */
  private async leave(): Promise<CommandErrorCode | null> {
    const leave = this.find("leaveButton");
    if (!leave) return "control_not_found";
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    click(leave);
    await this.waitFor(
      () => !this.detectInCall() || this.find("justLeaveButton") !== null,
      deadline,
    );
    if (!this.detectInCall()) return null;

    const justLeave = this.find("justLeaveButton");
    // A dialog this adapter does not recognize stays on screen for the person to answer.
    if (!justLeave || endsForEveryone(justLeave)) return "not_confirmed";
    click(justLeave);
    return (await this.waitFor(() => !this.detectInCall(), deadline)) ? null : "not_confirmed";
  }

  private async waitFor(
    done: () => boolean,
    deadline = Date.now() + CONFIRM_TIMEOUT_MS,
  ): Promise<boolean> {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
      if (done()) return true;
    }
    return done();
  }
}

function endsForEveryone(el: Element): boolean {
  return ENDS_FOR_EVERYONE.test(`${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`);
}

function click(el: Element): void {
  if (el instanceof HTMLElement) el.click();
  else el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function text(el: Element | null): string | undefined {
  const value = el?.textContent?.replace(/\s+/g, " ").trim();
  return value ? value.slice(0, MAX_TEXT) : undefined;
}

function firstNumber(el: Element): number | undefined {
  const source = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
  const match = source.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

/** The `abc-defg-hij` code from the URL path, or the first path segment. */
export function meetingCode(pathname: string): string {
  return MEETING_CODE.exec(pathname)?.[1] ?? pathname.split("/").filter(Boolean)[0] ?? "";
}
