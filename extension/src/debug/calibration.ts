// The calibration runner: walks through the steps in steps.ts in a real call, so the person
// only does what is physical (join from the iPhone, talk, raise a hand). Development builds
// only; see docs/meet-adapter/calibration-session.md.
//
// Instructions go to the console, never onto the page: they would end up in the snapshots.
// Everything it saves is anonymized: snapshots through snapshot.ts, readings with names,
// titles and meeting codes replaced, elements described by tag, role, jsname and the data-*
// attributes selectors use.

import type { Toggle } from "@islet/protocol-ts";
import type { MeetAdapter } from "../content/meet/adapter";
import {
  matchAll,
  type Registry,
  resolveWith,
  SELECTORS,
  type SelectorKey,
} from "../content/meet/selectors";
import type { TabAction } from "../shared/messages";
import { saveFile } from "./save";
import { captureSnapshot, isInChat, redact, selectorDataAttributes } from "./snapshot";
import {
  type Action,
  type Condition,
  type Expected,
  PRESETS,
  type SelfState,
  STEPS,
  type Step,
} from "./steps";

export const POLL_MS = 200;
const NOTICE_WATCH_MS = 60_000;
const SPEAKER_SAMPLE_MS = 500;
const SPEAKER_SAMPLES = 20;
const DIALOG_WATCH_MS = 3000;
const BY_HAND_TIMEOUT_MS = 60_000;
const MAX_LABEL = 60;
const MAX_NOTICE = 120;
/** Live notices worth recording while waiting for the muted notice: they mention the mic or talking. */
const NOTICE_WORDS =
  /microfone|microphone|\bmic\b|mudo|muted|mute|silenciad|falando|talking|speaking/i;

/** Labels of "X raised a hand" notifications and badges (heuristic, also reported). */
const RAISED_HAND =
  /raised (a |their |the )?hand|hand (is )?raised|levantou a m[ãa]o|m[ãa]os? levantadas?/i;

export interface RunnerDeps {
  adapter: MeetAdapter;
  doc?: Document;
  registry?: Registry;
  prompt?: (message: string, value: string) => string | null;
  save?: (name: string, content: string, type: string) => void;
  log?: Pick<Console, "info" | "warn" | "log" | "group" | "groupEnd" | "table">;
}

type Check = Condition | { kind: "self"; field: keyof SelfState; value: Toggle };

interface WaitRecord {
  ask: string;
  until: string;
  status: "met" | "continued" | "timeout";
  waitedMs: number;
}

interface CommandRecord {
  action: TabAction;
  result: string;
  ms: number;
  /** For toggles: the state read before and after. */
  before?: Toggle;
  after?: Toggle;
}

interface ElementInfo {
  strategy: number;
  tag: string;
  role?: string;
  jsname?: string;
  jscontroller?: string;
  data: Record<string, string>;
}

export interface Observed {
  inCall: boolean;
  state: Record<string, unknown>;
  failed: SelectorKey[];
  /** span[data-avatar-count], to compare with participant_count. */
  avatarCount?: number;
  remoteHand: boolean;
  /** Positions (0-based) of the participant tiles the activeSpeaker key matches. No names. */
  speakingTiles: number[];
}

export interface StepRecord {
  number: number;
  id: string;
  title: string;
  status: "done" | "skipped";
  note?: string;
  waits: WaitRecord[];
  commands: CommandRecord[];
  set: { field: keyof SelfState; target: Toggle; outcome: string }[];
  expected?: Expected;
  observed?: Observed;
  mismatches?: { field: string; expected: unknown; observed: unknown }[];
  find?: Record<SelectorKey, ElementInfo | null>;
  files: string[];
  measurements: Record<string, unknown>;
  dialog?: { buttons: string[] };
}

export interface Report {
  tool: "islet-calibration-runner";
  selectorsVersion: number;
  locale: string;
  browser: string;
  date: string;
  entry: string;
  part: "main" | "after-leave";
  steps: StepRecord[];
  /** Required keys that failed at least once, by step. */
  failedKeys: Record<string, SelectorKey[]>;
}

let continueWait: (() => void) | undefined;
let running = false;

/** Ends the current wait as if met: for when the page shows it but the selectors cannot see it. */
export function continueCalibration(): boolean {
  if (!continueWait) return false;
  continueWait();
  return true;
}

export function detectLocale(doc: Document): string {
  const lang = doc.documentElement.lang;
  if (/^pt/i.test(lang)) return "pt-BR";
  if (/^en/i.test(lang)) return "en";
  return lang.replace(/[^a-zA-Z-]/g, "").slice(0, 10) || "unknown";
}

