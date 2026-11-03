// Development only (not in the Vite build inputs): every island state with fixed, synthetic
// data, for reviewing the design without a call. Open /gallery.html?locale=pt-BR on the dev
// server.

import type { Geometry, MeetingSession } from "@islet/ui-types";
import { createRoot } from "react-dom/client";
import { type Locale, LocaleProvider } from "../i18n/i18n";
import { IslandView } from "../island/IslandView";
import type { Mode } from "../island/model";
import "../shared/tokens.css";

const now = Date.now();
const base: MeetingSession = {
  key: { provider: "demo", id: "gallery" },
  status: { phase: "active" },
  title: "Weekly design review",
  started_at: now - 754_000,
  mic: "on",
  cam: "off",
  hand: "off",
  active_speaker: { display_name: "Alex Rivera" },
  participant_count: 6,
  signals: { speaking_while_muted: false },
  capabilities: ["toggle_mic", "toggle_cam", "toggle_hand", "leave", "focus_tab"],
  health: { status: "ok" },
};
const notch: Geometry = { has_notch: true, notch_width: 185, top_inset: 32 };
const noNotch: Geometry = { has_notch: false, notch_width: 0, top_inset: 25 };

const cases: [string, Mode, Partial<MeetingSession>, Geometry][] = [
  ["compact", "compact", {}, notch],
  [
    "compact, muted, hand raised, degraded",
    "compact",
    {
      mic: "off",
      hand: "on",
      active_speaker: null,
      health: { status: "degraded", reasons: ["stale"], provider_details: [] },
    },
    notch,
  ],
  [
    "compact, unknown mic, names hidden",
    "compact",
    { mic: "unknown", active_speaker: { display_name: null } },
    notch,
  ],
  ["ended", "ended", { status: { phase: "ended", reason: "call_ended" } }, notch],
  ["expanded", "expanded", {}, notch],
  [
    "expanded, muted, camera on, hand raised",
    "expanded",
    { mic: "off", cam: "on", hand: "on" },
    notch,
  ],
  [
    "expanded, unknown states, no speaker",
    "expanded",
    {
      mic: "unknown",
      cam: "unknown",
      hand: "unknown",
      active_speaker: null,
      capabilities: ["toggle_mic", "toggle_cam", "toggle_hand", "leave", "focus_tab"],
    },
    notch,
  ],
  ["alert", "alert", { mic: "off", signals: { speaking_while_muted: true } }, notch],
  ["pill (no notch)", "compact", {}, noNotch],
  ["pill expanded (no notch)", "expanded", {}, noNotch],
];

const locale = (new URLSearchParams(location.search).get("locale") as Locale) || "en";

function Gallery() {
  return (
    <LocaleProvider locale={locale}>
      <div
        style={{ display: "grid", gap: 24, padding: 24, background: "#7a8a99", minHeight: "100vh" }}
      >
        {cases.map(([label, mode, overrides, geometry]) => {
          const session = { ...base, ...overrides };
          return (
            <section key={label}>
              <div style={{ font: "12px var(--font)", color: "#fff", marginBottom: 6 }}>
                {label}
              </div>
              <IslandView
                mode={mode}
                session={session}
                speaker={session.active_speaker}
                geometry={geometry}
                now={now}
                endedDuration={mode === "ended" ? 754_000 : undefined}
                interactive
              />
            </section>
          );
        })}
      </div>
    </LocaleProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Gallery />);
