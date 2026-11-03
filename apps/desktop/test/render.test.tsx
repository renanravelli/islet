import type { Geometry, MeetingSession } from "@islet/ui-types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../src/i18n/i18n";
import { IslandView } from "../src/island/IslandView";
import type { Mode } from "../src/island/model";
import { Switch } from "../src/shared/components";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const geometry: Geometry = { has_notch: true, notch_width: 185, top_inset: 32 };
const session: MeetingSession = {
  key: { provider: "meet", id: "1:2" },
  status: { phase: "active" },
  title: "Synthetic title",
  started_at: 0,
  mic: "unknown",
  cam: "off",
  hand: "off",
  active_speaker: { display_name: null },
  participant_count: 4,
  participants: [],
  self_participant: null,
  signals: { speaking_while_muted: false },
  capabilities: ["toggle_mic", "toggle_cam", "leave"],
  health: { status: "ok" },
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(
  mode: Mode,
  overrides: Partial<MeetingSession> = {},
  onCommand = vi.fn(),
  lastSpeaker: MeetingSession["active_speaker"] = null,
) {
  const s = { ...session, ...overrides };
  act(() =>
    root.render(
      <LocaleProvider locale="pt-BR">
        <IslandView
          mode={mode}
          session={s}
          speaker={s.active_speaker}
          lastSpeaker={lastSpeaker}
          geometry={geometry}
          now={60_000}
          interactive
          onCommand={onCommand}
        />
      </LocaleProvider>,
    ),
  );
  return onCommand;
}

describe("island", () => {
  it("with nobody speaking, shows the last speaker as such: no ring, no moving wave", () => {
    render("expanded", { active_speaker: null }, vi.fn(), { display_name: "Alex Example" });
    expect(container.querySelector(".speaking-label")?.textContent).toBe("Falou por último");
    expect(container.querySelector(".speaking-name .name")?.textContent).toBe("Alex Example");
    expect(container.querySelector(".speaker-tile")?.className).not.toContain("is-speaking");
    expect(container.querySelector(".wave.active")).toBeNull();

    render("expanded", { active_speaker: { display_name: "Sam Example" } }, vi.fn(), {
      display_name: "Alex Example",
    });
    expect(container.querySelector(".speaking-label")?.textContent).toBe("Falando agora");
    expect(container.querySelector(".speaking-name .name")?.textContent).toBe("Sam Example");
  });

  it("before anyone speaks, shows the user as such", () => {
    render("expanded", { active_speaker: null, self_participant: { display_name: "Jo Example" } });
    expect(container.querySelector(".speaking-label")?.textContent).toBe("Você");
    expect(container.querySelector(".speaking-name .name")?.textContent).toBe("Jo Example");
    expect(container.querySelector(".speaker-tile")?.className).not.toContain("is-speaking");
  });

  it("compact is one labelled button that expands", () => {
    render("compact");
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Expandir controles da reunião");
    expect(container.querySelector(".timer")?.textContent).toBe("1:00");
  });

  it("an unknown mic is drawn as unknown, never as on", () => {
    render("compact");
    expect(container.querySelector(".status-icon.unknown")?.getAttribute("aria-label")).toBe(
      "Estado desconhecido",
    );
    render("expanded");
    const mic = container.querySelector(".control-button");
    expect(mic?.className).toContain("look-unknown");
    expect(mic?.getAttribute("aria-label")).toBe("Estado desconhecido");
  });

  it("with names hidden there are no initials, only the generic avatar", () => {
    render("compact");
    const avatar = container.querySelector(".avatar");
    expect(avatar?.textContent).toBe("");
    expect(avatar?.querySelector("svg")).not.toBeNull();
  });

  it("renders only the declared controls, each a real button with an aria-label", () => {
    const onCommand = render("expanded");
    const buttons = [...container.querySelectorAll(".control-button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Estado desconhecido",
      "Ativar câmera",
      "Sair da reunião",
    ]);
    act(() => (buttons[2] as HTMLButtonElement).click());
    expect(onCommand).toHaveBeenCalledWith("leave");
  });

  it("hides itself without a session", () => {
    act(() =>
      root.render(
        <LocaleProvider locale="en">
          <IslandView mode="hidden" session={null} speaker={null} geometry={geometry} now={0} />
        </LocaleProvider>,
      ),
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("switch", () => {
  it("announces its state to VoiceOver", () => {
    const onChange = vi.fn();
    act(() => root.render(<Switch checked label="Mostrar nomes" onChange={onChange} />));
    const control = container.querySelector("button");
    expect(control?.getAttribute("role")).toBe("switch");
    expect(control?.getAttribute("aria-checked")).toBe("true");
    act(() => control?.click());
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