const FIELD_ACTION: Record<keyof SelfState, TabAction> = {
  mic: "toggle_mic",
  cam: "toggle_cam",
  hand: "toggle_hand",
};
const FIELD_NAME: Record<keyof SelfState, string> = {
  mic: "microphone",
  cam: "camera",
  hand: "hand",
};

/**
 * Runs the whole session (`entry` undefined), or one step by id: "lobby" on a pre-join screen,
 * "left" after leaving, or any other step id to redo it.
 */
export async function runCalibration(
  entry: string | undefined,
  deps: RunnerDeps,
): Promise<Report[] | undefined> {
  const log = deps.log ?? console;
  if (running) {
    log.warn("Islet ▸ the calibration runner is already running.");
    return undefined;
  }
  const ids = entry === undefined ? STEPS.map((s) => s.id) : (PRESETS[entry] ?? [entry]);
  const steps = ids.flatMap((id) => STEPS.filter((step) => step.id === id));
  if (steps.length === 0) {
    const entries = [...Object.keys(PRESETS), ...STEPS.map((s) => s.id)];
    log.warn(`Islet ▸ unknown entry "${entry}". Use one of: ${entries.join(", ")}.`);
    return undefined;
  }
  const ask = deps.prompt ?? ((message: string, value: string) => window.prompt(message, value));
  const answer = ask(
    "Islet calibration: names to redact, comma separated (yours and the iPhone's).",
    "",
  );
  if (answer === null) return undefined;

  running = true;
  try {
    return await new Runner(deps, answer.split(","), entry).run(steps);
  } finally {
    running = false;
    continueWait = undefined;
  }
}

class Runner {
  private readonly doc: Document;
  private readonly registry: Registry;
  private readonly save: NonNullable<RunnerDeps["save"]>;
  private readonly log: NonNullable<RunnerDeps["log"]>;
  private readonly locale: string;
  private report: Report;
  private readonly reports: Report[] = [];
  private conditionMetAt = 0;
  private readonly noticeTexts = new Set<string>();

  constructor(
    private readonly deps: RunnerDeps,
    private readonly names: string[],
    private readonly entry: string | undefined,
  ) {
    this.doc = deps.doc ?? document;
    this.registry = deps.registry ?? SELECTORS;
    this.save = deps.save ?? saveFile;
    this.log = deps.log ?? console;
    this.locale = detectLocale(this.doc);
    this.report = this.newReport("main");
  }

  private newReport(part: Report["part"]): Report {
    return {
      tool: "islet-calibration-runner",
      selectorsVersion: this.registry.version,
      locale: this.locale,
      browser: browserName(),
      date: new Date().toISOString().slice(0, 10),
      entry: this.entry ?? "all",
      part,
      steps: [],
      failedKeys: {},
    };
  }

  async run(steps: Step[]): Promise<Report[]> {
    this.log.info(
      `Islet ▸ calibration (${this.locale}): ${steps.length} step(s). Instructions appear here.`,
    );
    for (const step of steps) {
      // Leaving can reload the page and stop this script: save what we have first.
      if (step.id === "leave" && steps.indexOf(step) > 0) {
        this.finish();
        this.report = this.newReport("after-leave");
      }
      this.report.steps.push(await this.runStep(step));
    }
    this.finish();
    this.log.info("Islet ▸ calibration finished. Send the downloaded files.");
    return this.reports;
  }

  private finish(): void {
    if (this.report.steps.length === 0) return;
    const suffix =
      (this.entry !== undefined ? `.${this.entry}` : "") +
      (this.report.part === "after-leave" ? ".after-leave" : "");
    this.saveJson(`calibration-report.${this.locale}${suffix}.json`, this.report);
    this.reports.push(this.report);
  }

  private async runStep(step: Step): Promise<StepRecord> {
    const record: StepRecord = {
      number: step.number,
      id: step.id,
      title: step.title,
      status: "done",
      waits: [],
      commands: [],
      set: [],
      files: [],
      measurements: {},
    };
    if (step.expected) record.expected = step.expected;
    if (step.onlyIf && !this.met(step.onlyIf)) {
      record.status = "skipped";
      record.note =
        step.id === "lobby"
          ? 'Started in a call. On a pre-join screen, run runCalibration("lobby").'
          : "The page did not show this step's starting point.";
      this.log.warn(`Islet ▸ step ${step.number} (${step.title}) skipped: ${record.note}`);
      return record;
    }
    this.log.log(`Islet ▸ step ${step.number}: ${step.title}`);
    for (const action of step.actions) await this.act(action, step, record);
    return record;
  }

