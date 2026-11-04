import { describe, expect, it } from "vitest";
import { SELECTORS } from "../src/content/meet/selectors";
import { probeHands, shapeOf, summarizeHands } from "../src/debug/hands";

// Synthetic: the names and ids stand in for personal data and Meet's opaque ids.
const TILES = `
  <div data-participant-id="spaces/x/devices/1" jsname="E2KThb"><button jsname="Ac69Jc"></button></div>
  <div data-participant-id="spaces/x/devices/2" jsname="E2KThb">
    <div jsname="hnd1"><i aria-hidden="true">front_hand</i><span>1</span></div>
    <div aria-label="Bruno Example levantou a mão"></div></div>
  <div data-participant-id="spaces/x/devices/3" jsname="E2KThb">
    <div jsname="hnd1"><i aria-hidden="true">front_hand</i><span>2</span></div></div>
  <ul role="list"><li data-participant-id="spaces/x/devices/3"><span>Mãos levantadas</span></li></ul>
  <div role="status">Carla Example levantou a mão</div>
  <button aria-label="Levantar a mão (ctrl + ⌘ + h)"></button>
  <section aria-label="Mensagens na chamada"><p>alguém levantou a mão</p></section>`;

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("raised-hand probe", () => {
  it("finds marks in tiles, the People panel and notices, in page order", () => {
    const findings = probeHands(page(TILES), SELECTORS);
    expect(
      findings.map((f) => [f.where, f.tile, f.participant, f.kind, f.shape, f.number]),
    ).toEqual([
      ["tile", 1, "P1", "icon", "front_hand", 1],
      ["tile", 1, "P1", "label", "[text] levantou a mão", undefined],
      ["tile", 2, "P2", "icon", "front_hand", 2],
      ["participant-list", undefined, "P2", "text", "Mãos levantadas", undefined],
      ["notice", undefined, undefined, "text", "[text] levantou a mão", undefined],
    ]);
    expect(findings[0]?.path[0]).toBe("div[jsname=hnd1]");
    expect(summarizeHands(findings)).toBe(
      "5 mark(s) in tile, participant-list, notice; participants in page order: P1, P2",
    );
  });

  it("keeps aliases across probes of one run", () => {
    const aliases = new Map<string, string>();
    probeHands(page(TILES), SELECTORS, aliases);
    const later = probeHands(
      page(`<div data-participant-id="spaces/x/devices/3" jsname="E2KThb">
        <i>front_hand</i></div>`),
      SELECTORS,
      aliases,
    );
    expect(later.map((f) => f.participant)).toEqual(["P2"]);
  });

  it("never reports a name, an id or the chat", () => {
    const json = JSON.stringify(probeHands(page(TILES), SELECTORS));
    for (const secret of ["Bruno", "Carla", "Example", "spaces/", "alguém"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("hides everything around the matched words", () => {
    expect(shapeOf("Raised hand: Alex Example")).toBe("Raised hand [text]");
    expect(shapeOf("Mão levantada")).toBe("Mão levantada");
    expect(summarizeHands([])).toBe("no raised-hand marks found");
  });
});
