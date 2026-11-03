// Anonymized snapshots of a Meet page for selector calibration. Development builds only.
//
// It keeps only the parts calibration needs (control bars and call buttons, participant tiles,
// notices, the top bar with the title and the People button, everything a selector matches and
// the labels they point to), each with its chain of parent elements but none of their other
// content. From those it removes:
// - every text node except short numbers and UI text a selector matches (a notice, the
//   "People" label); the chat panel; scripts, styles, images, large SVGs, inline styles;
// - title, src, srcset, href and every attribute holding a URL (googleusercontent.com
//   included), event handlers and Google's tracking attributes (jslog, jsaction, jsdata);
// - every data-* attribute no selector uses; ID-like values are replaced by stable
//   placeholders (id-1, id-2...), and so are element IDs and the references to them;
// - meeting codes, e-mail addresses and the given names; free-text labels outside controls.
//
// It cannot know every name on the page: review the summary and the file before sharing it.

import { labelTargets, matchAll, type Registry, SELECTORS } from "../content/meet/selectors";
import { saveFile } from "./save";

export interface SnapshotOptions {
  /** Names to redact: yours and every participant's. */
  names: string[];
  /** No confirmation before saving; the summary is still printed. */
  auto: boolean;
  fileName?: string;
  root?: Document;
  registry?: Registry;
  confirm?: (message: string) => boolean;
  log?: Pick<Console, "group" | "groupEnd" | "log" | "table">;
  save?: (name: string, content: string, type: string) => void;
}

export interface Snapshot {
  html: string;
  /** How many of each thing were removed or redacted. */
  removed: Record<string, number>;
  /** How many elements each region kept. */
  regions: Record<string, number>;
  /** aria-labels kept on controls, after scrubbing; review them for names. */
  keptLabels: string[];
}

const REGIONS: Record<string, string> = {
  controls: "[role='toolbar']",
  buttons: "button[aria-label], [role='button'][aria-label]",
  participants: "[data-participant-id], [data-self-name], [data-participant-name]",
  notices: "[role='alert'], [role='status'], [aria-live]",
  // The top bar, identified by the owner in a real call (selectors.json uses them too).
  topBar:
    "div[jsname='NeC6gb'][jscontroller='yEvoid'], div[role='button'][jsname='ocqpFe'], span[data-avatar-count]",
};
const NOTICES = REGIONS.notices ?? "";
/** data-* attributes kept although no selector uses them, for the calibration report. */
const EXTRA_DATA_ATTRIBUTES = ["data-avatar-count"];

const CALL_BUTTON =
  /micro|c[âa]mera|camera|hand|m[ãa]o|leave|sair|everyone|todos|people|pessoas|participant/i;
const CONTROL = "button, [role='button'], [role='switch'], [role='menuitem'], [role='tab']";
const CHAT = /\b(chat|messages|mensagens|bate-papo)\b/i;
const FREE_TEXT = new Set([
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "alt",
  "placeholder",
  "data-tooltip",
  "value",
]);
const DROP = new Set([
  "title",
  "src",
  "srcset",
  "href",
  "style",
  "action",
  "poster",
  "content",
  "jslog",
  "jsaction",
  "jsdata",
]);
const ID_REFERENCES = new Set([
  "id",
  "for",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-activedescendant",
]);
const MEDIA = "script, style, link, iframe, img, picture, video, audio, canvas, noscript, template";
const MEETING_CODE = /\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/gi;
const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi;
const URL_LIKE = /https?:|\/\/|googleusercontent\.com/i;
const SHORT_NUMBER = /^\s*\d{1,3}\s*$/;
const LARGE_SVG_PATH = 300;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replaces meeting codes, e-mail addresses and the given names in `value`. */
export function redact(value: string, names: string[]): string {
  let out = value.replace(MEETING_CODE, "[meeting-code]").replace(EMAIL, "[email]");
  for (const name of names.map((n) => n.trim()).filter((n) => n.length > 1)) {
    out = out.replace(new RegExp(escapeRegExp(name), "gi"), "[name]");
  }
  return out;
}

