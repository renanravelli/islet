// Islet: capture an anonymized snapshot of a Google Meet call for selector calibration.
//
// Paste this into the DevTools console of a meet.google.com tab (context "top") while in a call;
// see docs/meet-adapter/calibration-session.md. It copies the page at once, then asks for the
// names to redact. Nothing is sent anywhere: after you review the summary in the console, it
// asks before saving a local .html file.
//
// It keeps only the parts calibration needs: control bars and call buttons, participant tiles,
// notices and the meeting title, each with its chain of parent elements but none of their
// other content. From those it removes:
// - every text node (except short numbers and a notice that matches selectors.json), the chat
//   panel, scripts,
//   styles, images, large SVGs, inline styles;
// - title, src, srcset, href, id and every attribute holding a URL (googleusercontent.com
//   included), event handlers and Google's tracking attributes (jslog, jsaction, jsdata);
// - every data-* attribute except those a selector uses; ID-like values of those are replaced
//   by stable placeholders (id-1, id-2...);
// - meeting codes, e-mail addresses and the names you type; free-text labels outside controls.
//
// It cannot know every name on the page. Review the summary and search the saved file for
// every participant's name before sharing it. The fixture sanitization test checks it again.

(() => {
  // Keep in sync with selectors.json; extension/test/capture.test.ts checks both lists.
  const SELECTOR_DATA_ATTRIBUTES = [
    "data-is-muted",
    "data-meeting-title",
    "data-participant-id",
    "data-participant-name",
    "data-self-name",
    "data-speaking",
  ];
  const NOTICE_PATTERNS = [
    "are you talking\\?.*(mic|microphone)",
    "(voc[êe] est[áa] falando|est[áa] falando)\\?.*microfone",
  ];

  const REGIONS = {
    controls: "[role='toolbar']",
    buttons: "button[aria-label], [role='button'][aria-label]",
    participants: "[data-participant-id], [data-self-name], [data-participant-name]",
    notices: "[role='alert'], [role='status'], [aria-live]",
    title: "[data-meeting-title]",
  };
  const CALL_BUTTON =
    /micro|c[âa]mera|camera|hand|m[ãa]o|leave|sair|everyone|todos|people|pessoas|participant/i;
  const CONTROL = "button, [role='button'], [role='switch'], [role='menuitem'], [role='tab']";
  const CHAT = /\b(chat|messages|mensagens|bate-papo)\b/i;
  const FREE_TEXT = new Set([
    "aria-label",
    "aria-description",
    "aria-roledescription",
    "aria-valuetext",
    "alt",
    "placeholder",
    "data-tooltip",
    "value",
  ]);
  const DROP = new Set([
    "title",
    "src",
    "srcset",
    "href",
    "style",
    "id",
    "action",
    "poster",
    "content",
    "jslog",
    "jsaction",
    "jsdata",
    "aria-labelledby",
    "aria-describedby",
    "aria-controls",
    "aria-owns",
  ]);
  const MEETING_CODE = /\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/gi;
  const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi;
  const URL_LIKE = /https?:|\/\/|googleusercontent\.com/i;
  const LARGE_SVG_PATH = 300;

  const notices = NOTICE_PATTERNS.map((pattern) => new RegExp(pattern, "i"));

  const removed = {};
  const count = (what, n = 1) => {
    if (n > 0) removed[what] = (removed[what] ?? 0) + n;
  };
  const replaceCounting = (value, pattern, replacement, what) =>
    value.replace(pattern, () => {
      count(what);
      return replacement;
    });
  const scrub = (value) => {
    let out = replaceCounting(value, MEETING_CODE, "[meeting-code]", "meeting codes");
    out = replaceCounting(out, EMAIL, "[email]", "e-mail addresses");
    for (const name of names) out = replaceCounting(out, name, "[name]", "typed names");
    return out;
  };
  const ids = new Map();
  const isIdLike = (value) =>
    value.length > 24 ||
    /[/=:]/.test(value) ||
    (value.length >= 8 && /\d/.test(value) && /[a-z]/i.test(value));
  const placeholder = (value) => {
    if (!ids.has(value)) ids.set(value, `id-${ids.size + 1}`);
    return ids.get(value);
  };
  const inChat = (el) => {
    const labelled = el.closest("[aria-label]");
    return (
      labelled !== null && !el.matches(CONTROL) && CHAT.test(labelled.getAttribute("aria-label"))
    );
  };

  // 1. Pick the regions to keep, in the live page.
  const kept = new Set();
  const regionCounts = {};
  for (const [region, css] of Object.entries(REGIONS)) {
    for (const el of document.body.querySelectorAll(css)) {
      if (region === "buttons" && !CALL_BUTTON.test(el.getAttribute("aria-label") ?? "")) continue;
      if (inChat(el)) continue;
      kept.add(el);
      regionCounts[region] = (regionCounts[region] ?? 0) + 1;
    }
  }
  const ancestors = new Set();
  for (const el of kept) {
    for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
      ancestors.add(up);
    }
  }

  // 2. Copy only those regions and the chain of elements above them.
  const copy = (node) => {
    const clone = node.cloneNode(false);
    for (const child of node.children) {
      if (kept.has(child)) clone.append(child.cloneNode(true));
      else if (ancestors.has(child)) clone.append(copy(child));
    }
    return clone;
  };
  const root = copy(document.body);
  count(
    "elements outside the kept regions",
    document.body.querySelectorAll("*").length - root.querySelectorAll("*").length,
  );

  // Asked only now: the page is already copied, so a short-lived notice cannot vanish meanwhile.
  const answer = prompt(
    "Islet snapshot: names to redact, comma separated (yours and every participant's).",
    "",
  );
  if (answer === null) return;
  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = answer
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((name) => new RegExp(escapeRegExp(name), "gi"));
  // 3. Sanitize what is left.
  const MEDIA =
    "script, style, link, iframe, img, picture, video, audio, canvas, noscript, template";
  for (const el of root.querySelectorAll(MEDIA)) {
    count(`<${el.localName}> elements`);
    el.remove();
  }
  for (const svg of root.querySelectorAll("svg")) {
    const paths = [...svg.querySelectorAll("path")];
    const size = paths.reduce((n, p) => n + (p.getAttribute("d") ?? "").length, 0);
    if (size > LARGE_SVG_PATH) {
      count("large <svg> icons");
      svg.replaceChildren();
    }
  }
  for (const el of root.querySelectorAll("[aria-label]")) {
    if (!el.matches(CONTROL) && CHAT.test(el.getAttribute("aria-label") ?? "")) {
      count("chat panels");
      el.replaceChildren(document.createComment(" chat panel removed "));
    }
  }

  const keptLabels = new Set();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const isControl = el.matches(CONTROL);
    for (const { name, value } of [...el.attributes]) {
      if (DROP.has(name) || name.startsWith("on")) {
        count(`${name} attributes`);
        el.removeAttribute(name);
      } else if (URL_LIKE.test(value)) {
        count("attributes holding a URL");
        el.removeAttribute(name);
      } else if (name.startsWith("data-") && !SELECTOR_DATA_ATTRIBUTES.includes(name)) {
        count("data-* attributes no selector uses");
        el.removeAttribute(name);
      } else if (name.startsWith("data-")) {
        if (isIdLike(value)) {
          count("ID-like data-* values");
          el.setAttribute(name, placeholder(value));
        } else if (/\s/.test(value)) {
          count("free-text data-* values");
          el.setAttribute(name, "[text]");
        } else {
          el.setAttribute(name, scrub(value));
        }
      } else if (FREE_TEXT.has(name)) {
        if (isControl && name !== "value") {
          const clean = scrub(value);
          el.setAttribute(name, clean);
          keptLabels.add(clean);
        } else {
          count("free-text labels outside controls");
          el.setAttribute(name, "[text]");
        }
      } else {
        el.setAttribute(name, scrub(value));
      }
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.nodeType === Node.COMMENT_NODE) {
      if (node.data !== " chat panel removed ") node.remove();
      continue;
    }
    if (!node.data.trim()) continue;
    // Short numbers (the participant count) are not personal and calibration needs them.
    if (/^\s*\d{1,3}\s*$/.test(node.data)) continue;
    const notice = node.parentElement?.closest(REGIONS.notices);
    if (notice && notices.some((re) => re.test(notice.textContent ?? ""))) {
      node.data = scrub(node.data);
    } else {
      count("text nodes");
      node.data = "[text]";
    }
  }

  // 4. Show what happened, then ask before saving.
  console.group("Islet snapshot: review before saving");
  console.log("Kept regions:", regionCounts);
  console.log("Removed or redacted:");
  console.table(removed);
  console.log("Labels kept on controls (check them for names):");
  console.table([...keptLabels].sort());
  console.groupEnd();

  if (!confirm("Islet: the summary is in the console. Save the snapshot?")) return;

  const header = [
    "<!-- Islet calibration snapshot. Anonymized by extension/scripts/capture-snapshot.js.",
    `     Captured: ${new Date().toISOString().slice(0, 10)}; page language: ${document.documentElement.lang || "?"}.`,
    "     Review for names before sharing. -->",
  ].join("\n");
  const html = `${header}\n${root.outerHTML}\n`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  link.download = `meet-snapshot-${Date.now()}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  console.log(`Islet: saved ${link.download}.`);
})();
