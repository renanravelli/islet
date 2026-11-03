// The settings window: sidebar and four panes (docs/design/ui-spec.md, section 4).

import type { AppInfo, AppSettings, Language, UiSnapshot } from "@islet/ui-types";
import { type ReactNode, useEffect, useId, useState } from "react";
import { type Key, useT } from "../i18n/i18n";
import { api } from "../shared/api";
import {
  Badge,
  Button,
  Group,
  Keycaps,
  Row,
  SectionLabel,
  StatusPill,
  Switch,
} from "../shared/components";
import { LockIcon, PillIcon, PlugIcon, SlidersIcon, VideoIcon } from "../shared/icons";
import { LANGUAGE_NAMES, MEET, meetStatus, PLANNED, PRODUCT, REPO_DISPLAY } from "../shared/meet";
import "./settings.css";

export type Pane = "general" | "island" | "integrations" | "privacy";

const PANES: { id: Pane; label: Key; icon: ReactNode }[] = [
  { id: "general", label: "settings.nav.general", icon: <SlidersIcon size={17} /> },
  { id: "island", label: "settings.nav.island", icon: <PillIcon size={17} /> },
  { id: "integrations", label: "settings.nav.integrations", icon: <PlugIcon size={17} /> },
  { id: "privacy", label: "settings.nav.privacy", icon: <LockIcon size={17} /> },
];

export function Settings({
  info,
  settings,
  snapshot,
  initialPane = "general",
}: {
  info: AppInfo;
  settings: AppSettings;
  snapshot: UiSnapshot;
  initialPane?: Pane;
}) {
  const t = useT();
  const [pane, setPane] = useState<Pane>(initialPane);
  const update = (patch: Partial<AppSettings>) => void api.setSettings({ ...settings, ...patch });
  useEffect(() => {
    document.title = t("settings.window_title");
  });
  const current = PANES.find((p) => p.id === pane) ?? PANES[0];

  return (
    <div className="settings">
      <nav className="sidebar" aria-label={t("settings.window_title")}>
        <div className="titlebar-space" data-tauri-drag-region />
        <ul>
          {PANES.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`nav-item ${p.id === pane ? "selected" : ""}`}
                aria-current={p.id === pane ? "page" : undefined}
                onClick={() => setPane(p.id)}
              >
                {p.icon}
                {t(p.label)}
              </button>
            </li>
          ))}
        </ul>
        <span className="sidebar-version">
          {PRODUCT} {info.version}
        </span>
      </nav>
      <section className="pane">
        <header className="pane-header" data-tauri-drag-region>
          <h1>{current && t(current.label)}</h1>
        </header>
        <div className="pane-scroll">
          {pane === "general" && <General info={info} settings={settings} update={update} />}
          {pane === "island" && <IslandPane settings={settings} update={update} />}
          {pane === "integrations" && <Integrations info={info} snapshot={snapshot} />}
          {pane === "privacy" && <Privacy info={info} />}
        </div>
      </section>
    </div>
  );
}

type Update = (patch: Partial<AppSettings>) => void;

function General({
  info,
  settings,
  update,
}: {
  info: AppInfo;
  settings: AppSettings;
  update: Update;
}) {
  const t = useT();
  const selectId = useId();
  const [launch, setLaunch] = useState<boolean | null>(null);
  useEffect(() => {
    void api.autostart().then(setLaunch);
  }, []);
  const toggleLaunch = (on: boolean) => {
    api
      .setAutostart(on)
      .then(setLaunch)
      .catch(() => void api.autostart().then(setLaunch));
  };

  return (
    <div className="groups">
      <Group>
        <Row
          label={t("settings.general.launch")}
          trailing={
            <Switch
              checked={launch ?? false}
              disabled={launch === null}
              onChange={toggleLaunch}
              label={t("settings.general.launch")}
            />
          }
        />
        <Row
          label={<label htmlFor={selectId}>{t("settings.general.language")}</label>}
          trailing={
            <select
              id={selectId}
              value={settings.language}
              onChange={(e) => update({ language: e.target.value as Language })}
            >
              <option value="auto">{t("settings.general.language.system")}</option>
              <option value="pt-BR">{LANGUAGE_NAMES["pt-BR"]}</option>
              <option value="en">{LANGUAGE_NAMES.en}</option>
            </select>
          }
        />
      </Group>
      <div>
        <SectionLabel>{t("settings.shortcuts")}</SectionLabel>
        <Group>
          <ShortcutRow
            ok={info.shortcuts.toggle_island}
            label="shortcut.toggle_island"
            letter="I"
          />
          <ShortcutRow ok={info.shortcuts.toggle_mic} label="shortcut.toggle_mic" letter="M" />
        </Group>
        <p className="footnote">{t("settings.shortcuts.note")}</p>
      </div>
    </div>
  );
}

