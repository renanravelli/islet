import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AVATAR_SIZE,
  CONFIRM_TIMEOUT_MS,
  MeetAdapter,
  meetingCode,
  SELECTOR_TTL_MS,
} from "../src/content/meet/adapter";
import { SELECTORS } from "../src/content/meet/selectors";
import { button, FIXTURES, load } from "./dom";

const adapter = () => new MeetAdapter(document);

describe("detectInCall", () => {
  it("is true in a call and false in the lobby", () => {
    load(FIXTURES.inCallEn);
    expect(adapter().detectInCall()).toBe(true);
    load(FIXTURES.inCallPtBr);
    expect(adapter().detectInCall()).toBe(true);
    load(FIXTURES.lobby);
    expect(adapter().detectInCall()).toBe(false);
  });
});

describe("readState", () => {
  it("reads every field of an English call", () => {
    load(FIXTURES.inCallEn);
    const { state, failed } = adapter().readState();
    expect(failed).toEqual([]);
    expect(state).toEqual({
      meeting_code: "abc-defg-hij",
      title: "Synthetic design review",
      self: { mic: "on", cam: "off", hand: "off" },
      active_speaker: { display_name: "Alex Example" },
      participant_count: 5,
      participants: [{ display_name: "Alex Example" }, { display_name: "Sam Example" }],
      signals: { speaking_while_muted: false },
      capabilities: ["toggle_mic", "toggle_cam", "toggle_hand", "leave", "focus_tab"],
      health: "ok",
    });
  });

  it("falls back to pt-BR aria-labels", () => {
    load(FIXTURES.inCallPtBr);
    const { state } = adapter().readState();
    expect(state.self).toEqual({ mic: "off", cam: "on", hand: "on" });
    expect(state.participant_count).toBe(3);
    expect(state.signals.speaking_while_muted).toBe(true);
    // Nobody is speaking and there is no title: neither is a failure.
    expect(state.active_speaker).toBeUndefined();
    expect(state.title).toBeUndefined();
    expect(state.health).toBe("ok");
  });

  it("reports what it cannot read instead of guessing", () => {
    load(FIXTURES.degraded);
    const { state, failed } = adapter().readState();
    expect(state.self).toEqual({ mic: "unknown", cam: "unknown", hand: "unknown" });
    expect(state.health).toBe("degraded");
    expect(state.degraded_reasons).toEqual([
      "mic_button",
      "cam_button",
      "hand_button",
      "participant_count",
    ]);
    expect(failed).toEqual(["micButton", "camButton", "handButton", "participantCount"]);
    // Only controls it found are offered: the camera button exists even if its state is unclear.
    expect(state.capabilities).toEqual(["toggle_cam", "leave", "focus_tab"]);
  });

  it("never reads the chat", () => {
    load(FIXTURES.inCallEn);
    expect(JSON.stringify(adapter().readState())).not.toContain("chat line");
  });

  it("shows the meeting code as the title in an instant meeting, as Meet does", () => {
    load(FIXTURES.inCallEn);
    const title = document.querySelector("[jsname=NeC6gb]");
    if (title) title.textContent = "abc-defg-hij";
    const { state, failed } = adapter().readState();
    expect(state.title).toBe("abc-defg-hij");
    expect(failed).toEqual([]);
  });

  it("names up to three participants, each once, in page order", () => {
    load(FIXTURES.inCallEn);
    const toolbar = document.querySelector("[role=toolbar]");
    for (const name of ["Sam Example", "Jo Example", "Kim Example"]) {
      const tile = document.createElement("div");
      tile.setAttribute("data-participant-id", name);
      tile.setAttribute("jsname", "E2KThb");
      tile.innerHTML = `<span class="notranslate">${name}</span>`;
      toolbar?.before(tile);
    }
    expect(adapter().readState().state.participants).toEqual([
      { display_name: "Alex Example" },
      { display_name: "Sam Example" },
      { display_name: "Jo Example" },
    ]);
  });

  it("keeps names and titles short", () => {
    load(FIXTURES.inCallEn);
    const title = document.querySelector("[jsname=NeC6gb]");
    if (title) title.textContent = "x".repeat(500);
    expect(adapter().readState().state.title).toHaveLength(200);
  });
});

