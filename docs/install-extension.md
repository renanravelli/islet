# Install the Islet extension

Islet reads your Google Meet call through a small Chrome extension. Most people add it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/lbhmocnfnfmbiplpkllkacnbcjfcmlop); the listing is unlisted, so it opens from that link and from Islet's
setup guide, not from the store's search. You can also load it yourself with Chrome's **Load
unpacked**, which takes about two minutes.

The extension only has access to `meet.google.com`. It never reads the chat, never records
audio or video and makes no network requests; it only talks to the Islet app on your Mac.

## Before you start

- macOS 13 or later and **Google Chrome**. Chrome Beta, Dev, Canary and other Chromium browsers
  are not supported in v0.1.
- The Islet app, or a development checkout of this repository.

## From the Chrome Web Store (recommended)

1. Open the [Islet page on the Chrome Web Store](https://chromewebstore.google.com/detail/lbhmocnfnfmbiplpkllkacnbcjfcmlop), or click **Instalar extensão** in
   step 2 of Islet's setup guide, which opens it in Chrome.
2. Click **Add to Chrome**.
3. Go to [Connect it to the app](#connect-it-to-the-app). Chrome updates the extension on its
   own.

## Load it by hand

### 1. Get the extension folder

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

### 2. Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder from step 1.
4. Check that the card says **Islet** and the ID is `dhfbcfjjnccdblcpemefndebjeannaam`.

## Connect it to the app

- **With the app:** open Islet. Step 2 of the first-run guide installs the Chrome bridge and
  waits for the extension. You can also use Settings → Integrações → **Reinstalar ponte do
  Chrome**.
- **From source:** run `scripts/install-native-host.sh`, then start the app.

Right after it is installed or updated, the extension tests the connection, and the guide
shows **Conectada**. If the extension was already installed, click **Abrir o Meet para testar**
in the guide, or open any `meet.google.com` tab: the extension connects while one is open. The
island appears once you join a call, not in the lobby.

## Update or remove

- **Update:** from the Chrome Web Store, Chrome updates it on its own. Loaded by hand, replace
  the folder's contents with the new version, then click the reload icon on the Islet card in
  `chrome://extensions`.
- **Remove:** click **Remove** on the card. The app keeps working without it, but shows no calls.

## Troubleshooting

To see the extension's own messages, open `chrome://extensions`, find Islet and click
**service worker**. The console that opens is where the errors below appear.

**The guide keeps waiting for the extension.**

- Click **Abrir o Meet para testar**, or open a `meet.google.com` tab yourself: an extension
  installed earlier connects only while one exists.
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
