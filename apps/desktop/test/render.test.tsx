import type { AppInfo, AppSettings, Geometry, MeetingSession, UiSnapshot } from "@islet/ui-types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../src/i18n/i18n";
import { IslandView } from "../src/island/IslandView";
import type { Mode } from "../src/island/model";
import { Onboarding, RECHECK_MS } from "../src/onboarding/Onboarding";
import { api } from "../src/shared/api";
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
  raised_hands: null,
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

  it("draws a participant's photo instead of the initials, and initials without one", () => {
    // A synthetic 1×1 PNG, standing in for a photo.
    const photo =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    render("expanded", {
      active_speaker: { display_name: "Alex Example", avatar: photo },
      participants: [
        { display_name: "Alex Example", avatar: photo },
        { display_name: "Sam Example" },
      ],
    });
    const avatars = [...container.querySelectorAll(".avatar")];
    const photos = avatars.filter((a) => a.querySelector("img")?.getAttribute("src") === photo);
    // The speaker's tile and the first avatar of the row.
    expect(photos).toHaveLength(2);
    for (const a of photos) expect(a.textContent).toBe("");
    expect(avatars.some((a) => a.textContent === "SE")).toBe(true);
    // Decorative: the name is next to it.
    expect(photos[0]?.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("compact is one labelled button that expands", () => {
    render("compact");
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Expandir controles da reunião");
    expect(container.querySelector(".timer")?.textContent).toBe("1:00");
  });

  it("shows others' raised hands at the left: the first in line and how many", () => {
    const raised_hands = { first: { display_name: "Bruno Example" }, count: 3, since: 0 };
    render("compact", { raised_hands });
    const chip = container.querySelector(".ear.left .hands-chip");
    expect(chip?.getAttribute("aria-label")).toBe(
      "Bruno Example levantou a mão, 3 mãos levantadas",
    );
    expect(chip?.textContent).toBe("BE+2");
    // The user's own hand is a different mark, at the right.
    expect(container.querySelector(".ear.right .status-icon.attention")).toBeNull();

    render("expanded", { raised_hands });
    expect(container.querySelector(".hands-row")?.textContent).toBe(
      "BEBruno Example levantou a mão3 mãos levantadas",
    );

    render("notice", { raised_hands: { ...raised_hands, count: 1 } });
    const notice = container.querySelector(".notice");
    expect(notice?.tagName).toBe("BUTTON");
    expect(notice?.textContent).toContain("Mão levantada");
    expect(notice?.textContent).toContain("Bruno Example levantou a mão");
    expect(notice?.textContent).not.toContain("mãos levantadas");
  });

  it("with names hidden, says someone raised their hand", () => {
    render("expanded", { raised_hands: { first: { display_name: null }, count: 1, since: 0 } });
    expect(container.querySelector(".hands-by")?.textContent).toBe("Alguém levantou a mão");
    render("compact");
    expect(container.querySelector(".hands-chip")).toBeNull();
  });

  it("shows the camera icon only while the camera is on", () => {
    const camera = () => container.querySelector(".ear.right [aria-label='Câmera']");
    render("compact", { cam: "on" });
    expect(camera()?.className).toContain("live");
    render("compact", { cam: "off" });
    expect(camera()).toBeNull();
    render("compact", { cam: "unknown" });
    expect(camera()).toBeNull();
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

describe("onboarding", () => {
  const info: AppInfo = {
    version: "0.1.1",
    system_language: "en",
    geometry,
    shortcuts: { toggle_island: true, toggle_mic: true },
    bridge: { state: "ready" },
    demo: false,
  };
  const settings: AppSettings = {
    language: "en",
    expand_on_hover: false,
    show_participant_names: true,
    muted_speaking_alert: false,
    onboarding_completed_at: null,
    meet_pip_tip_ack: false,
    check_for_updates: false,
  };
  const meet = (connected: boolean): UiSnapshot => ({
    primary: null,
    providers: [
      { id: "meet", connected, client_version: connected ? "0.1.1" : null, last_health: null },
    ],
  });
  const at = (initialStep: number, snapshot: UiSnapshot) =>
    act(() =>
      root.render(
        <LocaleProvider locale="en">
          <Onboarding
            info={info}
            settings={settings}
            snapshot={snapshot}
            preview={undefined}
            initialStep={initialStep}
          />
        </LocaleProvider>,
      ),
    );
  const step3 = (snapshot: UiSnapshot) => at(3, snapshot);
  /** Lets the shell's answers (promises) land. */
  const settle = () => act(async () => {});
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("checks the Mac and lets the person go on only when all is ready", async () => {
    vi.spyOn(api, "requirements").mockResolvedValue({ chrome: true, in_applications: true });
    const repair = vi.spyOn(api, "repairBridge").mockResolvedValue({ state: "ready" });
    at(2, meet(false));
    expect(container.textContent).toContain("Checking…");
    expect(button("Continue")?.disabled).toBe(true);
    await settle();
    await settle();
    expect(repair).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Installed on this Mac.");
    expect(container.textContent).toContain("Opened from the Applications folder.");
    expect(container.textContent).not.toContain("bridge");
    expect(container.textContent).toContain("Your Mac is all set. Next, the extension.");
    expect(button("Continue")?.disabled).toBe(false);
  });

  it("asks for Chrome, waits for it, then installs the bridge", async () => {
    vi.useFakeTimers();
    const requirements = vi
      .spyOn(api, "requirements")
      .mockResolvedValue({ chrome: false, in_applications: true });
    const repair = vi.spyOn(api, "repairBridge").mockResolvedValue({ state: "ready" });
    const open = vi.spyOn(api, "openLink").mockResolvedValue(undefined);
    at(2, meet(false));
    await settle();
    expect(container.textContent).toContain("Not found. For now, Islet only works with it.");
    expect(container.textContent).toContain("Using Brave, Edge or Arc?");
    expect(repair).not.toHaveBeenCalled();
    expect(button("Continue")?.disabled).toBe(true);
    expect(button("Skip for now")).toBeDefined();

    act(() => button("Download Chrome")?.click());
    expect(open).toHaveBeenCalledWith("download_chrome");
    expect(container.textContent).toContain("Waiting for Chrome…");

    requirements.mockResolvedValue({ chrome: true, in_applications: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS);
    });
    await settle();
    expect(repair).toHaveBeenCalledTimes(1);
    expect(button("Continue")?.disabled).toBe(false);
  });

  it("asks to open Islet from Applications, with no button to do it", async () => {
    vi.spyOn(api, "requirements").mockResolvedValue({ chrome: true, in_applications: false });
    const repair = vi.spyOn(api, "repairBridge").mockResolvedValue({ state: "ready" });
    at(2, meet(false));
    await settle();
    expect(container.textContent).toContain("Drag Islet to Applications and open it from there.");
    expect(container.textContent).toContain("Installed on this Mac.");
    expect(container.textContent).not.toContain("Using Brave, Edge or Arc?");
    expect(repair).not.toHaveBeenCalled();
    expect(button("Continue")?.disabled).toBe(true);
  });

  it("shows a failed bridge in Chrome's row, with a retry", async () => {
    vi.spyOn(api, "requirements").mockResolvedValue({ chrome: true, in_applications: true });
    const repair = vi
      .spyOn(api, "repairBridge")
      .mockResolvedValue({ state: "error", summary: "synthetic" });
    at(2, meet(false));
    await settle();
    await settle();
    expect(container.textContent).toContain("Couldn't connect Islet to Chrome.");
    expect(button("Continue")?.disabled).toBe(true);
    repair.mockResolvedValue({ state: "ready" });
    await act(async () => button("Try again")?.click());
    expect(container.textContent).toContain("Installed on this Mac.");
    expect(button("Continue")?.disabled).toBe(false);
  });

  it("stays connected after the connection test closes the bridge", () => {
    step3(meet(false));
    expect(container.textContent).not.toContain("Version 0.1.1");
    step3(meet(true));
    step3(meet(false));
    expect(container.textContent).toContain("Version 0.1.1 · passed the connection test.");
    expect(button("Continue")?.disabled).toBe(false);
  });

  it("opens Meet to test an extension installed earlier", () => {
    const open = vi.spyOn(api, "openLink").mockResolvedValue(undefined);
    step3(meet(false));
    expect(container.textContent).toContain("Already have the extension?");
    act(() => button("Open Meet to test it")?.click());
    expect(open).toHaveBeenCalledWith("open_meet");
    expect(container.textContent).toContain("Once Meet opens in Chrome, the extension connects.");
    expect(button("Open Meet to test it")).toBeUndefined();
  });
});