describe("the speaking-while-muted notice", () => {
  const notice = () => document.querySelector<HTMLElement>("[role='dialog']");
  const muted = () => adapter().readState().state.signals.speaking_while_muted;

  it("counts Meet's bubble only while it is on screen", () => {
    load(FIXTURES.inCallPtBr);
    const el = notice();
    if (!el) throw new Error("the fixture has no notice");
    el.checkVisibility = () => true;
    expect(muted()).toBe(true);
    // Meet auto-hides the bubble; one left in the page, hidden, is not a notice.
    el.checkVisibility = () => false;
    expect(muted()).toBe(false);
  });

  it("ignores the screen-reader announcement of muting", () => {
    load(FIXTURES.inCallPtBr);
    notice()?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div aria-live="polite">Seu microfone está desativado.</div>',
    );
    expect(muted()).toBe(false);
  });
});

describe("the element cache", () => {
  const mic = (meet: MeetAdapter) => meet.readState().state.self.mic;

  it("reads a replaced control at once", () => {
    load(FIXTURES.inCallEn);
    const meet = adapter();
    expect(mic(meet)).toBe("on");
    const old = button(/microphone/);
    const replacement = old.cloneNode() as HTMLElement;
    replacement.setAttribute("data-is-muted", "true");
    old.replaceWith(replacement);
    expect(mic(meet)).toBe("off");
  });

  it("drops a control that no longer matches the strategy that found it", () => {
    load(FIXTURES.inCallEn);
    const meet = adapter();
    expect(mic(meet)).toBe("on");
    const el = button(/microphone/);
    // Meet renders it again without the attributes the first strategy needs.
    el.removeAttribute("jsname");
    el.removeAttribute("data-is-muted");
    el.setAttribute("aria-label", "Turn on microphone (⌘ + d)");
    expect(mic(meet)).toBe("off");
  });

  it("searches the page again in full once the cached element expires", () => {
    load(FIXTURES.inCallPtBr);
    let now = 0;
    const meet = new MeetAdapter(document, SELECTORS, undefined, () => now);
    // Found by its pt-BR label, the fallback strategy.
    expect(mic(meet)).toBe("off");
    // A control the first strategy prefers shows up; the cached one is used until it expires.
    document
      .querySelector("[role=toolbar]")
      ?.insertAdjacentHTML("afterbegin", '<button jsname="hw0c9" data-is-muted="false"></button>');
    now = SELECTOR_TTL_MS - 1;
    expect(mic(meet)).toBe("off");
    now = SELECTOR_TTL_MS;
    expect(mic(meet)).toBe("on");
  });

  it("forgets every element on refresh and when the meeting changes", () => {
    load(FIXTURES.inCallPtBr);
    const meet = adapter();
    expect(mic(meet)).toBe("off");
    const preferred = '<button jsname="hw0c9" data-is-muted="false"></button>';
    const toolbar = document.querySelector("[role=toolbar]");
    toolbar?.insertAdjacentHTML("afterbegin", preferred);
    meet.refresh();
    expect(mic(meet)).toBe("on");

    toolbar?.firstElementChild?.remove();
    expect(mic(meet)).toBe("off");
    toolbar?.insertAdjacentHTML("afterbegin", preferred);
    window.history.replaceState(null, "", "/xyz-abcd-efg");
    expect(mic(meet)).toBe("on");
  });

  it("searches the whole page only for the tiles once the controls are known", () => {
    load(FIXTURES.inCallEn);
    const meet = adapter();
    meet.readState();
    const scans = vi.spyOn(document, "querySelectorAll");
    const { state } = meet.readState();
    expect(scans.mock.calls).toEqual([["[data-participant-id][jsname='E2KThb']"]]);
    scans.mockRestore();
    // The same reading as without the cache.
    expect(state.active_speaker).toEqual({ display_name: "Alex Example" });
    expect(state.self.mic).toBe("on");
    expect(state.participant_count).toBe(5);
  });

  it("does not look for the speaking-while-muted notice with the mic on", () => {
    load(FIXTURES.inCallPtBr);
    const meet = adapter();
    expect(meet.readState().state.signals.speaking_while_muted).toBe(true);
    button(/microfone/).setAttribute("aria-label", "Desativar microfone (⌘ + d)");
    expect(meet.readState().state.signals.speaking_while_muted).toBe(false);
  });
});

