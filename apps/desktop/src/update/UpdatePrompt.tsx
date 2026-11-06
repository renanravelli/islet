// The update balloon under the menu bar icon (docs/design/ui-spec.md, section 4; ADR 0006). The
// shell decides when it shows and where; this draws it and reports its height, which shows it.

import type { PromptAnswer, PromptView } from "@islet/ui-types";
import { useLayoutEffect, useRef } from "react";
import { useLocale, useT } from "../i18n/i18n";
import { Spinner } from "../shared/components";
import "./update.css";

export function UpdatePrompt({
  view,
  onAnswer,
  onLayout,
}: {
  view: PromptView;
  onAnswer: (answer: PromptAnswer) => void;
  /** The balloon's height once drawn, arrow included. */
  onLayout: (height: number) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);

  // Before the window shows: a hidden WebKit window runs no animation frames (CLAUDE.md, UI 8).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && view && locale) onLayout(Math.ceil(el.getBoundingClientRect().height));
  }, [view, locale, onLayout]);

  const arrow = view.arrow;
  return (
    <div
      ref={ref}
      className={`prompt${arrow === null ? "" : " has-arrow"}`}
      style={{ width: view.width }}
    >
      <div
        className="prompt-card"
        role="dialog"
        aria-labelledby="prompt-title"
        aria-describedby="prompt-body"
      >
        <div className="prompt-main">
          <span className="prompt-icon" aria-hidden="true">
            <span className="prompt-icon-pill">
              <span className="prompt-icon-dot" />
            </span>
          </span>
          <div className="prompt-text">
            <span id="prompt-title" className="prompt-title">
              {t("update_prompt.title")}
            </span>
            {view.mode === "offer" && (
              <span id="prompt-body" className="prompt-body">
                {t("update_prompt.body", { version: view.version ?? "" })}
              </span>
            )}
            {view.mode === "installing" && (
              <span id="prompt-body" className="prompt-body prompt-progress" role="status">
                <Spinner />
                {t("updates.status_installing")}
              </span>
            )}
            {view.mode === "failed" && (
              <span id="prompt-body" className="prompt-body prompt-failed" role="alert">
                {t("updates.status_install_failed")}
              </span>
            )}
          </div>
        </div>
        {view.mode !== "installing" && (
          <div className="prompt-actions">
            <button
              type="button"
              className="prompt-btn prompt-later"
              onClick={() => onAnswer("later")}
            >
              {t("update_prompt.later")}
            </button>
            <button
              type="button"
              className="prompt-btn prompt-update"
              onClick={() => onAnswer("update")}
            >
              {t("update_prompt.update")}
            </button>
          </div>
        )}
      </div>
      {arrow !== null && (
        <span className="prompt-arrow" style={{ left: arrow }} aria-hidden="true" />
      )}
    </div>
  );
}
