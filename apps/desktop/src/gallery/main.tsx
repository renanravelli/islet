// Development only (not in the Vite build inputs): every island state with fixed, synthetic
// data, for reviewing the design without a call. Open /gallery.html?locale=pt-BR on the dev
// server.

import type { Geometry, MeetingSession } from "@islet/ui-types";
import { createRoot } from "react-dom/client";
import { type Locale, LocaleProvider } from "../i18n/i18n";
import { IslandView } from "../island/IslandView";
import type { Mode } from "../island/model";
import "../shared/tokens.css";

// The same data as the approved canvas ("Estados da ilha"), so both can be compared 1:1.
const DURATION_MS = (32 * 60 + 10) * 1000;
const now = Date.now();
const base: MeetingSession = {
  key: { provider: "demo", id: "gallery" },
  status: { phase: "active" },
  title: "Daily · Squad Checkout",
  started_at: now - DURATION_MS,
  mic: "on",
  cam: "off",
  hand: "off",
  active_speaker: { display_name: "Ana Souza" },
  participant_count: 8,
  participants: ["Ana Souza", "Bruno Lima", "Carla Mendes"].map((display_name) => ({
    display_name,
  })),
  signals: { speaking_while_muted: false },
  capabilities: ["toggle_mic", "toggle_cam", "toggle_hand", "leave", "focus_tab"],
  health: { status: "ok" },
};
const notch: Geometry = { has_notch: true, notch_width: 186, top_inset: 32 };
const noNotch: Geometry = { has_notch: false, notch_width: 0, top_inset: 25 };

/** Label, mode, data, geometry, frame height and, optionally, who spoke last. */
type Case = [string, Mode, Partial<MeetingSession>, Geometry, number, string?];

/** The canvas board's rows, in its order and with its frame heights. */
const CANVAS: Case[] = [
  ["Compacta · em call", "compact", {}, notch, 96],
  [
    "Compacta · no mudo",
    "compact",
    { mic: "off", hand: "on", active_speaker: { display_name: "Bruno Lima" } },
    notch,
    96,
  ],
  ["Expandida", "expanded", {}, notch, 300],
  [
    "Alerta · falando no mudo",
    "alert",
    { mic: "off", signals: { speaking_while_muted: true } },
    notch,
    170,
  ],
  ["Sem notch · monitor externo", "compact", {}, noNotch, 96],
  ["Encerrada", "ended", { status: { phase: "ended", reason: "call_ended" } }, notch, 96],
];

/** States the canvas does not draw. */
const EXTRA: Case[] = [
  ["Nobody speaking, last speaker", "compact", { active_speaker: null }, notch, 96, "Bruno Lima"],
  [
    "Expanded, nobody speaking, last speaker",
    "expanded",
    { active_speaker: null },
    notch,
    300,
    "Bruno Lima",
  ],
  [
    "Degraded, nobody speaking",
    "compact",
    {
      mic: "off",
      active_speaker: null,
      health: { status: "degraded", reasons: ["stale"], provider_details: [] },
    },
    notch,
    96,
  ],
  [
    "Unknown mic, names hidden",
    "compact",
    { mic: "unknown", active_speaker: { display_name: null } },
    notch,
    96,
  ],
  [
    "Expanded, muted, camera on, hand raised",
    "expanded",
    { mic: "off", cam: "on", hand: "on" },
    notch,
    300,
  ],
  [
    "Expanded, unknown states, nobody speaking",
    "expanded",
    { mic: "unknown", cam: "unknown", hand: "unknown", active_speaker: null },
    notch,
    300,
  ],
  ["Pill expanded", "expanded", {}, noNotch, 300],
];

const locale = (new URLSearchParams(location.search).get("locale") as Locale) || "pt-BR";

/** A frame like the canvas's: an 860 pt strip with the menu bar and the island at the top. */
function Frame({ c: [label, mode, overrides, geometry, height, last] }: { c: Case }) {
  const session = { ...base, ...overrides };
  const pill = !geometry.has_notch;
  return (
    <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
      <div style={{ width: 300, font: "600 18px var(--font)", color: "#1D1D1F" }}>{label}</div>
      <div
        style={{
          position: "relative",
          width: 860,
          height,
          border: "1px solid #E3E3E8",
          borderRadius: 12,
          overflow: "hidden",
          background: "#F7F7F8",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "0 0 auto 0",
            height: pill ? 25 : 37,
            background: "#E9E9EC",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: pill ? 33 : 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <IslandView
            mode={mode}
            session={session}
            speaker={session.active_speaker}
            lastSpeaker={last ? { display_name: last } : null}
            geometry={geometry}
            now={now}
            endedDuration={mode === "ended" ? DURATION_MS : undefined}
            interactive
          />
        </div>
      </div>
    </div>
  );
}

function Gallery() {
  return (
    <LocaleProvider locale={locale}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 32,
          padding: 56,
          background: "#FAFAFB",
          minHeight: "100vh",
        }}
      >
        {CANVAS.map((c) => (
          <Frame key={c[0]} c={c} />
        ))}
        {EXTRA.map((c) => (
          <Frame key={c[0]} c={c} />
        ))}
      </div>
    </LocaleProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Gallery />);