describe("meetingCode", () => {
  it("takes the code from the path", () => {
    expect(meetingCode("/abc-defg-hij")).toBe("abc-defg-hij");
    expect(meetingCode("/abc-defg-hij/extra")).toBe("abc-defg-hij");
    expect(meetingCode("/lookup/some-name")).toBe("lookup");
    expect(meetingCode("/")).toBe("");
  });
});

describe("execute", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("confirms a toggle once the page shows the change", async () => {
    load(FIXTURES.inCallEn);
    const mic = button(/microphone/);
    mic.addEventListener("click", () =>
      setTimeout(() => {
        mic.setAttribute("data-is-muted", "true");
        mic.setAttribute("aria-label", "Turn on microphone (⌘ + d)");
      }, 300),
    );
    const result = adapter().execute("toggle_mic");
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toBeNull();
  });

  it("reports not_confirmed when nothing changes within 1.5 s", async () => {
    load(FIXTURES.inCallEn);
    const clicked = vi.fn();
    button(/raise hand/i).addEventListener("click", clicked);
    const result = adapter().execute("toggle_hand");
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + 100);
    expect(await result).toBe("not_confirmed");
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("reports control_not_found without clicking anything", async () => {
    load(FIXTURES.degraded);
    expect(await adapter().execute("toggle_mic")).toBe("control_not_found");
    expect(await adapter().execute("toggle_hand")).toBe("control_not_found");
  });

  it("answers the host's leave dialog by only leaving, never ending the call for everyone", async () => {
    load(FIXTURES.inCallPtBr);
    let endedForEveryone = false;
    button(/sair da chamada/i).addEventListener("click", () =>
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div role="dialog"><button id="end-all">Encerrar a chamada para todos</button><button id="leave">Sair da chamada</button></div>`,
        );
        document
          .getElementById("leave")
          ?.addEventListener("click", () =>
            setTimeout(() => load("<main><p>Você saiu da reunião</p></main>"), 200),
          );
        document.getElementById("end-all")?.addEventListener("click", () => {
          endedForEveryone = true;
        });
      }, 300),
    );
    const result = adapter().execute("leave");
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
    expect(await result).toBeNull();
    expect(endedForEveryone).toBe(false);
  });

  it("refuses to click a control that ends the call for everyone, whatever the selectors say", async () => {
    load(FIXTURES.inCallPtBr);
    // A broken registry whose "just leave" strategy points at the wrong button.
    const keys = {
      ...SELECTORS.keys,
      justLeaveButton: { ...SELECTORS.keys.justLeaveButton, strategies: [{ css: "#end-all" }] },
    };
    const clicked = vi.fn();
    button(/sair da chamada/i).addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog"><button id="end-all">Encerrar a chamada para todos</button></div>`,
      );
      document.getElementById("end-all")?.addEventListener("click", clicked);
    });
    const result = new MeetAdapter(document, { ...SELECTORS, keys }).execute("leave");
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + 100);
    expect(await result).toBe("not_confirmed");
    expect(clicked).not.toHaveBeenCalled();
  });

  it("leaves a dialog it does not recognize for the person to answer", async () => {
    load(FIXTURES.inCallEn);
    const clicked = vi.fn();
    button(/leave call/i).addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog"><button id="other">Something new</button></div>`,
      );
      document.getElementById("other")?.addEventListener("click", clicked);
    });
    const result = adapter().execute("leave");
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + 100);
    expect(await result).toBe("not_confirmed");
    expect(clicked).not.toHaveBeenCalled();
  });

  it("confirms leaving once the call is gone", async () => {
    load(FIXTURES.inCallEn);
    button(/leave call/i).addEventListener("click", () =>
      setTimeout(() => {
        document.body.innerHTML = "<main><p>You left the meeting</p></main>";
      }, 200),
    );
    const result = adapter().execute("leave");
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toBeNull();
  });
});

