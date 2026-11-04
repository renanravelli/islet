// The Meet adapter: reads the call state from the page and performs commands (docs/adr/0004).
//
// It reads only the call controls, the participant tiles' names and photos, the participant
// count, the meeting title and Meet's "are you talking?" notice, each through selectors.json. It
// never reads the chat, never captures audio or video and makes no network requests: a photo is
// the image Meet already loaded, redrawn small (docs/adr/0007).

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
  type Strategy,
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

/** The photo's side in pixels, and the largest data URL sent (islet-core accepts 16 KB). */
// Meet's copy is 75 px; 72 keeps the 44 pt avatar sharp on a Retina screen.
export const AVATAR_SIZE = 72;
const MAX_AVATAR = 12_000;
/** Profile photos. Anything else (a video frame, a blob) is never read. */
const PHOTO_HOST = /(^|\.)googleusercontent\.com$/;

export type CanvasFactory = () => HTMLCanvasElement;

type Named = { display_name: string; avatar?: string };

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
  /** The last photo of each tile (data-participant-id), for the call: a camera turned on hides
   * it. Memory only. */
  private readonly photos = new Map<string, { src: string; data: string }>();
  /** Photo sources that could not be read (a tainted canvas), so they are not tried again. */
  private readonly unreadable = new Set<string>();

  constructor(
    private readonly root: Document,
    private readonly registry: Registry = SELECTORS,
    private readonly makeCanvas: CanvasFactory = () => root.createElement("canvas"),
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
    if (!leave) {
      fail("leaveButton");
      this.photos.clear();
      this.unreadable.clear();
    }

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

    let activeSpeaker: Named | undefined;
    const tile = this.find("activeSpeaker");
    if (tile) {
      activeSpeaker = this.named(tile, this.registry.keys.activeSpeaker);
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
    if (activeSpeaker !== undefined) state.active_speaker = activeSpeaker;
    if (participants !== undefined) state.participant_count = participants;
    const people = this.participants();
    if (people.length > 0) state.participants = people;
    const ownTile = this.find("selfTile");
    const selfParticipant = ownTile ? this.named(ownTile, this.registry.keys.selfTile) : undefined;
    if (selfParticipant !== undefined) state.self_participant = selfParticipant;
    if (degraded.length > 0) state.degraded_reasons = degraded;
    return { state, failed: [...failed] };
  }

  /** Up to MAX_PARTICIPANTS people from the participant tiles, in page order, each once. */
  private participants(): Named[] {
    const entry = this.registry.keys.participantTile;
    for (const strategy of entry.strategies) {
      const tiles = matchAll(this.root, strategy);
      if (tiles.length === 0) continue;
      const people: Named[] = [];
      for (const tile of tiles) {
        const person = this.named(tile, entry);
        if (person && !people.some((p) => p.display_name === person.display_name)) {
          people.push(person);
        }
        if (people.length === MAX_PARTICIPANTS) break;
      }
      return people;
    }
    return [];
  }

  /** A tile's name and, when it can be read, its photo: both from the same tile. */
  private named(
    tile: Element,
    entry: { name?: Strategy[]; avatar?: Strategy[] },
  ): Named | undefined {
    const display_name = text(resolve(tile, entry.name ?? []));
    if (display_name === undefined) return undefined;
    const avatar = this.photo(tile, entry.avatar ?? []);
    return avatar === undefined ? { display_name } : { display_name, avatar };
  }

  /** The tile's photo as a small data URL, or the last one this tile showed. */
  private photo(tile: Element, strategies: Strategy[]): string | undefined {
    const id = tile.getAttribute("data-participant-id");
    const img = resolve(tile, strategies);
    const src = img instanceof HTMLImageElement ? img.currentSrc || img.src : "";
    const known = id === null ? undefined : this.photos.get(id);
    if (
      img instanceof HTMLImageElement &&
      known?.src !== src &&
      isPhoto(src) &&
      img.complete &&
      img.naturalWidth > 0 &&
      !this.unreadable.has(src)
    ) {
      const data = this.redraw(img);
      if (data === undefined) this.unreadable.add(src);
      else if (id === null) return data;
      else this.photos.set(id, { src, data });
    }
    return id === null ? undefined : this.photos.get(id)?.data;
  }

  /** Draws the photo's center square at AVATAR_SIZE. A tainted canvas throws: no photo. */
  private redraw(img: HTMLImageElement): string | undefined {
    try {
      const canvas = this.makeCanvas();
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      const side = Math.min(img.naturalWidth, img.naturalHeight || img.naturalWidth);
      const x = (img.naturalWidth - side) / 2;
      const y = ((img.naturalHeight || side) - side) / 2;
      context.drawImage(img, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      const url = canvas.toDataURL("image/webp", 0.8);
      return url.startsWith("data:image/") && url.length <= MAX_AVATAR ? url : undefined;
    } catch {
      return undefined;
    }
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

function isPhoto(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && PHOTO_HOST.test(url.hostname);
  } catch {
    return false;
  }
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
