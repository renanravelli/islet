// Islet: capture an anonymized snapshot of a Google Meet call for selector calibration.
//
// Paste this into the DevTools console of a meet.google.com tab while in a call (see
// docs/meet-adapter/calibration.md). It saves a local .html file; nothing is sent anywhere.
//
// What it removes or redacts:
// - every text node, the page title, URLs, images, scripts, styles, iframes, form values;
// - the chat panel, whole;
// - meeting codes, e-mail addresses and the names you type when asked;
// - free-text attributes (aria-label, title, alt, tooltip...) everywhere except on controls
//   (buttons, switches, menu items), where the label is what calibration needs. Names you typed
//   are still removed from those labels.
//
// It cannot know every name on the page. ALWAYS review the file before sharing it: search it
// for your name and every participant's name. The console prints every label it kept.

(() => {
  const answer = prompt(
    "Islet snapshot: names to redact, comma separated (yours and every participant's).",
    "",
  );
  if (answer === null) return;
  const names = answer
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 1)
    .sort((a, b) => b.length - a.length);

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePatterns = names.map((name) => new RegExp(escapeRegExp(name), "gi"));
  const MEETING_CODE = /\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/gi;
  const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi;

  const scrub = (value) => {
    let out = value.replace(MEETING_CODE, "xxx-xxxx-xxx").replace(EMAIL, "[email]");
    for (const pattern of namePatterns) out = out.replace(pattern, "[name]");
    return out;
  };

  const FREE_TEXT = new Set([
    "aria-label",
    "aria-description",
    "aria-roledescription",
    "aria-valuetext",
    "title",
    "alt",
    "placeholder",
    "data-tooltip",
    "data-tooltip-label",
    "value",
  ]);
  const DROP = new Set(["src", "srcset", "href", "style", "action", "poster", "content"]);
  const CONTROL = "button, [role='button'], [role='switch'], [role='menuitem'], [role='tab']";
  const CHAT = /\b(chat|messages|mensagens|bate-papo)\b/i;

  const root = document.body.cloneNode(true);

  for (const el of root.querySelectorAll(
    "script, style, link, iframe, img, video, audio, canvas, noscript, template",
  )) {
    el.remove();
  }

  // The chat panel goes whole, before anything else is looked at.
  for (const el of root.querySelectorAll("[aria-label]")) {
    if (!el.matches(CONTROL) && CHAT.test(el.getAttribute("aria-label") ?? "")) {
      el.replaceChildren(document.createComment(" chat panel removed "));
    }
  }

  const keptLabels = new Set();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const isControl = el.matches(CONTROL);
    for (const { name, value } of Array.from(el.attributes)) {
      if (DROP.has(name) || name.startsWith("on")) {
        el.removeAttribute(name);
      } else if (FREE_TEXT.has(name)) {
        if (isControl && name !== "value") {
          const clean = scrub(value);
          el.setAttribute(name, clean);
          keptLabels.add(clean);
        } else {
          el.setAttribute(name, "[text]");
        }
      } else if (name.startsWith("data-") && /\s/.test(value)) {
        // Free text in a data attribute, which could be a name.
        el.setAttribute(name, "[text]");
      } else {
        el.setAttribute(name, scrub(value));
      }
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const node of texts) {
    if (node.nodeType === Node.COMMENT_NODE) {
      if (node.data !== " chat panel removed ") node.remove();
    } else if (node.data.trim()) {
      node.data = "[text]";
    }
  }

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

  console.log(`Islet: saved ${link.download}. Labels kept on controls (check them for names):`);
  console.table([...keptLabels].sort());
})();
