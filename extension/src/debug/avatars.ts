// The participant-photo probe for the calibration runner (development builds only): where Meet
// draws profile photos, and whether the extension could read their pixels from the page
// without a network request (the plan for real avatars, step 12 of calibration-session.md).
//
// It records structure and sizes only. Never a URL, an alt text, a title or the pixels: the
// 48 px test image is measured and dropped.

import { matchAll, type Registry, resolveWith } from "../content/meet/selectors";

/** The size the island would send, and the cap on what one probe reports. */
export const PROBE_SIZE = 48;
const MAX_FINDINGS = 20;
const ANCESTORS = 5;

export type Pixels =
  /** drawImage and toDataURL worked: the extension can send the photo as a data URL. */
  | "readable"
  /** The canvas was tainted by a cross-origin image: no data URL without a network request. */
  | "tainted"
  | "not-loaded"
  /** A CSS background image: it cannot be drawn without loading it again. */
  | "not-tested"
  | "no-canvas"
  | "error";

export interface AvatarFinding {
  /** A video tile (its position among participantTile matches), the own tile, a list item that
   * carries data-participant-id (the People panel), or anywhere else. */
  where: "tile" | "self-tile" | "participant-list" | "other";
  tile?: number;
  kind: "img" | "background";
  source: "googleusercontent" | "data" | "blob" | "other";
  crossOrigin: string | null;
  natural?: [number, number];
  rendered: [number, number];
  onScreen: boolean;
  /** The nearest ancestors: tag, jsname, role and the names (not values) of data-* attributes. */
  path: string[];
  pixels: Pixels;
  /** Length of the 48 px data URL, and its format. */
  bytes?: number;
  format?: string;
}

export type CanvasFactory = () => HTMLCanvasElement;

const PHOTO_HOST = /(^|\.)googleusercontent\.com$/;

function sourceOf(url: string): AvatarFinding["source"] {
  if (url.startsWith("data:")) return "data";
  if (url.startsWith("blob:")) return "blob";
  try {
    return PHOTO_HOST.test(new URL(url).hostname) ? "googleusercontent" : "other";
  } catch {
    return "other";
  }
}

function describe(el: Element): string {
  let text = el.localName;
  const jsname = el.getAttribute("jsname");
  if (jsname) text += `[jsname=${jsname}]`;
  const role = el.getAttribute("role");
  if (role) text += `[role=${role}]`;
  for (const attr of el.getAttributeNames()) if (attr.startsWith("data-")) text += `[${attr}]`;
  return text;
}

export function ancestors(el: Element): string[] {
  const out: string[] = [];
  for (let at = el.parentElement; at && out.length < ANCESTORS; at = at.parentElement) {
    out.push(describe(at));
  }
  return out;
}

function backgroundUrl(el: Element): string | undefined {
  const style = (el as HTMLElement).style?.backgroundImage ?? "";
  return /url\(["']?([^"')]+)["']?\)/.exec(style)?.[1];
}

function testPixels(
  img: HTMLImageElement,
  makeCanvas: CanvasFactory,
): Pick<AvatarFinding, "pixels" | "bytes" | "format"> {
  if (!img.complete || img.naturalWidth === 0) return { pixels: "not-loaded" };
  const canvas = makeCanvas();
  canvas.width = PROBE_SIZE;
  canvas.height = PROBE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return { pixels: "no-canvas" };
  try {
    context.drawImage(img, 0, 0, PROBE_SIZE, PROBE_SIZE);
    const url = canvas.toDataURL("image/webp", 0.8);
    return { pixels: "readable", bytes: url.length, format: url.slice(5, url.indexOf(";")) };
  } catch (error) {
    return {
      // A DOMException, which is not an Error everywhere.
      pixels: (error as { name?: unknown })?.name === "SecurityError" ? "tainted" : "error",
    };
  }
}

/** Every likely participant photo on the page, without personal data. */
export function probeAvatars(
  doc: Document,
  registry: Registry,
  makeCanvas: CanvasFactory = () => doc.createElement("canvas"),
): AvatarFinding[] {
  const tiles = registry.keys.participantTile.strategies.flatMap((s) => matchAll(doc, s));
  const self = resolveWith(doc, registry.keys.selfTile.strategies)?.element;
  const where = (el: Element): Pick<AvatarFinding, "where" | "tile"> => {
    if (self?.contains(el)) return { where: "self-tile" };
    const tile = tiles.findIndex((t) => t.contains(el));
    if (tile >= 0) return { where: "tile", tile };
    if (el.closest("[data-participant-id]")) return { where: "participant-list" };
    return { where: "other" };
  };
  const inParticipant = (el: Element) =>
    tiles.some((t) => t.contains(el)) || el.closest("[data-participant-id]") !== null;

  const findings: AvatarFinding[] = [];
  for (const img of doc.querySelectorAll("img")) {
    const source = sourceOf(img.currentSrc || img.src);
    if (source !== "googleusercontent" && !inParticipant(img)) continue;
    const rect = img.getBoundingClientRect();
    findings.push({
      ...where(img),
      kind: "img",
      source,
      crossOrigin: img.getAttribute("crossorigin"),
      natural: [img.naturalWidth, img.naturalHeight],
      rendered: [Math.round(rect.width), Math.round(rect.height)],
      onScreen: rect.width > 0 && rect.height > 0,
      path: ancestors(img),
      ...testPixels(img, makeCanvas),
    });
    if (findings.length >= MAX_FINDINGS) return findings;
  }
  for (const el of doc.querySelectorAll("[style*='background-image']")) {
    const url = backgroundUrl(el);
    if (!url) continue;
    const source = sourceOf(url);
    if (source !== "googleusercontent" && !inParticipant(el)) continue;
    const rect = el.getBoundingClientRect();
    findings.push({
      ...where(el),
      kind: "background",
      source,
      crossOrigin: null,
      rendered: [Math.round(rect.width), Math.round(rect.height)],
      onScreen: rect.width > 0 && rect.height > 0,
      path: ancestors(el),
      pixels: "not-tested",
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings;
}

/** One line for the console: how many photos, where, and whether they are readable. */
export function summarize(findings: AvatarFinding[]): string {
  if (findings.length === 0) return "no participant photos found";
  const count = (pixels: Pixels) => findings.filter((f) => f.pixels === pixels).length;
  const places = [...new Set(findings.map((f) => f.where))].join(", ");
  return `${findings.length} photo(s) in ${places}: ${count("readable")} readable, ${count("tainted")} tainted, ${count("not-loaded")} not loaded`;
}
