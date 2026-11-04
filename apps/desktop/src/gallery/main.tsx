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
  self_participant: { display_name: "Carla Mendes" },
  raised_hands: null,
  signals: { speaking_while_muted: false },
  capabilities: ["toggle_mic", "toggle_cam", "toggle_hand", "leave", "focus_tab"],
  health: { status: "ok" },
};
/** Synthetic "photos": a gradient and a shape, never a face (docs/adr/0007). */
function photo(from: string, to: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><defs><linearGradient id='g' x2='1' y2='1'><stop stop-color='${from}'/><stop offset='1' stop-color='${to}'/></linearGradient></defs><rect width='48' height='48' fill='url(#g)'/><circle cx='24' cy='20' r='9' fill='#fff' fill-opacity='.55'/><ellipse cx='24' cy='46' rx='17' ry='13' fill='#fff' fill-opacity='.55'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const PHOTOS = {
  ana: photo("#5E5CE6", "#BF5AF2"),
  bruno: photo("#FF9F0A", "#FF375F"),
};
const withPhotos: Partial<MeetingSession> = {
  active_speaker: { display_name: "Ana Souza", avatar: PHOTOS.ana },
  participants: [
    { display_name: "Ana Souza", avatar: PHOTOS.ana },
    { display_name: "Bruno Lima", avatar: PHOTOS.bruno },
    // No photo (camera on since the start, or an account without one): initials.
    { display_name: "Carla Mendes" },
  ],
};

/** Bruno raised his hand first, and someone else after him. */
const hands: Partial<MeetingSession> = {
  raised_hands: { first: { display_name: "Bruno Lima" }, count: 2, since: now },
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

/** The canvas's "Mão levantada" board, in its order and with its frame heights. */
const HANDS: Case[] = [
  ["Compacta · mão levantada", "compact", hands, notch, 96],
  ["Aviso · nova primeira da fila", "notice", hands, notch, 140],
  ["Expandida · mão levantada", "expanded", hands, notch, 340],
  ["Sem notch · mão levantada", "compact", hands, noNotch, 96],
  [
    "Nomes e fotos desligados",
    "compact",
    {
      active_speaker: { display_name: null },
      raised_hands: { first: { display_name: null }, count: 2, since: now },
    },
    notch,
    96,
  ],
];

/** States the canvas does not draw. */
const EXTRA: Case[] = [
  ["Nobody speaking, last speaker", "compact", { active_speaker: null }, notch, 96, "Bruno Lima"],
  ["Expanded, nobody has spoken yet: you", "expanded", { active_speaker: null }, notch, 300],
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
  ["Camera on", "compact", { cam: "on" }, notch, 96],
  [
    "Camera on, hand raised, an hour in, degraded: wider ears",
    "compact",
    {
      cam: "on",
      hand: "on",
      started_at: now - 3_725_000,
      health: { status: "degraded", reasons: ["stale"], provider_details: [] },
    },
    notch,
    96,
  ],
  ["Pill, camera on, hand raised", "compact", { cam: "on", hand: "on" }, noNotch, 96],
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
  ["Photos", "compact", withPhotos, notch, 96],
  ["Photos, expanded; one without a photo", "expanded", withPhotos, notch, 300],
  ["Photos, pill", "compact", withPhotos, noNotch, 96],
  [
    "One raised hand, with a photo",
    "compact",
    {
      ...withPhotos,
      raised_hands: {
        first: { display_name: "Bruno Lima", avatar: PHOTOS.bruno },
        count: 1,
        since: now,
      },
    },
    notch,
    96,
  ],
  [
    "Others' hands and your own, camera on: wider ears",
    "compact",
    { ...hands, hand: "on", cam: "on" },
    notch,
    96,
  ],
  [
    "Notice, names hidden, one hand",
    "notice",
    { raised_hands: { first: { display_name: null }, count: 1, since: now } },
    notch,
    140,
  ],
  [
    "Expanded, one raised hand",
    "expanded",
    { ...hands, raised_hands: { first: { display_name: "Bruno Lima" }, count: 1, since: now } },
    notch,
    340,
  ],
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
        {HANDS.map((c) => (
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
