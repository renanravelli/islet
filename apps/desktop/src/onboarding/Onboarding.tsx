// The first-run guide: four steps (docs/design/ui-spec.md, section 3).

import type { AppInfo, AppSettings, BridgeState, UiSnapshot } from "@islet/ui-types";
import { useEffect, useState } from "react";
import { rich, useT } from "../i18n/i18n";
import { useHeldSpeaker, useNow } from "../island/hooks";
import { IslandView } from "../island/IslandView";
import { api } from "../shared/api";
import {
  Button,
  Group,
  Keycaps,
  Row,
  Spinner,
  StatusCircle,
  StepIndicator,
  Switch,
} from "../shared/components";
import { InfoIcon, LockIcon } from "../shared/icons";
import { meetStatus, PRODUCT } from "../shared/meet";
import "./onboarding.css";

const TOTAL = 4;
/** After this long waiting for the extension, offer the troubleshooting guide. */
export const TROUBLESHOOT_AFTER_MS = 60_000;

export function Onboarding({
  info,
  settings,
  snapshot,
  preview,
  initialStep = 1,
}: {
  info: AppInfo;
  settings: AppSettings;
  snapshot: UiSnapshot;
  preview: UiSnapshot | undefined;
  initialStep?: number;
}) {
  const t = useT();
  const [step, setStep] = useState(initialStep);
  const meet = meetStatus(snapshot);
  const next = () => setStep((s) => Math.min(TOTAL, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  let footer: React.ReactNode;
  switch (step) {
    case 1:
      footer = <Button onClick={next}>{t("onb1.cta")}</Button>;
      break;
    case 2:
      footer = (
        <>
          <Button variant="secondary" onClick={back}>
            {t("common.back")}
          </Button>
          {meet.connected ? (
            <Button onClick={next}>{t("common.continue")}</Button>
          ) : (
            <>
              <Button variant="text" onClick={next}>
                {t("onb2.skip")}
              </Button>
              <Button disabled>{t("common.continue")}</Button>
            </>
          )}
        </>
      );
      break;
    case 3:
      footer = (
        <>
          <Button variant="secondary" onClick={back}>
            {t("common.back")}
          </Button>
          <Button variant="text" onClick={next}>
            {t("onb3.later")}
          </Button>
          <Button
            onClick={() => {
              void api.setSettings({ ...settings, meet_pip_tip_ack: true });
              next();
            }}
          >
            {t("onb3.done")}
          </Button>
        </>
      );
      break;
    default:
      footer = (
        <>
          <Button variant="secondary" onClick={back}>
            {t("common.back")}
          </Button>
          <Button onClick={() => void api.finishOnboarding()}>{t("onb4.finish")}</Button>
        </>
      );
  }

  return (
    <div className="onboarding">
      <div className="titlebar" data-tauri-drag-region />
      <main className="onb-content">
        {step === 1 && <Welcome info={info} preview={preview} />}
        {step === 2 && <ConnectChrome meet={meet} />}
        {step === 3 && <PictureInPicture />}
        {step === 4 && <AllSet info={info} settings={settings} />}
      </main>
      <footer className="onb-footer">
        <StepIndicator
          step={step}
          total={TOTAL}
          label={t("onboarding.step_of", { n: step, total: TOTAL })}
        />
        <div className="onb-buttons">{footer}</div>
      </footer>
    </div>
  );
}

function Welcome({ info, preview }: { info: AppInfo; preview: UiSnapshot | undefined }) {
  const t = useT();
  const session = preview?.primary ?? null;
  const speaker = useHeldSpeaker(session);
  const now = useNow(session !== null);
  const geometry = {
    has_notch: true,
    notch_width: info.geometry.has_notch ? info.geometry.notch_width : 185,
    top_inset: 32,
  };
  return (
    <>
      <div className="mark">
        <span className="mark-pill" aria-hidden="true" />
        <span className="wordmark">{PRODUCT}</span>
      </div>
      <h1 className="onb-title">{t("onb1.title")}</h1>
      <p className="onb-body">{t("onb1.body")}</p>
      <div className="preview-card">
        <div className="preview-menubar" />
        <div className="preview-island">
          <IslandView
            mode={session ? (session.status.phase === "ended" ? "ended" : "compact") : "hidden"}
            session={session}
            speaker={speaker}
            geometry={geometry}
            now={now}
          />
        </div>
        <span className="preview-caption">{t("onb1.preview_caption")}</span>
      </div>
      <p className="privacy-line">
        <LockIcon size={16} />
        {t("onb1.privacy")}
      </p>
    </>
  );
}

type ExtensionState = "not_connected" | "waiting" | "connected";

function ConnectChrome({ meet }: { meet: ReturnType<typeof meetStatus> }) {
  const t = useT();
  const [bridge, setBridge] = useState<BridgeState>({ state: "unknown" });
  const [clicked, setClicked] = useState(false);
  const [slow, setSlow] = useState(false);
  // Only a real hello sets "connected"; already connected when the step opens shows it at once.
  const extension: ExtensionState = meet.connected
    ? "connected"
    : clicked
      ? "waiting"
      : "not_connected";

  useEffect(() => {
    void api.repairBridge().then(setBridge);
  }, []);
  useEffect(() => {
    if (extension !== "waiting") return;
    setSlow(false);
    const id = setTimeout(() => setSlow(true), TROUBLESHOOT_AFTER_MS);
    return () => clearTimeout(id);
  }, [extension]);

  const bridgeRow =
    bridge.state === "error" ? (
      <Row
        leading={<StatusCircle tone="warning" />}
        label={t("onb2.bridge.title")}
        description={t("onb2.bridge.error_desc")}
        trailing={
          <Button variant="outline" onClick={() => void api.repairBridge().then(setBridge)}>
            {t("common.retry")}
          </Button>
        }
      />
    ) : (
      <Row
        leading={bridge.state === "ready" ? <StatusCircle tone="success" /> : <Spinner />}
        label={t("onb2.bridge.title")}
        description={t("onb2.bridge.ok_desc")}
        trailing={
          bridge.state === "ready" && <span className="ok-text">{t("onb2.bridge.ok")}</span>
        }
      />
    );

  let extensionRow: React.ReactNode;
  if (extension === "connected") {
    extensionRow = (
      <Row
        leading={<StatusCircle tone="success" />}
        label={t("onb2.ext.title")}
        description={t("onb2.ext.connected_desc", { version: meet.version ?? "" })}
        trailing={<span className="ok-text">{t("onb2.ext.connected")}</span>}
      />
    );
  } else if (extension === "waiting") {
    extensionRow = (
      <Row
        leading={<Spinner />}
        label={t("onb2.ext.title")}
        description={
          <>
            {t("onb2.ext.waiting_desc_store")}
            {slow && (
              <span className="troubleshoot">
                <Button variant="text" onClick={() => void api.openLink("troubleshooting")}>
                  {t("onb2.ext.troubleshoot")}
                </Button>
              </span>
            )}
          </>
        }
        trailing={
          <span className="waiting-text" role="status">
            {t("onb2.ext.waiting")}
          </span>
        }
      />
    );
  } else {
    extensionRow = (
      <Row
        leading={<span className="number-badge">2</span>}
        label={t("onb2.ext.title")}
        description={t("onb2.ext.idle_desc")}
        trailing={
          <Button
            onClick={() => {
              setClicked(true);
              // The extension's Chrome Web Store page (EXTENSION_STORE_URL in the shell).
              void api.openLink("install_extension");
            }}
          >
            {t("onb2.ext.install")}
          </Button>
        }
      />
    );
  }

  return (
    <>
      <h1 className="onb-title compact-top">{t("onb2.title")}</h1>
      <p className="onb-body">{t("onb2.body")}</p>
      <div className="onb-group">
        <Group>
          {bridgeRow}
          {extensionRow}
        </Group>
      </div>
      {extension === "connected" ? (
        <p className="success-banner">{t("onb2.banner")}</p>
      ) : (
        <p className="note">{t("onb2.other_browsers")}</p>
      )}
    </>
  );
}

function PictureInPicture() {
  const t = useT();
  return (
    <>
      <h1 className="onb-title compact-top">{t("onb3.title")}</h1>
      <p className="onb-body">{t("onb3.body")}</p>
      <div className="pip-columns">
        <ol className="pip-steps">
          {(["onb3.step1", "onb3.step2", "onb3.step3"] as const).map((key, i) => (
            <li key={key}>
              <span className="pip-number" aria-hidden="true">
                {i + 1}
              </span>
              <span>{rich(t(key))}</span>
            </li>
          ))}
        </ol>
        <div className="pip-illustration" aria-hidden="true">
          <span className="pip-label">{t("onb3.illustration_label")}</span>
          {/* Only the target option: Meet's other options are not written, we cannot verify them. */}
          <span className="pip-option">
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {t("onb3.illustration_option")}
          </span>
          <span className="pip-bar" />
          <span className="pip-bar" />
          <span className="pip-bar short" />
        </div>
      </div>
      <p className="tip">
        <InfoIcon size={16} />
        <span>{rich(t("onb3.tip"))}</span>
      </p>
    </>
  );
}

function AllSet({ info, settings }: { info: AppInfo; settings: AppSettings }) {
  const t = useT();
  const [launch, setLaunch] = useState(true);
  const [failed, setFailed] = useState(false);

  const apply = (on: boolean) => {
    setLaunch(on);
    api
      .setAutostart(on)
      .then((real) => {
        setLaunch(real);
        setFailed(real !== on);
      })
      .catch(() => {
        setLaunch(!on);
        setFailed(true);
      });
  };
  // Launch at login defaults to on in this step and applies at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the step opens
  useEffect(() => apply(true), []);

  const shortcutRow = (
    ok: boolean,
    label: "shortcut.toggle_island" | "shortcut.toggle_mic",
    key: string,
  ) => (
    <Row
      label={t(label)}
      description={ok ? undefined : t("shortcut.unavailable")}
      descriptionTone="warning"
      trailing={
        <span className="keycap-column">
          <Keycaps keys={["⌃", "⌥", key]} />
        </span>
      }
    />
  );

  return (
    <>
      <div className="done-circle">
        <StatusCircle tone="success" size={48} />
      </div>
      <h1 className="onb-title done-title">{t("onb4.title")}</h1>
      <p className="onb-body">{t("onb4.body")}</p>
      <div className="onb-group">
        <Group>
          {shortcutRow(info.shortcuts.toggle_island, "shortcut.toggle_island", "I")}
          {shortcutRow(info.shortcuts.toggle_mic, "shortcut.toggle_mic", "M")}
          <Row
            label={t("onb4.launch")}
            description={failed ? t("onb4.launch_error") : undefined}
            descriptionTone="warning"
            trailing={<Switch checked={launch} onChange={apply} label={t("onb4.launch")} />}
          />
          {/* Off until the person turns it on (ADR 0006). */}
          <Row
            label={t("updates.auto")}
            description={t("updates.auto_desc")}
            trailing={
              <Switch
                checked={settings.check_for_updates}
                onChange={(on) => void api.setSettings({ ...settings, check_for_updates: on })}
                label={t("updates.auto")}
              />
            }
          />
        </Group>
      </div>
      <p className="menubar-hint">
        <span className="mini-pill" aria-hidden="true" />
        {t("onb4.menubar")}
      </p>
    </>
  );
}