  private async act(action: Action, step: Step, record: StepRecord): Promise<void> {
    switch (action.kind) {
      case "wait":
        record.waits.push(await this.waitFor(action.until, action.timeoutMs, action.ask));
        break;
      case "set":
        await this.setSelf(action.self, record);
        break;
      case "tell":
        this.log.info(`Islet ▸ ${action.text}`);
        break;
      case "pause":
        record.waits.push(await this.pause(action.text, action.ms));
        break;
      case "capture":
        this.capture(step, record);
        break;
      case "commands":
        for (const field of ["mic", "cam", "hand"] as const)
          record.commands.push(await this.command(field));
        break;
      case "noticeDuration":
        record.measurements.noticeVisibleMs = await this.noticeDuration(record);
        record.measurements.noticeTexts = [...this.noticeTexts];
        break;
      case "speakerStability":
        record.measurements.speaker = await this.speakerStability();
        break;
      case "leave":
        await this.leave(record);
        break;
    }
  }

  // --- Reading the page -----------------------------------------------------------------

  private read(field: keyof SelfState): Toggle {
    return this.deps.adapter.readState().state.self[field];
  }

  private met(check: Check): boolean {
    const adapter = this.deps.adapter;
    switch (check.kind) {
      case "inCall":
        return adapter.detectInCall() === check.value;
      case "participants":
        return adapter.readState().state.participant_count === check.count;
      case "speakingWhileMuted":
        return adapter.readState().state.signals.speaking_while_muted === true;
      case "activeSpeaker":
        return adapter.readState().state.active_speaker !== undefined;
      case "remoteHand":
        return this.remoteHandRaised();
      case "self":
        return this.read(check.field) === check.value;
    }
  }

  private remoteHandRaised(): boolean {
    const own = resolveWith(this.doc, this.registry.keys.handButton.strategies)?.element;
    for (const el of this.doc.querySelectorAll("[aria-label]")) {
      if (own && (el === own || own.contains(el))) continue;
      if (!isInChat(el) && RAISED_HAND.test(el.getAttribute("aria-label") ?? "")) return true;
    }
    for (const el of this.doc.querySelectorAll("[role='alert'], [role='status'], [aria-live]")) {
      if (!isInChat(el) && RAISED_HAND.test(el.textContent ?? "")) return true;
    }
    return false;
  }

  private observe(): Observed {
    const { state, failed } = this.deps.adapter.readState();
    const safe: Record<string, unknown> = { ...state, meeting_code: "[meeting-code]" };
    if (state.title !== undefined) safe.title = "[title]";
    if (state.active_speaker !== undefined) safe.active_speaker = { display_name: "[name]" };
    if (state.self_participant !== undefined) safe.self_participant = { display_name: "[name]" };
    if (state.participants !== undefined) {
      safe.participants = state.participants.map(() => ({ display_name: "[name]" }));
    }
    const observed: Observed = {
      inCall: this.deps.adapter.detectInCall(),
      state: safe,
      failed,
      remoteHand: this.remoteHandRaised(),
      speakingTiles: this.speakingTiles(),
    };
    const avatars = this.doc.querySelector("span[data-avatar-count]");
    const avatarText = avatars?.getAttribute("data-avatar-count") || avatars?.textContent || "";
    const avatarCount = /^\s*\d+\s*$/.test(avatarText)
      ? Number.parseInt(avatarText, 10)
      : undefined;
    if (avatarCount !== undefined) observed.avatarCount = avatarCount;
    return observed;
  }

  /** Where each key resolves, without personal data. */
  private findAll(): Record<SelectorKey, ElementInfo | null> {
    const dataAttributes = selectorDataAttributes(this.registry);
    const out = {} as Record<SelectorKey, ElementInfo | null>;
    for (const [key, entry] of Object.entries(this.registry.keys) as [
      SelectorKey,
      Registry["keys"][SelectorKey],
    ][]) {
      const found = resolveWith(this.doc, entry.strategies);
      if (!found) {
        out[key] = null;
        continue;
      }
      const el = found.element;
      const info: ElementInfo = { strategy: found.strategy, tag: el.localName, data: {} };
      for (const name of ["role", "jsname", "jscontroller"] as const) {
        const value = el.getAttribute(name);
        if (value !== null) info[name] = value;
      }
      for (const name of dataAttributes) {
        const value = el.getAttribute(name);
        if (value !== null)
          info.data[name] = /^(true|false|\d{1,3}|)$/.test(value) ? value : "[value]";
      }
      out[key] = info;
    }
    return out;
  }

  // --- Acting ---------------------------------------------------------------------------