function ShortcutRow({ ok, label, letter }: { ok: boolean; label: Key; letter: string }) {
  const t = useT();
  return (
    <Row
      label={t(label)}
      description={ok ? undefined : t("shortcut.unavailable")}
      descriptionTone="warning"
      trailing={
        <span className="keycap-cell">
          <Keycaps keys={["⌃", "⌥", letter]} />
        </span>
      }
    />
  );
}

function IslandPane({ settings, update }: { settings: AppSettings; update: Update }) {
  const t = useT();
  return (
    <div className="groups">
      <div>
        <SectionLabel>{t("settings.island.behavior")}</SectionLabel>
        <Group>
          <Row
            label={t("settings.island.hover")}
            description={t("settings.island.hover_desc")}
            trailing={
              <Switch
                checked={settings.expand_on_hover}
                onChange={(on) => update({ expand_on_hover: on })}
                label={t("settings.island.hover")}
              />
            }
          />
          <Row
            label={t("settings.island.names")}
            description={t("settings.island.names_desc")}
            trailing={
              <Switch
                checked={settings.show_participant_names}
                onChange={(on) => update({ show_participant_names: on })}
                label={t("settings.island.names")}
              />
            }
          />
          <Row
            label={
              <span className="label-with-badge">
                {t("settings.island.muted_alert")}
                <Badge tone="experimental">{t("badge.experimental")}</Badge>
              </span>
            }
            description={t("settings.island.muted_alert_desc")}
            trailing={
              <Switch
                checked={settings.muted_speaking_alert}
                onChange={(on) => update({ muted_speaking_alert: on })}
                label={t("settings.island.muted_alert")}
              />
            }
          />
        </Group>
      </div>
      <div>
        <SectionLabel>{t("settings.island.no_notch")}</SectionLabel>
        <Group>
          <Row
            leading={<span className="pill-preview" aria-hidden="true" />}
            label={t("settings.island.no_notch_row")}
            description={t("settings.island.no_notch_desc")}
          />
        </Group>
      </div>
    </div>
  );
}

