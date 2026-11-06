import type { PromptView } from "@islet/ui-types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Locale, LocaleProvider } from "../src/i18n/i18n";
import { UpdatePrompt } from "../src/update/UpdatePrompt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const offer: PromptView = { mode: "offer", version: "0.1.5", width: 300, arrow: 150 };

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

function render(view: PromptView, locale: Locale = "pt-BR") {
  const onAnswer = vi.fn();
  const onLayout = vi.fn();
  act(() =>
    root.render(
      <LocaleProvider locale={locale}>
        <UpdatePrompt view={view} onAnswer={onAnswer} onLayout={onLayout} />
      </LocaleProvider>,
    ),
  );
  return { onAnswer, onLayout };
}

const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);
const click = (label: string) =>
  act(() =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === label)?.click(),
  );

describe("the update balloon", () => {
  it("offers the version with Depois and Atualizar, and answers with them", () => {
    const { onAnswer } = render(offer);
    const dialog = container.querySelector("[role=dialog]");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("prompt-title");
    expect(container.querySelector("#prompt-title")?.textContent).toBe("Nova versão do Islet");
    expect(container.querySelector("#prompt-body")?.textContent).toBe(
      "A versão 0.1.5 está pronta para instalar. O Islet reinicia em poucos segundos.",
    );
    expect(buttons()).toEqual(["Depois", "Atualizar"]);
    click("Depois");
    click("Atualizar");
    expect(onAnswer.mock.calls).toEqual([["later"], ["update"]]);
  });

  it("follows the language", () => {
    render(offer, "en");
    expect(container.querySelector("#prompt-body")?.textContent).toBe(
      "Version 0.1.5 is ready to install. Islet restarts in a few seconds.",
    );
    expect(buttons()).toEqual(["Later", "Update"]);
  });

  it("shows the progress while installing, with no buttons", () => {
    render({ ...offer, mode: "installing", version: null });
    const status = container.querySelector("[role=status]");
    expect(status?.textContent).toBe("Baixando e instalando. O Islet vai reiniciar.");
    expect(buttons()).toEqual([]);
  });

  it("says the install failed and offers both answers again", () => {
    render({ ...offer, mode: "failed", version: null });
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Não foi possível instalar a atualização. Tente de novo.",
    );
    expect(buttons()).toEqual(["Depois", "Atualizar"]);
  });

  it("points the arrow where the shell says, or draws none", () => {
    render(offer);
    const prompt = container.querySelector<HTMLElement>(".prompt");
    expect(prompt?.style.width).toBe("300px");
    expect(prompt?.classList.contains("has-arrow")).toBe(true);
    expect(container.querySelector<HTMLElement>(".prompt-arrow")?.style.left).toBe("150px");

    render({ ...offer, arrow: null });
    expect(container.querySelector(".prompt-arrow")).toBeNull();
    expect(container.querySelector(".prompt")?.classList.contains("has-arrow")).toBe(false);
  });

  it("reports its height for every new content, before it is shown", () => {
    const { onLayout } = render(offer);
    expect(onLayout).toHaveBeenCalledTimes(1);
    expect(typeof onLayout.mock.calls[0]?.[0]).toBe("number");
  });
});
