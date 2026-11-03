// Resolves the semantic keys in selectors.json to DOM elements (docs/adr/0004).

import type { DegradedReason } from "@islet/protocol-ts";
import registry from "./selectors.json";

export type Locale = "en" | "pt-BR";
export type LocalePatterns = Partial<Record<Locale, string>>;

export type Strategy =
  | { css: string }
  | { ariaLabel: LocalePatterns; css?: string }
  | { text: LocalePatterns; css: string }
  | { attribute: { name: string; value?: string } };

export type StateRule =
  | { attribute: string; on: string; off: string }
  | { ariaLabel: { on: LocalePatterns; off: LocalePatterns } };

export interface SelectorEntry {
  verified: boolean;
  /** A required key that cannot be resolved during a call marks the session degraded. */
  required: boolean;
  strategies: Strategy[];
  /** For toggles: how to read on/off from the resolved element. */
  state?: StateRule[];
  /** For the active speaker: where the name is, inside the resolved tile. */
  name?: Strategy[];
}

export type SelectorKey =
  | "leaveButton"
  | "micButton"
  | "camButton"
  | "handButton"
  | "activeSpeaker"
  | "participantCount"
  | "mutedSpeakingNotice"
  | "meetingTitle";

export interface Registry {
  version: number;
  updated: string;
  keys: Record<SelectorKey, SelectorEntry>;
}

export const SELECTORS = registry as Registry;

/** How each key is reported in `degraded_reasons`. */
export const DEGRADED_REASON: Record<SelectorKey, DegradedReason> = {
  leaveButton: "leave_button",
  micButton: "mic_button",
  camButton: "cam_button",
  handButton: "hand_button",
  activeSpeaker: "active_speaker",
  participantCount: "participant_count",
  mutedSpeakingNotice: "muted_speaking_notice",
  meetingTitle: "meeting_title",
};

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

/** The first element any strategy finds, trying them in order. */
export function resolve(root: ParentNode, strategies: Strategy[]): Element | null {
  for (const strategy of strategies) {
    let found: Element | undefined;
    if ("ariaLabel" in strategy) {
      found = query(root, strategy.css ?? "[aria-label]").find((el) =>
        matchesAny(el.getAttribute("aria-label"), strategy.ariaLabel),
      );
    } else if ("text" in strategy) {
      found = query(root, strategy.css).find((el) => matchesAny(el.textContent, strategy.text));
    } else if ("attribute" in strategy) {
      found = query(root, attributeSelector(strategy.attribute.name, strategy.attribute.value))[0];
    } else {
      found = query(root, strategy.css)[0];
    }
    if (found) return found;
  }
  return null;
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