  private async waitFor(check: Check, timeoutMs: number, ask: string): Promise<WaitRecord> {
    const record = (status: WaitRecord["status"], waitedMs: number): WaitRecord => ({
      ask,
      until: check.kind,
      status,
      waitedMs,
    });
    const start = Date.now();
    if (this.met(check)) {
      this.conditionMetAt = start;
      return record("met", 0);
    }
    this.log.info(`Islet ▸ ${ask}  (If it already happened, run isletContinue().)`);
    let continued = false;
    continueWait = () => {
      continued = true;
    };
    try {
      while (Date.now() - start < timeoutMs) {
        await sleep(POLL_MS);
        if (check.kind === "speakingWhileMuted") this.collectNotices();
        if (this.met(check)) {
          this.conditionMetAt = Date.now();
          return record("met", Date.now() - start);
        }
        if (continued) {
          this.conditionMetAt = Date.now();
          return record("continued", Date.now() - start);
        }
      }
      this.log.warn(`Islet ▸ not detected within ${Math.round(timeoutMs / 1000)} s; moving on.`);
      return record("timeout", Date.now() - start);
    } finally {
      continueWait = undefined;
    }
  }

  private async command(field: keyof SelfState): Promise<CommandRecord> {
    const action = FIELD_ACTION[field];
    const before = this.read(field);
    const start = Date.now();
    const result = await this.deps.adapter.execute(action);
    return {
      action,
      result: result ?? "confirmed",
      ms: Date.now() - start,
      before,
      after: this.read(field),
    };
  }

  private async setSelf(target: SelfState, record: StepRecord): Promise<void> {
    for (const field of ["mic", "cam", "hand"] as const) {
      const want = target[field];
      const now = this.read(field);
      if (now === want) {
        record.set.push({ field, target: want, outcome: "already" });
        continue;
      }
      if (now !== "unknown") {
        const command = await this.command(field);
        record.commands.push(command);
        if (command.after === want) {
          record.set.push({ field, target: want, outcome: "set through execute" });
          continue;
        }
      }
      // The state cannot be read, or execute did not get there: ask for it by hand.
      const position = field === "hand" ? (want === "on" ? "up" : "down") : want;
      const ask =
        this.read(field) === "unknown"
          ? `Islet cannot read the ${FIELD_NAME[field]}. Make sure it is ${position} on the Mac, then run isletContinue().`
          : `Turn the ${FIELD_NAME[field]} ${position} on the Mac by hand.`;
      const wait = await this.waitFor(
        { kind: "self", field, value: want },
        BY_HAND_TIMEOUT_MS,
        ask,
      );
      record.waits.push(wait);
      record.set.push({ field, target: want, outcome: `by hand (${wait.status})` });
    }
  }

  private capture(step: Step, record: StepRecord): void {
    const base = `meet-real-${step.id}.${this.locale}`;
    const observed = this.observe();
    captureSnapshot({
      names: this.names,
      auto: true,
      fileName: `${base}.html`,
      root: this.doc,
      registry: this.registry,
      save: this.save,
      log: this.log,
    });
    record.files.push(`${base}.html`);
    if (step.expected) {
      this.saveJson(`${base}.expected.json`, step.expected);
      record.files.push(`${base}.expected.json`);
      record.mismatches = mismatches(step.expected, observed);
    }
    this.saveJson(`${base}.observed.json`, observed);
    record.files.push(`${base}.observed.json`);
    record.observed = observed;
    record.find = this.findAll();
    if (observed.failed.length > 0) this.report.failedKeys[step.id] = observed.failed;
  }

  private async noticeDuration(record: StepRecord): Promise<number | string> {
    if (record.waits.at(-1)?.status !== "met") return "not measured: the notice was not detected";
    const start = this.conditionMetAt;
    while (Date.now() - start < NOTICE_WATCH_MS) {
      if (!this.met({ kind: "speakingWhileMuted" })) return Date.now() - start;
      await sleep(100);
    }
    return `still visible after ${NOTICE_WATCH_MS} ms`;
  }

  private async speakerStability(): Promise<Record<string, number>> {
    const names = new Set<string>();
    const tiles = new Set<number>();
    let present = 0;
    let changes = 0;
    let last: string | undefined;
    for (let i = 0; i < SPEAKER_SAMPLES; i++) {
      const speaker = this.deps.adapter.readState().state.active_speaker?.display_name;
      if (speaker !== undefined) {
        present++;
        names.add(speaker);
      }
      for (const tile of this.speakingTiles()) tiles.add(tile);
      if (i > 0 && speaker !== last) changes++;
      last = speaker;
      await sleep(SPEAKER_SAMPLE_MS);
    }
    // Only counts: no name leaves this function.
    return {
      samples: SPEAKER_SAMPLES,
      intervalMs: SPEAKER_SAMPLE_MS,
      present,
      changes,
      distinctSpeakers: names.size,
      distinctSpeakingTiles: tiles.size,
    };
  }

