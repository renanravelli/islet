import { describe, expect, it } from "vitest";
import { SELECTORS } from "../src/content/meet/selectors";
import { type CanvasFactory, probeAvatars, summarize } from "../src/debug/avatars";

// Synthetic: no real photo or account. The URL token and alt text stand in for personal data.
const PHOTO = "https://lh3.googleusercontent.com/a/SYNTHETIC-TOKEN=s192-c-mo";

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

function loaded(img: Element, width = 192): void {
  Object.defineProperty(img, "complete", { value: true });
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: width });
}

function canvas(outcome: "readable" | "tainted"): CanvasFactory {
  return () =>
    ({
      getContext: () => ({ drawImage() {} }),
      toDataURL() {
        if (outcome === "readable") return `data:image/webp;base64,${"A".repeat(900)}`;
        throw new DOMException("The canvas has been tainted", "SecurityError");
      },
    }) as unknown as HTMLCanvasElement;
}

const TILES = `
  <div data-participant-id="p1" jsname="E2KThb"><button jsname="Ac69Jc"></button>
    <div jsname="aaa1"><img id="own" src="${PHOTO}" alt="Alex Example"></div></div>
  <div data-participant-id="p2" jsname="E2KThb">
    <div role="presentation"><img id="other" src="${PHOTO}" crossorigin="anonymous"></div></div>
  <ul role="list"><li data-participant-id="p2"><img id="listed" src="${PHOTO}"></li></ul>
  <img id="logo" src="https://www.gstatic.com/logo.png">
  <div id="bg" style="background-image: url('${PHOTO}')"></div>`;

describe("participant photo probe", () => {
  it("finds photos in tiles, the own tile, the People list and backgrounds", () => {
    const doc = page(TILES);
    for (const img of doc.querySelectorAll("img")) loaded(img);
    const findings = probeAvatars(doc, SELECTORS, canvas("readable"));

    expect(findings.map((f) => [f.where, f.tile, f.kind, f.source])).toEqual([
      ["self-tile", undefined, "img", "googleusercontent"],
      ["tile", 1, "img", "googleusercontent"],
      ["participant-list", undefined, "img", "googleusercontent"],
      ["other", undefined, "background", "googleusercontent"],
    ]);
    expect(findings[1]?.crossOrigin).toBe("anonymous");
    expect(findings[0]).toMatchObject({
      natural: [192, 192],
      pixels: "readable",
      format: "image/webp",
    });
    expect(findings[0]?.path[0]).toBe("div[jsname=aaa1]");
    expect(findings[1]?.path[0]).toBe("div[role=presentation]");
    expect(findings[3]?.pixels).toBe("not-tested");
  });

  it("reports a tainted canvas, and images that have not loaded", () => {
    const doc = page(TILES);
    const own = doc.getElementById("own");
    if (own) loaded(own);
    const findings = probeAvatars(doc, SELECTORS, canvas("tainted"));
    expect(findings.slice(0, 2).map((f) => f.pixels)).toEqual(["tainted", "not-loaded"]);
    expect(summarize(findings)).toBe(
      "4 photo(s) in self-tile, tile, participant-list, other: 0 readable, 1 tainted, 2 not loaded",
    );
  });

  it("never reports a URL, an alt text or pixels", () => {
    const doc = page(TILES);
    for (const img of doc.querySelectorAll("img")) loaded(img);
    const json = JSON.stringify(probeAvatars(doc, SELECTORS, canvas("readable")));
    for (const secret of ["SYNTHETIC-TOKEN", "googleusercontent.com", "Alex", "base64", "AAAA"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("finds nothing on a page without photos", () => {
    const doc = page(
      `<img src="https://www.gstatic.com/logo.png"><div data-participant-id="p1" jsname="E2KThb"></div>`,
    );
    expect(probeAvatars(doc, SELECTORS, canvas("readable"))).toEqual([]);
    expect(summarize([])).toBe("no participant photos found");
  });
});
