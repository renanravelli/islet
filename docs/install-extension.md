# Install the Islet extension

Islet reads your Google Meet call through a small Chrome extension. Until it is published on
the Chrome Web Store, you load it yourself with Chrome's **Load unpacked**. This takes about two
minutes.

The extension only has access to `meet.google.com`. It never reads the chat, never records
audio or video and makes no network requests; it only talks to the Islet app on your Mac.

## Before you start

- macOS 13 or later and **Google Chrome**. Chrome Beta, Dev, Canary and other Chromium browsers
  are not supported in v0.1.
- The Islet app, or a development checkout of this repository.

## 1. Get the extension folder

Pick **one** of the two ways below. Most people want the first.

**From a release (recommended).**
Download `islet-extension-<version>.zip` from
[GitHub Releases](https://github.com/renanravelli/islet/releases) and unzip it. The folder is
ready to load: there is nothing to build or install, so go straight to step 2. Keep the folder
somewhere permanent, such as `~/Applications/Islet Extension`: Chrome loads the extension from
it every time it starts.

**From source (for development).** In a clone of this repository, not in the unzipped release
folder:

```sh
pnpm install
pnpm --filter @islet/extension build
```

The folder is `extension/dist`.

## 2. Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder from step 1.
4. Check that the card says **Islet** and the ID is `dhfbcfjjnccdblcpemefndebjeannaam`.

## 3. Connect it to the app

- **With the app:** open Islet. Step 2 of the first-run guide installs the Chrome bridge and
  waits for the extension. You can also use Settings → Integrações → **Reinstalar ponte do
  Chrome**.
- **From source:** run `scripts/install-native-host.sh`, then start the app.

Open any `meet.google.com` tab. The guide shows **Conectada** as soon as the extension says
hello. The island appears once you join a call, not in the lobby.

## Update or remove

- **Update:** replace the folder's contents with the new version, then click the reload icon on
  the Islet card in `chrome://extensions`.
- **Remove:** click **Remove** on the card. The app keeps working without it, but shows no calls.

## Troubleshooting

To see the extension's own messages, open `chrome://extensions`, find Islet and click
**service worker**. The console that opens is where the errors below appear.

**The guide keeps waiting for the extension.**

- Make sure a `meet.google.com` tab is open: the extension connects only while one exists.
- Reload the Meet tab after loading or updating the extension.
- Check that the extension is enabled and that its ID is `dhfbcfjjnccdblcpemefndebjeannaam`
  (loaded from a release or from source) or `lbhmocnfnfmbiplpkllkacnbcjfcmlop` (from the Chrome
  Web Store). A different ID means it is not an official build: the host accepts only these.

**"Specified native messaging host not found."**
The Chrome bridge is not installed. In Islet, use **Reinstalar ponte do Chrome**; from source,
run `scripts/install-native-host.sh`. The bridge file is
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/io.github.renanravelli.islet.json`,
and its `path` must point to a file that exists. Moving the app (for example to
`/Applications`) changes that path; Islet repairs it on its next start.

**"Access to the specified native messaging host is forbidden."**
The extension's ID is not in the bridge's `allowed_origins`. Load the official build (see the
ID above), then reinstall the bridge.

**"Native host has exited."**
The bridge started and stopped. Its log explains why:
`~/Library/Logs/io.github.renanravelli.islet/native-host.<date>.log` (Settings → Privacidade e
sobre → **Abrir pasta**).

**The extension is connected but the island shows nothing.**
The island appears only during a call. If it shows a small amber dot, the extension could not
read part of the page, usually because Meet changed its interface; see
[calibration](meet-adapter/calibration.md) and the "Meet UI changed" issue template.

**Several Chrome profiles.** Load the extension in each profile you use for meetings. The bridge
is installed once per macOS user and serves every profile.

**Still stuck?** Open an issue and paste the result of Settings → Integrações → **Copiar
diagnóstico**. It contains no names, titles or meeting codes.