describe("participant tiles", () => {
  it("ignores the People panel's list items, which are not video tiles", () => {
    load(FIXTURES.inCallEn);
    const item = document.createElement("div");
    item.setAttribute("data-participant-id", "p9");
    item.setAttribute("role", "listitem");
    item.innerHTML = `<div jsname="QgSmzd" class="wEsLMd"></div><span class="notranslate">devices</span>`;
    document.body.prepend(item);
    const { state } = adapter().readState();
    expect(state.participants?.map((p) => p.display_name)).toEqual(["Alex Example", "Sam Example"]);
    expect(state.active_speaker).toEqual({ display_name: "Alex Example" });
  });

  it("never takes an icon for a name", () => {
    load(FIXTURES.inCallEn);
    const tile = document.querySelector("[data-participant-id='p1']");
    tile?.prepend(
      Object.assign(document.createElement("span"), {
        className: "google-symbols notranslate",
        textContent: "more_vert",
      }),
    );
    expect(adapter().readState().state.participants?.[0]).toEqual({ display_name: "Alex Example" });
  });

  it("finds the user's own tile by its control", () => {
    load(FIXTURES.inCallEn);
    expect(adapter().readState().state.self_participant).toBeUndefined();
    const own = document.querySelector("[data-participant-id='p2']");
    own?.append(Object.assign(document.createElement("div"), { innerHTML: "" }));
    own?.lastElementChild?.setAttribute("jsname", "Ac69Jc");
    expect(adapter().readState().state.self_participant).toEqual({ display_name: "Sam Example" });
  });
});

describe("others' raised hands", () => {
  // Synthetic, shaped like the probe's report (2026-11-04): Meet draws the hand as an icon in the
  // tile and, with two or more up, the place in line next to it.
  const tile = (id: string) => document.querySelector(`[data-participant-id='${id}']`);
  const raise = (id: string, place?: number) => {
    const badge = document.createElement("div");
    badge.className = "hand";
    badge.innerHTML = `<i class="google-material-icons notranslate" aria-hidden="true">front_hand</i>${
      place === undefined ? "" : `<div>${place}</div>`
    }`;
    tile(id)?.append(badge);
  };
  const lower = (id: string) => tile(id)?.querySelector(".hand")?.remove();
  const addTile = (id: string, name: string) => {
    const el = document.createElement("div");
    el.setAttribute("data-participant-id", id);
    el.setAttribute("jsname", "E2KThb");
    el.innerHTML = `<span class="notranslate">${name}</span>`;
    document.querySelector("[role=toolbar]")?.before(el);
  };

  it("leaves raised_hands out while no one else has a hand up", () => {
    load(FIXTURES.inCallEn);
    expect(adapter().readState().state.raised_hands).toBeUndefined();
  });

  it("shows the first in line by name, how many, and since when", () => {
    load(FIXTURES.inCallEn);
    raise("p2");
    const state = new MeetAdapter(document, SELECTORS, undefined, () => 1000).readState().state;
    expect(state.raised_hands).toEqual({
      first: { display_name: "Sam Example" },
      count: 1,
      since: 1000,
    });
    expect(state.participants?.map((p) => p.display_name)).toEqual(["Alex Example", "Sam Example"]);
  });

  it("follows Meet's place in line and leaves the user out", () => {
    load(FIXTURES.inCallEn);
    addTile("p3", "Kim Example");
    tile("p2")?.append(Object.assign(document.createElement("div"), { id: "own" }));
    document.getElementById("own")?.setAttribute("jsname", "Ac69Jc");
    raise("p1", 2);
    raise("p2", 1);
    raise("p3", 3);
    expect(adapter().readState().state.raised_hands).toMatchObject({
      first: { display_name: "Alex Example" },
      count: 2,
    });
  });

  it("without places, keeps the order hands went up in; since moves only with the first", () => {
    load(FIXTURES.inCallEn);
    let now = 1000;
    const meet = new MeetAdapter(document, SELECTORS, undefined, () => now);
    addTile("p3", "Kim Example");
    raise("p3");
    expect(meet.readState().state.raised_hands).toEqual({
      first: { display_name: "Kim Example" },
      count: 1,
      since: 1000,
    });
    now = 2000;
    raise("p1");
    expect(meet.readState().state.raised_hands).toEqual({
      first: { display_name: "Kim Example" },
      count: 2,
      since: 1000,
    });
    now = 3000;
    lower("p3");
    expect(meet.readState().state.raised_hands).toEqual({
      first: { display_name: "Alex Example" },
      count: 1,
      since: 3000,
    });
    lower("p1");
    expect(meet.readState().state.raised_hands).toBeUndefined();
  });

  it("counts a person once, and never sends a tile's id", () => {
    load(FIXTURES.inCallEn);
    addTile("p1", "Alex Example");
    const [main, second] = document.querySelectorAll("[data-participant-id='p1']");
    for (const el of [main, second]) {
      el?.insertAdjacentHTML("beforeend", `<i class="google-material-icons">front_hand</i>`);
    }
    const state = adapter().readState().state;
    expect(state.raised_hands?.count).toBe(1);
    expect(JSON.stringify(state)).not.toContain("p1");
  });
});

