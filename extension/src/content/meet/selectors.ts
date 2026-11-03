// Resolves the semantic keys in selectors.json to DOM elements (docs/adr/0004).

import type { DegradedReason } from "@islet/protocol-ts";
import registry from "./selectors.json";

export type Locale = "en" | "pt-BR";
export type LocalePatterns = Partial<Record<Locale, string>>;

export type Strategy =
  | { css: string }
  | { ariaLabel: LocalePatterns; css?: string }
  /** Elements matching `css` whose `aria-labelledby` targets have a matching text. */
  | { labelledBy: LocalePatterns; css: string }
  | { text: LocalePatterns; css: string }
  | { attribute: { name: string; value?: string } };

export type StateRule =
  | { attribute: string; on: string; off: string }
  | { ariaLabel: { on: LocalePatterns; off: LocalePatterns } };

export interface SelectorEntry {
  /** Confirmed in a real call. */
  verified: boolean;
  /** The Meet languages it was confirmed in. */
  verifiedIn?: Locale[];
  /** A required key that cannot be resolved during a call marks the session degraded. */
  required: boolean;
  strategies: Strategy[];
  /** For toggles: how to read on/off from the resolved element. */
  state?: StateRule[];
  /** For the active speaker: where the name is, inside the resolved tile. */
  name?: Strategy[];
  /** For the participant count: where the number is, inside the resolved element. */
  count?: Strategy[];
}

/** Keys whose failure is reported in `degraded_reasons`. */
export type ReportedKey =
  | "leaveButton"
  | "micButton"
  | "camButton"
  | "handButton"
  | "activeSpeaker"
  | "participantCount"
  | "mutedSpeakingNotice"
  | "meetingTitle";

export type SelectorKey =
  | ReportedKey
  /** The host's "leave, do not end the call for everyone" choice. Never reported. */
  | "justLeaveButton";

export interface Registry {
  version: number;
  updated: string;
  keys: Record<SelectorKey, SelectorEntry>;
}

export const SELECTORS = registry as Registry;

/** How each key is reported in `degraded_reasons`. */
export const DEGRADED_REASON: Record<ReportedKey, DegradedReason> = {
  leaveButton: "leave_button",
  micButton: "mic_button",
  camButton: "cam_button",
  handButton: "hand_button",
  activeSpeaker: "active_speaker",
  participantCount: "participant_count",
  mutedSpeakingNotice: "muted_speaking_notice",
  meetingTitle: "meeting_title",
};

/** Every key in the registry. */
export const SELECTOR_KEYS: SelectorKey[] = [
  ...(Object.keys(DEGRADED_REASON) as ReportedKey[]),
  "justLeaveButton",
];

const compiled = new Map<string, RegExp>();

function regex(pattern: string): RegExp {
  let re = compiled.get(pattern);
  if (!re) {
    re = new RegExp(pattern, "i");
    compiled.set(pattern, re);
  }
  return re;
}

/** Whether `value` matches the pattern of any locale. */
export function matchesAny(value: string | null, patterns: LocalePatterns): boolean {
  if (value === null) return false;
  return Object.values(patterns).some(
    (pattern) => pattern !== undefined && regex(pattern).test(value),
  );
}

function query(root: ParentNode, css: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(css));
  } catch {
    // An invalid selector in the registry is a calibration bug, not a crash.
    return [];
  }
}

function attributeSelector(name: string, value?: string): string {
  return value === undefined ? `[${name}]` : `[${name}=${JSON.stringify(value)}]`;
}

/** Every element one strategy finds, in document order. */
export function matchAll(root: ParentNode, strategy: Strategy): Element[] {
  if ("ariaLabel" in strategy) {
    return query(root, strategy.css ?? "[aria-label]").filter((el) =>
      matchesAny(el.getAttribute("aria-label"), strategy.ariaLabel),
    );
  }
  if ("labelledBy" in strategy) {
    return query(root, strategy.css).filter((el) =>
      labelTargets(el).some((target) =>
        matchesAny(target.textContent?.trim() ?? null, strategy.labelledBy),
      ),
    );
  }
  if ("text" in strategy) {
    return query(root, strategy.css).filter((el) => matchesAny(el.textContent, strategy.text));
  }
  if ("attribute" in strategy) {
    return query(root, attributeSelector(strategy.attribute.name, strategy.attribute.value));
  }
  return query(root, strategy.css);
}

/** The elements an element's `aria-labelledby` points to. */
export function labelTargets(el: Element): Element[] {
  const ids = el.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
  return ids.flatMap((id) => el.ownerDocument.getElementById(id) ?? []);
}

/**
 * Whether the element is laid out on the page. Meet can keep a hidden copy of a control (the
 * lobby's, for example) whose state no longer changes; the rendered one is the live one.
 */
function rendered(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/**
 * The first element any strategy finds, trying them in order, and which strategy found it.
 * Among a strategy's matches the first rendered one wins; with none rendered (or no layout, as
 * in tests), the first match.
 */
export function resolveWith(
  root: ParentNode,
  strategies: Strategy[],
): { element: Element; strategy: number } | null {
  for (const [index, strategy] of strategies.entries()) {
    const matches = matchAll(root, strategy);
    const element = matches.find(rendered) ?? matches[0];
    if (element) return { element, strategy: index };
  }
  return null;
}

/** The first element any strategy finds, trying them in order. */
export function resolve(root: ParentNode, strategies: Strategy[]): Element | null {
  return resolveWith(root, strategies)?.element ?? null;
}

/** Reads on/off from `el` with the key's rules; `unknown` when no rule decides. */
export function readToggle(el: Element, rules: StateRule[]): "on" | "off" | "unknown" {
  for (const rule of rules) {
    if ("attribute" in rule) {
      const value = el.getAttribute(rule.attribute);
      if (value === rule.on) return "on";
      if (value === rule.off) return "off";
    } else {
      const label = el.getAttribute("aria-label");
      if (matchesAny(label, rule.ariaLabel.on)) return "on";
      if (matchesAny(label, rule.ariaLabel.off)) return "off";
    }
  }
  return "unknown";
}
