// The raised-hands probe for the calibration runner (development builds only): where Meet marks
// other participants' raised hands, and in what order, so the island can show the first one in
// line (step 13 of calibration-session.md).
//
// It records structure only. A matched label or text keeps the matched words ("levantou a mão")
// and replaces the rest with [text], so a name never reaches the report; participants are
// aliases (P1, P2…) in the order the run first sees their data-participant-id.

import { isOnScreen, matchAll, type Registry, resolveWith } from "../content/meet/selectors";
import { ancestors } from "./avatars";
import { isInChat } from "./snapshot";

const MAX_FINDINGS = 30;

/** Labels and texts of "X raised a hand" notifications and badges (heuristic). */
export const RAISED_HAND =
  /raised (a |their |the )?hand|hand (is )?raised|levantou a m[ãa]o|m[ãa]os? levantadas?|lower (their )?hand|abaixar a m[ãa]o de/i;
/** Material Symbols ligatures Meet may draw a hand with. */
const HAND_ICON = /^(front_hand|back_hand|pan_tool)$/;

export interface HandFinding {
  /** A video tile (its position among participantTile matches), the own tile, an element
   * inside something carrying data-participant-id (the People panel), a live notice, or
   * anywhere else. */
  where: "tile" | "self-tile" | "participant-list" | "notice" | "other";
  tile?: number;
  /** The closest data-participant-id, as an alias. */
  participant?: string;
  kind: "label" | "text" | "icon";
  /** The match with everything around it replaced: "[text] levantou a mão", or the icon name. */
  shape: string;
  onScreen: boolean;
  /** Short digits next to it (a position in line?), as found in the same parent. */
  number?: number;
  path: string[];
}

/** Keeps the matched words and hides the rest. */
export function shapeOf(text: string): string {
  const match = RAISED_HAND.exec(text);
  if (!match) return "[text]";
  const before = text.slice(0, match.index).trim() ? "[text] " : "";
  const after = text.slice(match.index + match[0].length).trim() ? " [text]" : "";
  return `${before}${match[0]}${after}`;
}

function nearbyNumber(el: Element): number | undefined {
  const parent = el.parentElement;
  if (!parent) return undefined;
  for (const child of parent.children) {
    const text = child.textContent?.trim() ?? "";
    if (child !== el && /^\d{1,2}$/.test(text)) return Number.parseInt(text, 10);
  }
  return undefined;
}

/** Every raised-hand mark on the page, without personal data, in document order. */
export function probeHands(
  doc: Document,
  registry: Registry,
  aliases: Map<string, string> = new Map(),
): HandFinding[] {
  const tiles = registry.keys.participantTile.strategies.flatMap((s) => matchAll(doc, s));
  const self = resolveWith(doc, registry.keys.selfTile.strategies)?.element;
  const own = resolveWith(doc, registry.keys.handButton.strategies)?.element;

  const alias = (el: Element): string | undefined => {
    const id = el.closest("[data-participant-id]")?.getAttribute("data-participant-id");
    if (!id) return undefined;
    if (!aliases.has(id)) aliases.set(id, `P${aliases.size + 1}`);
    return aliases.get(id);
  };
  const where = (el: Element): Pick<HandFinding, "where" | "tile"> => {
    if (self?.contains(el)) return { where: "self-tile" };
    const tile = tiles.findIndex((t) => t.contains(el));
    if (tile >= 0) return { where: "tile", tile };
    if (el.closest("[data-participant-id]")) return { where: "participant-list" };
    if (el.closest("[role='alert'], [role='status'], [aria-live]")) return { where: "notice" };
    return { where: "other" };
  };

  const found: { el: Element; kind: HandFinding["kind"]; shape: string }[] = [];
  const skip = (el: Element) => isInChat(el) || own?.contains(el) === true;

  for (const el of doc.querySelectorAll("[aria-label]")) {
    const label = el.getAttribute("aria-label") ?? "";
    if (!skip(el) && RAISED_HAND.test(label))
      found.push({ el, kind: "label", shape: shapeOf(label) });
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    const text = node.textContent?.trim() ?? "";
    if (!el || !text || skip(el)) continue;
    if (HAND_ICON.test(text)) found.push({ el, kind: "icon", shape: text });
    else if (RAISED_HAND.test(text)) found.push({ el, kind: "text", shape: shapeOf(text) });
  }

  found.sort((a, b) =>
    a.el === b.el
      ? 0
      : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
  );
  return found.slice(0, MAX_FINDINGS).map(({ el, kind, shape }) => {
    const participant = alias(el);
    const number = nearbyNumber(el);
    return {
      ...where(el),
      ...(participant ? { participant } : {}),
      kind,
      shape,
      onScreen: isOnScreen(el),
      ...(number !== undefined ? { number } : {}),
      path: ancestors(el),
    };
  });
}

/** One line for the console: how many marks, where, and for whom. */
export function summarizeHands(findings: HandFinding[]): string {
  if (findings.length === 0) return "no raised-hand marks found";
  const places = [...new Set(findings.map((f) => f.where))].join(", ");
  const people = [...new Set(findings.flatMap((f) => (f.participant ? [f.participant] : [])))];
  return `${findings.length} mark(s) in ${places}; participants in page order: ${people.join(", ") || "none"}`;
}