describe("participant photos (docs/adr/0007)", () => {
  // Synthetic: the URL stands in for a profile photo; the canvas is a fake, since jsdom has none.
  const PHOTO_URL = "https://lh3.googleusercontent.com/a/SYNTHETIC=s75-c-mo";
  const DATA = "data:image/webp;base64,UklGRg==";
  let drawn: { size: [number, number]; args: unknown[] }[];
  let tainted: boolean;

  const canvas = () => {
    const fake = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (...args: unknown[]) =>
          void drawn.push({ size: [fake.width, fake.height], args }),
      }),
      toDataURL: () => {
        if (tainted) throw new DOMException("tainted", "SecurityError");
        return DATA;
      },
    };
    return fake as unknown as HTMLCanvasElement;
  };
  const withPhotos = () => new MeetAdapter(document, SELECTORS, canvas);

  function photo(tile: string, src = PHOTO_URL, crossorigin = "use-credentials"): HTMLImageElement {
    const img = document.createElement("img");
    img.src = src;
    img.setAttribute("crossorigin", crossorigin);
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 75 });
    Object.defineProperty(img, "naturalHeight", { value: 75 });
    document.querySelector(`[data-participant-id='${tile}']`)?.append(img);
    return img;
  }

  beforeEach(() => {
    drawn = [];
    tainted = false;
    load(FIXTURES.inCallEn);
  });

  it("sends each tile's photo with its name, redrawn at 72 px", () => {
    photo("p1");
    const { state } = withPhotos().readState();
    expect(state.participants).toEqual([
      { display_name: "Alex Example", avatar: DATA },
      { display_name: "Sam Example" },
    ]);
    // Alex speaks: the same tile, the same photo.
    expect(state.active_speaker).toEqual({ display_name: "Alex Example", avatar: DATA });
    expect(drawn[0]?.size).toEqual([AVATAR_SIZE, AVATAR_SIZE]);
  });

  it("keeps a tile's last photo when the camera turns on and hides it", () => {
    const adapter = withPhotos();
    const img = photo("p1");
    adapter.readState();
    img.remove();
    expect(adapter.readState().state.participants?.[0]).toEqual({
      display_name: "Alex Example",
      avatar: DATA,
    });
  });

  it("reads a photo once, and forgets every photo after the call", () => {
    const adapter = withPhotos();
    photo("p1");
    adapter.readState();
    adapter.readState();
    expect(drawn).toHaveLength(1);
    // After the call (no Leave button), then a new call with no photo on screen.
    load(FIXTURES.lobby);
    adapter.readState();
    load(FIXTURES.inCallEn);
    expect(adapter.readState().state.participants?.[0]).toEqual({ display_name: "Alex Example" });
  });

  it("leaves the photo out when the page does not let it be read, and does not retry", () => {
    tainted = true;
    const adapter = withPhotos();
    photo("p1");
    expect(adapter.readState().state.participants?.[0]).toEqual({ display_name: "Alex Example" });
    const tries = drawn.length;
    adapter.readState();
    expect(drawn).toHaveLength(tries);
  });

  it("reads only profile photos: never another host, a blob or a frame", () => {
    photo("p1", "https://example.com/a.png");
    photo("p2", "blob:https://meet.google.com/1234");
    const { state } = withPhotos().readState();
    expect(state.participants).toEqual([
      { display_name: "Alex Example" },
      { display_name: "Sam Example" },
    ]);
    expect(drawn).toEqual([]);
  });

  it("never sends a URL", () => {
    photo("p1");
    photo("p2");
    expect(JSON.stringify(withPhotos().readState().state)).not.toContain("googleusercontent");
  });
});