function Integrations({ info, snapshot }: { info: AppInfo; snapshot: UiSnapshot }) {
  const t = useT();
  const meet = meetStatus(snapshot);
  const [toast, setToast] = useState(false);
  const [reinstalled, setReinstalled] = useState<"ok" | "error" | null>(null);

  const health = meet.lastHealth;
  const pill =
    info.bridge.state === "error" ? (
      <StatusPill tone="warning">{t("status.bridge_error")}</StatusPill>
    ) : !meet.connected ? (
      <StatusPill tone="neutral">{t("status.disconnected")}</StatusPill>
    ) : health && health.status === "degraded" ? (
      <StatusPill tone="warning">{t("status.degraded")}</StatusPill>
    ) : (
      <StatusPill tone="success">{t("status.connected")}</StatusPill>
    );

  let healthDescription: ReactNode;
  let healthTrailing: ReactNode = null;
  if (!health) {
    healthDescription = t("health.no_data_desc");
  } else if (health.status === "ok") {
    healthDescription = t("health.ok_desc");
    healthTrailing = <span className="ok-value">{t("health.ok")}</span>;
  } else {
    const keys = health.provider_details;
    healthDescription = (
      <>
        {t("health.degraded_desc", { n: keys.length || health.reasons.length })}
        {keys.length > 0 && <span className="selector-keys">{keys.join(", ")}</span>}
      </>
    );
  }

  const copy = async () => {
    const text = await api.diagnostics();
    await navigator.clipboard.writeText(text);
    setToast(true);
    setTimeout(() => setToast(false), 3000);
  };
  const reinstall = async () => {
    const state = await api.repairBridge();
    setReinstalled(state.state === "ready" ? "ok" : "error");
  };

  return (
    <div className="groups">
      <div>
        <SectionLabel>{t("settings.integrations.available")}</SectionLabel>
        <Group>
          <div className="meet-header">
            <span className="app-tile" aria-hidden="true">
              <VideoIcon size={20} />
            </span>
            <div className="meet-title">
              <span className="row-label">{MEET}</span>
              <span className="row-description">
                {meet.connected
                  ? t("settings.integrations.meet_sub_connected", { version: meet.version ?? "" })
                  : t("settings.integrations.meet_sub_disconnected")}
              </span>
            </div>
            {pill}
          </div>
          <Row
            label={t("settings.integrations.health")}
            description={healthDescription}
            trailing={healthTrailing}
          />
          <div className="actions">
            <Button variant="outline" onClick={() => void copy()}>
              {t("action.copy_diagnostics")}
            </Button>
            <Button variant="outline" onClick={() => void reinstall()}>
              {t("action.reinstall_bridge")}
            </Button>
            <span className="action-result" role="status">
              {toast && t("toast.diagnostics_copied")}
              {!toast && reinstalled === "ok" && t("bridge.reinstalled")}
              {!toast && reinstalled === "error" && t("onb2.bridge.error_desc")}
            </span>
          </div>
        </Group>
      </div>
      <div>
        <SectionLabel>{t("settings.integrations.planned")}</SectionLabel>
        <Group>
          {PLANNED.map((name) => (
            <Row
              key={name}
              label={name}
              trailing={<Badge tone="planned">{t("badge.planned")}</Badge>}
            />
          ))}
        </Group>
        <p className="footnote">
          <button
            type="button"
            className="link-button"
            onClick={() => void api.openLink("providers")}
          >
            {t("settings.integrations.contribute")}
          </button>
        </p>
      </div>
    </div>
  );
}

function Privacy({ info }: { info: AppInfo }) {
  const t = useT();
  return (
    <div className="groups">
      <div className="statement">
        <LockIcon size={20} />
        <div>
          <h2>{t("settings.privacy.card_title")}</h2>
          <p>{t("settings.privacy.card_body")}</p>
        </div>
      </div>
      <Group>
        <Row
          label={t("settings.privacy.logs")}
          description={t("settings.privacy.logs_desc")}
          trailing={
            <Button variant="outline" onClick={() => void api.openLogs()}>
              {t("settings.privacy.open_folder")}
            </Button>
          }
        />
        <Row
          label={t("settings.privacy.guide")}
          trailing={
            <Button variant="outline" onClick={() => void api.openWindow("onboarding")}>
              {t("settings.privacy.review_onboarding")}
            </Button>
          }
        />
        <Row
          label={t("settings.privacy.version")}
          trailing={<span className="value">{info.version}</span>}
        />
        <Row
          label={t("settings.privacy.source")}
          trailing={
            <button
              type="button"
              className="link-button value"
              onClick={() => void api.openLink("source")}
            >
              {REPO_DISPLAY}
            </button>
          }
        />
        <Row
          label={t("settings.privacy.license")}
          trailing={
            <button
              type="button"
              className="link-button value"
              onClick={() => void api.openLink("license")}
            >
              {t("settings.privacy.license_value")}
            </button>
          }
        />
      </Group>
    </div>
  );
}
