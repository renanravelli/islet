// Checks that tie the extension to the rest of the repository.

import { describe, expect, it, vi } from "vitest";
import extensionIds from "../../crates/bridge/extension-ids.txt?raw";
import bridgeLib from "../../crates/bridge/src/lib.rs?raw";
import providerMeet from "../../crates/provider-meet/src/lib.rs?raw";
import manifest from "../manifest.json";
import { Bridge, type NativePort, parseAppMessage, type TabPort } from "../src/background/bridge";
import { MeetAdapter } from "../src/content/meet/adapter";
import {
  DEGRADED_REASON,
  matchesAny,
  SELECTORS,
  type SelectorKey,
} from "../src/content/meet/selectors";
import { HOST_NAME } from "../src/shared/host";
import type { TabState, TabToWorker, WorkerToTab } from "../src/shared/messages";
import { FIXTURES, load } from "./dom";
import { FakePort } from "./fakes";

type Json = Record<string, unknown>;

const protocolFixtures = import.meta.glob<Json>("../../crates/protocol/fixtures/*/*.json", {
  eager: true,
  import: "default",
});

function fixture(name: string): Json {
  const found = Object.entries(protocolFixtures).find(([path]) => path.endsWith(`/${name}.json`));
  if (!found) throw new Error(`no protocol fixture ${name}`);
  return found[1];
}

async function extensionId(base64Key: string): Promise<string> {
  const der = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + Number.parseInt(c, 16)));
}

describe("manifest", () => {
  it("derives the development ID the native host allows", async () => {
    const allowed = extensionIds
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(allowed).toContain(await extensionId(manifest.key));
  });

  it("asks for the minimum permissions", () => {
    expect(manifest.permissions).toEqual(["nativeMessaging"]);
    expect(manifest.host_permissions).toEqual(["https://meet.google.com/*"]);
    expect(manifest).not.toHaveProperty("web_accessible_resources");
    expect(manifest).not.toHaveProperty("optional_permissions");
  });

  it("uses the native host name of the app", () => {
    expect(bridgeLib).toContain(`pub const BUNDLE_ID: &str = "${HOST_NAME}";`);
  });
});

describe("protocol fixtures", () => {
  it("accepts every app → extension fixture", () => {
    for (const name of ["command", "ping", "error"]) {
      expect(parseAppMessage(fixture(name))).toEqual(fixture(name));
    }
  });

  it("sends exactly what the Rust fixtures describe", async () => {
    const natives: FakePort<unknown, unknown>[] = [];
    const hello = fixture("hello");
    const bridge = new Bridge({
      connectNative: () => {
        const port = new FakePort<unknown, unknown>();
        natives.push(port);
        return port as NativePort;
      },
      focusTab: async () => true,
      tabExists: async () => true,
      hello: () => ({
        extension_version: String(hello.extension_version),
        browser: String(hello.browser),
      }),
    });
    const tab = new FakePort<TabToWorker, WorkerToTab>();
    bridge.addTab(1234, tab as TabPort);
    const native = natives[0];
    if (!native) throw new Error("no native port");
    const last = () => native.posted.at(-1);
    expect(last()).toEqual(hello);

    for (const name of ["session-update-full", "session-update-degraded"]) {
      const { v: _v, type: _type, tab_id: _tab, ...state } = fixture(name);
      tab.deliver({ kind: "update", state: state as TabState });
      expect(last()).toEqual(fixture(name));
    }
    tab.deliver({ kind: "ended" });
    expect(last()).toEqual(fixture("session-ended"));
    for (const name of ["command-result-ok", "command-result-error"]) {
      const { v: _v, type: _type, ...result } = fixture(name);
      tab.deliver({ kind: "result", result: result as never });
      expect(last()).toEqual(fixture(name));
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
    native.deliver(fixture("ping"));
    expect(last()).toEqual(fixture("pong"));
  });

  it("the adapter produces no field the protocol does not know", () => {
    load(FIXTURES.inCallEn);
    const known = new Set([...Object.keys(fixture("session-update-full")), "degraded_reasons"]);
    for (const key of Object.keys(new MeetAdapter(document).readState().state)) {
      expect(known).toContain(key);
    }
  });
});

describe("selectors.json", () => {
  const keys = Object.keys(DEGRADED_REASON) as SelectorKey[];

  it("defines every key, none verified yet", () => {
    expect(Object.keys(SELECTORS.keys).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(SELECTORS.keys[key].verified, key).toBe(false);
      expect(SELECTORS.keys[key].strategies.length, key).toBeGreaterThan(0);
    }
    expect(SELECTORS.version).toBe(1);
    expect(SELECTORS.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has only valid CSS and regexes", () => {
    const json = JSON.stringify(SELECTORS.keys);
    for (const [, pattern] of json.matchAll(/"(?:en|pt-BR)":"((?:[^"\\]|\\.)*)"/g)) {
      expect(() => new RegExp(JSON.parse(`"${pattern}"`), "i")).not.toThrow();
    }
    for (const [, css] of json.matchAll(/"css":"((?:[^"\\]|\\.)*)"/g)) {
      expect(() => document.querySelector(JSON.parse(`"${css}"`))).not.toThrow();
    }
    expect(matchesAny("Leave call", { en: "^leave call" })).toBe(true);
  });

  it("matches the keys islet-provider-meet reports as provider details", () => {
    for (const key of keys) expect(providerMeet).toContain(`=> "${key}"`);
  });
});
