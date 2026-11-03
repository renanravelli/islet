import type { AppSettings, Geometry, MeetingSession } from "@islet/ui-types";
import { describe, expect, it } from "vitest";
import {
  avatarColor,
  contour,
  controls,
  duration,
  earWidth,
  initials,
  mode,
  SIZE,
} from "../src/island/model";

const settings: AppSettings = {
  language: "auto",
  expand_on_hover: false,
  show_participant_names: true,
  muted_speaking_alert: false,
  onboarding_completed_at: null,
  meet_pip_tip_ack: false,
};
const notch: Geometry = { has_notch: true, notch_width: 185, top_inset: 32 };
const noNotch: Geometry = { has_notch: false, notch_width: 0, top_inset: 25 };

function session(overrides: Partial<MeetingSession> = {}): MeetingSession {
  return {
    key: { provider: "meet", id: "1:2" },
    status: { phase: "active" },
    title: "Synthetic",
    started_at: 0,
    mic: "on",
    cam: "off",
    hand: "off",
    active_speaker: { display_name: "Alex Example" },
    participant_count: 3,
    participants: [],
    self_participant: null,
    signals: { speaking_while_muted: false },
    capabilities: ["toggle_mic", "toggle_cam", "toggle_hand", "leave", "focus_tab"],
    health: { status: "ok" },
    ...overrides,
  };
}

const ui = { expanded: false, alertDismissed: false };

describe("mode", () => {
  it("is hidden without a session and ended for an ended one", () => {
    expect(mode(null, ui, settings)).toBe("hidden");
    expect(
      mode(
        session({ status: { phase: "ended", reason: "call_ended" } }),
        { ...ui, expanded: true },
        settings,
      ),
    ).toBe("ended");
  });

  it("expands on request", () => {
    expect(mode(session(), ui, settings)).toBe("compact");
    expect(mode(session(), { ...ui, expanded: true }, settings)).toBe("expanded");
  });

  it("alerts only behind the experimental setting, while muted, until dismissed", () => {
    const talking = session({ mic: "off", signals: { speaking_while_muted: true } });
    expect(mode(talking, ui, settings)).toBe("compact");
    const on = { ...settings, muted_speaking_alert: true };
    expect(mode(talking, ui, on)).toBe("alert");
    expect(mode(talking, { ...ui, alertDismissed: true }, on)).toBe("compact");
    expect(mode(session({ mic: "on", signals: { speaking_while_muted: true } }), ui, on)).toBe(
      "compact",
    );
  });
});

describe("contour", () => {
  it("matches the mock's sizes", () => {
    expect(contour("compact", notch)).toEqual({ width: 390, height: 32 });
    // A wide notch keeps both ears and their padding clear of it.
    expect(contour("compact", { ...notch, notch_width: 250 })).toEqual({
      width: 250 + 2 * (SIZE.ear + SIZE.earPadding),
      height: 32,
    });
    expect(contour("compact", noNotch)).toEqual({ width: 340, height: 34 });
    expect(contour("expanded", notch)).toEqual({ width: 560, height: 32 + SIZE.expandedBody });
    expect(contour("alert", notch)).toEqual({ width: 440, height: 32 + SIZE.alertBody });
    expect(contour("hidden", notch)).toEqual({ width: 0, height: 0 });
  });
});

describe("earWidth", () => {
  const minute = 60_000;
  it("keeps the mock's 88 while the right ear fits", () => {
    expect(earWidth(session(), "compact", 32 * minute)).toBe(SIZE.ear);
    // The camera, the mic and a minutes timer: 14 + 14 + 36 + 2 gaps of 7.
    expect(earWidth(session({ cam: "on" }), "compact", 32 * minute)).toBe(SIZE.ear);
    expect(earWidth(null, "compact", 0)).toBe(SIZE.ear);
  });

  it("widens both ears when the right one holds more, so nothing hides under the notch", () => {
    const busy = session({ cam: "on", hand: "on" });
    // 3 icons + "32:10" (4 digits, a colon) + 3 gaps = 42 + 35.6 + 21.
    expect(earWidth(busy, "compact", 32 * minute + 10_000)).toBe(99);
    const hourIn = earWidth(busy, "compact", 62 * minute);
    expect(hourIn).toBeGreaterThan(99);
    expect(contour("compact", notch, false, hourIn).width).toBe(185 + 2 * (hourIn + 14));
    // Ended shows only the timer.
    expect(earWidth(busy, "ended", 0, 62 * minute)).toBe(SIZE.ear);
  });
});

describe("controls", () => {
  it("offers only declared commands, in order, and never chat", () => {
    expect(controls(session()).map((c) => c.command)).toEqual([
      "toggle_mic",
      "toggle_cam",
      "toggle_hand",
      "focus_tab",
      "leave",
    ]);
    expect(controls(session({ capabilities: ["leave"] })).map((c) => c.command)).toEqual(["leave"]);
  });

  it("never shows an unknown state as on", () => {
    const [mic, cam, hand] = controls(session({ mic: "unknown", cam: "unknown", hand: "unknown" }));
    for (const control of [mic, cam, hand]) {
      expect(control?.look).toBe("unknown");
      expect(control?.aria).toBe("island.unknown");
    }
  });

  it("labels states as the spec says", () => {
    const [mic, cam, hand] = controls(session({ mic: "off", cam: "off", hand: "on" }));
    expect(mic).toMatchObject({
      label: "island.mic_muted",
      aria: "island.mic_aria_unmute",
      look: "off",
    });
    expect(cam).toMatchObject({ label: "island.cam_off", aria: "island.cam_aria_on", look: "off" });
    expect(hand).toMatchObject({ label: "island.hand_lower", look: "raised" });
  });
});

describe("formatting", () => {
  it("formats durations with tabular-friendly widths", () => {
    expect(duration(0)).toBe("0:00");
    expect(duration(247_000)).toBe("4:07");
    expect(duration(3_723_000)).toBe("1:02:03");
    expect(duration(-5)).toBe("0:00");
  });

  it("makes initials, or none when names are hidden", () => {
    expect(initials("Alex Rivera")).toBe("AR");
    expect(initials("ana maria souza")).toBe("AS");
    expect(initials("Sam")).toBe("S");
    expect(initials(null)).toBeNull();
    expect(initials("  ")).toBeNull();
  });
});

describe("avatarColor", () => {
  it("gives the first three people different colors and keeps each one's", () => {
    const names = ["Color Test A", "Color Test B", "Color Test C"];
    const colors = names.map(avatarColor);
    expect(new Set(colors).size).toBe(3);
    expect(names.map(avatarColor)).toEqual(colors);
    expect(avatarColor(null)).toBeUndefined();
  });
});
