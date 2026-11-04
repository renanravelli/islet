// Names that are not UI copy (product and language names stay as they are in every locale),
// and the Meet provider's status as the windows show it.

import type { Health, UiSnapshot } from "@islet/ui-types";

export const PRODUCT = "Islet";
export const MEET = "Google Meet";
export const REPO_DISPLAY = "github.com/renanravelli/islet";
/** Language names, each in its own language, in both locales. */
export const LANGUAGE_NAMES = { "pt-BR": "Português (Brasil)", en: "English" } as const;

export interface MeetStatus {
  /** The extension said hello: only then is it "connected". */
  connected: boolean;
  version: string | null;
  lastHealth: Health | null;
}

export function meetStatus(snapshot: UiSnapshot | undefined): MeetStatus {
  const meet = snapshot?.providers.find((p) => p.id === "meet");
  return {
    connected: Boolean(meet?.connected && meet.client_version),
    version: meet?.client_version ?? null,
    lastHealth: meet?.last_health ?? null,
  };
}
