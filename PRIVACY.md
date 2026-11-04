# Privacy policy

_Effective 2026-11-03. Applies to the Islet app for macOS and the Islet extension for Google
Chrome._

Islet runs entirely on your Mac. It has no servers, no accounts and no analytics, and neither
the app nor the extension makes network connections. Nobody, including the Islet developers,
receives any data about you or your calls.

## What the extension reads

The extension runs only on `https://meet.google.com/*`. While you are in a call, it reads from
the Meet page:

- the state of Meet's controls: microphone, camera, raised hand and leave;
- the names Meet shows on the participant tiles, and who is speaking;
- the participant count and the meeting title;
- Meet's "are you talking?" notice, when you speak while muted.

It never reads the chat, never records or captures audio, video or the screen, and never reads
other tabs or other sites. It presses Meet's buttons only when you use a control in the Islet
app.

## Where that data goes

The extension sends what it reads to the Islet app on the same Mac, through Chrome's native
messaging, and nowhere else. The app keeps it in memory only while the call lasts, to draw the
island, and discards it when the call ends. Names, titles and meeting codes are never written to
disk. With **Show participant names** off in Settings, the app does not display them at all.

## What is stored on your Mac

- **Settings**, in `~/Library/Application Support/io.github.renanravelli.islet/settings.json`:
  language, island behavior and whether the setup guide was completed. No call data.
- **Logs**, in `~/Library/Logs/io.github.renanravelli.islet/`: technical events such as
  connections and errors, without names, titles or meeting codes. They rotate daily, and only
  the last 7 files are kept.
- **The Chrome bridge registration**, in
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/io.github.renanravelli.islet.json`.

Uninstalling the app and removing the extension, then deleting these folders, removes
everything Islet stored.

## Sharing

Islet does not sell, share or transfer data to anyone, does not use it for advertising or
credit decisions, and uses it for nothing but showing your call in the island.

## Changes and contact

Changes to this policy are published in this file, in the
[repository](https://github.com/renanravelli/islet). For questions, open an issue at
<https://github.com/renanravelli/islet/issues>.