/** Inside the chat panel (and not one of its controls): never read, never kept. */
export function isInChat(el: Element): boolean {
  const labelled = el.closest("[aria-label]");
  return (
    labelled !== null &&
    !el.matches(CONTROL) &&
    CHAT.test(labelled.getAttribute("aria-label") ?? "")
  );
}

/** The data-* attributes any selector reads. */
export function selectorDataAttributes(registry: Registry = SELECTORS): string[] {
  return [...new Set(JSON.stringify(registry.keys).match(/data-[a-z0-9-]+/g) ?? [])].sort();
}

/** UI text a selector matches (notices, labels): kept in snapshots so selectors can be checked. */
function uiTextPatterns(registry: Registry): RegExp[] {
  return Object.values(registry.keys).flatMap((entry) =>
    entry.strategies.flatMap((s) => {
      const patterns = "text" in s ? s.text : "labelledBy" in s ? s.labelledBy : {};
      return Object.values(patterns).map((p) => new RegExp(p, "i"));
    }),
  );
}

/** Copies and sanitizes the page. Pure: it neither prints nor saves anything. */
export function snapshot(options: Pick<SnapshotOptions, "names" | "root" | "registry">): Snapshot {
  const doc = options.root ?? document;
  const registry = options.registry ?? SELECTORS;
  const names = options.names
    .map((name) => name.trim())
    .filter((name) => name.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((name) => new RegExp(escapeRegExp(name), "gi"));
  const dataAttributes = new Set([...selectorDataAttributes(registry), ...EXTRA_DATA_ATTRIBUTES]);
  const uiText = uiTextPatterns(registry);

  const removed: Record<string, number> = {};
  const count = (what: string, n = 1) => {
    if (n > 0) removed[what] = (removed[what] ?? 0) + n;
  };
  const replaceCounting = (value: string, pattern: RegExp, by: string, what: string) =>
    value.replace(pattern, () => {
      count(what);
      return by;
    });
  const scrub = (value: string) => {
    let out = replaceCounting(value, MEETING_CODE, "[meeting-code]", "meeting codes");
    out = replaceCounting(out, EMAIL, "[email]", "e-mail addresses");
    for (const name of names) out = replaceCounting(out, name, "[name]", "given names");
    return out;
  };
  const ids = new Map<string, string>();
  const placeholder = (value: string) => {
    let id = ids.get(value);
    if (!id) {
      id = `id-${ids.size + 1}`;
      ids.set(value, id);
    }
    return id;
  };
  const isIdLike = (value: string) =>
    value.length > 24 ||
    /[/=:]/.test(value) ||
    (value.length >= 8 && /\d/.test(value) && /[a-z]/i.test(value));

  // 1. Pick what to keep, in the live page.
  const kept = new Set<Element>();
  const regions: Record<string, number> = {};
  const keep = (region: string, el: Element) => {
    if (kept.has(el) || isInChat(el)) return;
    kept.add(el);
    regions[region] = (regions[region] ?? 0) + 1;
    for (const target of labelTargets(el)) keep("labels", target);
  };
  for (const [region, css] of Object.entries(REGIONS)) {
    for (const el of doc.body.querySelectorAll(css)) {
      if (region === "buttons" && !CALL_BUTTON.test(el.getAttribute("aria-label") ?? "")) continue;
      keep(region, el);
    }
  }
  for (const entry of Object.values(registry.keys)) {
    for (const strategy of entry.strategies) {
      for (const el of matchAll(doc.body, strategy)) keep("selector matches", el);
    }
  }
  const ancestors = new Set<Element>();
  for (const el of kept) {
    for (let up = el.parentElement; up && up !== doc.body; up = up.parentElement) ancestors.add(up);
  }

  // 2. Copy only those, with the chain of elements above them.
  const copy = (node: Element): Element => {
    const clone = node.cloneNode(false) as Element;
    for (const child of node.children) {
      if (kept.has(child)) clone.append(child.cloneNode(true));
      else if (ancestors.has(child)) clone.append(copy(child));
    }
    return clone;
  };
  const root = copy(doc.body);
  count(
    "elements outside the kept regions",
    doc.body.querySelectorAll("*").length - root.querySelectorAll("*").length,
  );

  // 3. Sanitize the copy.
  for (const el of root.querySelectorAll(MEDIA)) {
    count(`<${el.localName}> elements`);
    el.remove();
  }
  for (const svg of root.querySelectorAll("svg")) {
    const size = [...svg.querySelectorAll("path")].reduce(
      (n, p) => n + (p.getAttribute("d") ?? "").length,
      0,
    );
    if (size > LARGE_SVG_PATH) {
      count("large <svg> icons");
      svg.replaceChildren();
    }
  }
  for (const el of root.querySelectorAll("[aria-label]")) {
    if (!el.matches(CONTROL) && CHAT.test(el.getAttribute("aria-label") ?? "")) {
      count("chat panels");
      el.replaceChildren(doc.createComment(" chat panel removed "));
    }
  }

  const keptLabels = new Set<string>();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const isControl = el.matches(CONTROL);
    for (const { name, value } of [...el.attributes]) {
      if (DROP.has(name) || name.startsWith("on")) {
        count(`${name} attributes`);
        el.removeAttribute(name);
      } else if (URL_LIKE.test(value)) {
        count("attributes holding a URL");
        el.removeAttribute(name);
      } else if (ID_REFERENCES.has(name)) {
        el.setAttribute(name, value.split(/\s+/).filter(Boolean).map(placeholder).join(" "));
        count("element IDs and references");
      } else if (name.startsWith("data-") && !dataAttributes.has(name)) {
        count("data-* attributes no selector uses");
        el.removeAttribute(name);
      } else if (name.startsWith("data-")) {
        if (isIdLike(value)) {
          count("ID-like data-* values");
          el.setAttribute(name, placeholder(value));
        } else if (/\s/.test(value)) {
          count("free-text data-* values");
          el.setAttribute(name, "[text]");
        } else {
          el.setAttribute(name, scrub(value));
        }
      } else if (FREE_TEXT.has(name)) {
        if (isControl && name !== "value") {
          const clean = scrub(value);
          el.setAttribute(name, clean);
          keptLabels.add(clean);
        } else {
          count("free-text labels outside controls");
          el.setAttribute(name, "[text]");
        }
      } else {
        el.setAttribute(name, scrub(value));
      }
    }
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  const nodes: Node[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node instanceof Comment) {
      if (node.data !== " chat panel removed ") node.remove();
      continue;
    }
    const text = node as Text;
    if (!text.data.trim() || SHORT_NUMBER.test(text.data)) continue;
    const context = text.parentElement?.closest(NOTICES) ?? text.parentElement;
    if (context && uiText.some((re) => re.test(context.textContent?.trim() ?? ""))) {
      text.data = scrub(text.data);
    } else {
      count("text nodes");
      text.data = "[text]";
    }
  }

  const header = [
    "<!-- Islet calibration snapshot, anonymized by the development build (src/debug/snapshot.ts).",
    `     Captured: ${new Date().toISOString().slice(0, 10)}; page language: ${doc.documentElement.lang || "?"}.`,
    "     Review for names before sharing. -->",
  ].join("\n");
  return {
    html: `${header}\n${root.outerHTML}\n`,
    removed,
    regions,
    keptLabels: [...keptLabels].sort(),
  };
}

/** Takes a snapshot, prints its summary and saves it, asking first unless `auto`. */
export function captureSnapshot(options: SnapshotOptions): Snapshot | null {
  const log = options.log ?? console;
  const result = snapshot(options);
  log.group("Islet snapshot: what was kept and removed");
  log.log("Kept regions:", result.regions);
  log.log("Removed or redacted:");
  log.table(result.removed);
  log.log("Labels kept on controls (check them for names):");
  log.table(result.keptLabels);
  log.groupEnd();

  const ask = options.confirm ?? ((message: string) => window.confirm(message));
  if (!options.auto && !ask("Islet: the summary is in the console. Save the snapshot?"))
    return null;
  const save = options.save ?? saveFile;
  save(options.fileName ?? `meet-snapshot-${Date.now()}.html`, result.html, "text/html");
  return result;
}