  private speakingTiles(): number[] {
    const tiles = [...this.doc.querySelectorAll("[data-participant-id]")];
    const speaking = new Set(
      this.registry.keys.activeSpeaker.strategies.flatMap((s) => matchAll(this.doc, s)),
    );
    return tiles.flatMap((tile, index) => (speaking.has(tile) ? [index] : []));
  }

  /** Texts of live notices that mention the mic or talking, redacted, for calibrating the muted notice. */
  private collectNotices(): void {
    for (const el of this.doc.querySelectorAll("[role='alert'], [role='status'], [aria-live]")) {
      if (isInChat(el)) continue;
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text && NOTICE_WORDS.test(text))
        this.noticeTexts.add(redact(text, this.names).slice(0, MAX_NOTICE));
    }
  }

  private async pause(text: string, ms: number): Promise<WaitRecord> {
    this.log.info(
      `Islet ▸ ${text}  (The runner goes on in ${Math.round(ms / 1000)} s; isletContinue() skips.)`,
    );
    const start = Date.now();
    let continued = false;
    continueWait = () => {
      continued = true;
    };
    try {
      while (Date.now() - start < ms && !continued) await sleep(POLL_MS);
      return {
        ask: text,
        until: "pause",
        status: continued ? "continued" : "met",
        waitedMs: Date.now() - start,
      };
    } finally {
      continueWait = undefined;
    }
  }

  private async leave(record: StepRecord): Promise<void> {
    const dialogs = "[role='dialog'], [role='alertdialog']";
    const before = new Set(this.doc.querySelectorAll(dialogs));
    let dialog: Element | undefined;
    let executing = true;
    // Watch while leaving: the adapter answers the host's dialog itself, so it can be gone by
    // the time execute returns. Its buttons are recorded; the runner never clicks them.
    const watch = (async () => {
      const watchStart = Date.now();
      while (
        Date.now() - watchStart < DIALOG_WATCH_MS &&
        (executing || this.deps.adapter.detectInCall())
      ) {
        dialog = [...this.doc.querySelectorAll(dialogs)].find((el) => !before.has(el));
        if (dialog) {
          record.dialog = {
            buttons: [...dialog.querySelectorAll("button, [role='button']")].map((button) =>
              redact(
                (button.getAttribute("aria-label") || button.textContent || "").trim(),
                this.names,
              ).slice(0, MAX_LABEL),
            ),
          };
          return;
        }
        await sleep(50);
      }
    })();
    const start = Date.now();
    const result = await this.deps.adapter.execute("leave");
    executing = false;
    record.commands.push({
      action: "leave",
      result: result ?? "confirmed",
      ms: Date.now() - start,
    });
    await watch;
    if (this.deps.adapter.detectInCall()) {
      record.waits.push(
        await this.waitFor(
          { kind: "inCall", value: false },
          BY_HAND_TIMEOUT_MS,
          dialog
            ? "Meet asked something before leaving: answer it by hand on the Mac."
            : "Leave the call on the Mac by hand.",
        ),
      );
    }
  }

  private saveJson(name: string, value: unknown): void {
    this.save(name, `${JSON.stringify(value, null, 2)}\n`, "application/json");
  }
}

function mismatches(expected: Expected, observed: Observed): NonNullable<StepRecord["mismatches"]> {
  const out: NonNullable<StepRecord["mismatches"]> = [];
  const check = (field: string, want: unknown, got: unknown) => {
    if (want !== undefined && JSON.stringify(want) !== JSON.stringify(got))
      out.push({ field, expected: want, observed: got });
  };
  const state = observed.state as {
    self?: SelfState;
    participant_count?: number;
    active_speaker?: unknown;
    signals?: { speaking_while_muted?: boolean };
  };
  check("inCall", expected.inCall, observed.inCall);
  if (!observed.inCall) return out;
  check("self", expected.self, state.self);
  check("participant_count", expected.participant_count, state.participant_count);
  check("speaking", expected.speaking, state.active_speaker !== undefined);
  check("speaking_while_muted", expected.speaking_while_muted, state.signals?.speaking_while_muted);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserName(): string {
  const brands = (
    navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }
  ).userAgentData?.brands;
  const brand = brands?.find((b) => b.brand === "Google Chrome");
  return brand ? `${brand.brand} ${brand.version}` : "unknown";
}
