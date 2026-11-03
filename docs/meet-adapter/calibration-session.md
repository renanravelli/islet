# Calibration session: script

A step-by-step for one calibration call, about 30 minutes. It produces the snapshots and notes
that [calibration.md](calibration.md) turns into verified selectors. You need a Mac with Chrome
and an iPhone signed in to a second Google account (the Meet app or Safari).

## Before the call

1. Build the **development** extension, which exposes `isletDebug` (release builds do not):

   ```sh
   pnpm install
   pnpm --filter @islet/extension build:dev
   ```

   Load or reload `extension/dist` in `chrome://extensions` ([install guide](../install-extension.md)).
2. Create `extension/test/.private-names.txt` (git-ignored) with one name per line: yours, the
   iPhone account's and anyone else who may appear. The fixture test uses it to catch leaks.
3. Set your Google Account language to **Português (Brasil)** for the first round.
4. Keep `extension/scripts/capture-snapshot.js` open, ready to copy.
5. Start a notes file, `calibration-notes.md`, outside the repository.

**How to capture**, at every step that asks for one:

1. On the Meet tab, open DevTools (`⌥⌘I`) → Console, context **top**.
2. Paste the whole `capture-snapshot.js` and press Enter. It copies the page at once.
3. Type the names to redact (the same as in `.private-names.txt`), comma separated.
4. Read the summary in the console, then confirm to save the file.
5. Rename the file as the step says: `meet-real-<step>.<locale>.html`, with locale `pt-BR` in
   the first round and `en` in the second.
6. Next to it, write `meet-real-<step>.<locale>.expected.json` with what the page showed (the
   step gives it).

**How to check**, at every step that says `isletDebug`: switch the Console context to **Islet**
and run the command. `isletDebug.find("<key>")` returns the element a key resolves to;
hovering it in the Console highlights it on the page.

## Round 1: Português (Brasil)

### 1. Lobby

On the Mac, open `meet.new` and stop at the pre-join screen.

- **Capture:** `lobby`. Expected: `{ "inCall": false }`.
- **Check:** `isletDebug.inCall()` is `false`.

### 2. Both in the call

Join on the Mac with the **mic on and the camera off**. Join from the iPhone with the meeting
code and admit it.

- **Capture:** `in-call-mic-on`. Expected:
  `{ "inCall": true, "self": { "mic": "on", "cam": "off", "hand": "off" }, "participant_count": 2 }`.
- **Check:** `isletDebug.readState()`: `state.self` matches, `participant_count` is 2,
  `failed` is `[]`. `isletDebug.find("micButton")`, `"camButton"`, `"handButton"` and
  `"leaveButton"` each highlight the right button.
- **Note:** anything in `failed`, and which button each `find` highlighted.

### 3. Toggle on the Mac, by hand

On the Mac's Meet page: mic off, camera on, raise your hand.

- **Capture:** `in-call-mic-off`. Expected:
  `{ "inCall": true, "self": { "mic": "off", "cam": "on", "hand": "on" }, "participant_count": 2 }`.
- **Check:** `isletDebug.readState().state.self` matches.

### 4. Toggle on the Mac, through Islet

In the Islet console context, one at a time, watching the page and the iPhone:

```js
await isletDebug.execute("toggle_mic"); // null = confirmed
await isletDebug.execute("toggle_cam");
await isletDebug.execute("toggle_hand");
```

- **No capture.**
- **Check:** each returns `null` and the change shows on the Mac and on the iPhone; the state is
  back to mic on, camera off, hand down.
- **Note:** each result (`null`, `"not_confirmed"` or `"control_not_found"`), and anything that
  happened on the page (a tooltip, a dialog, a delay).

### 5. Toggle on the iPhone

On the iPhone: mute, turn the camera on, raise the hand. Leave the Mac as it is.

- **Capture:** `remote-hand`. Expected:
  `{ "inCall": true, "self": { "mic": "on", "cam": "off", "hand": "off" }, "participant_count": 2 }`.
- **Check:** `state.self` is still the Mac's own state. The iPhone's hand must not show up as
  yours.
- Lower the iPhone's hand afterwards.

### 6. Talk with the mic off

On the Mac, mute and keep talking until Meet shows its "are you talking?" notice. Paste the
capture script while the notice is on screen.

- **Capture:** `muted-speaking`. Expected:
  `{ "inCall": true, "self": { "mic": "off", "cam": "off", "hand": "off" }, "speaking_while_muted": true }`.
- **Check:** while the notice shows, `isletDebug.readState().state.signals.speaking_while_muted`
  is `true`; after it goes away, `false`.
- **Note:** the notice's exact text and roughly how long it stayed. The capture keeps the text
  only if the current pattern already matches.
- If no notice appears after about 20 s of talking, note that and move on.

### 7. The iPhone talks

Keep the Mac muted. Unmute the iPhone and keep talking (or play audio near it) for 20 s.

- **Capture:** `speaking`, while it talks. Expected:
  `{ "inCall": true, "self": { "mic": "off", "cam": "off", "hand": "off" }, "speaking": true }`.
- **Check:** `isletDebug.readState().state.active_speaker` holds the iPhone account's name, and
  `isletDebug.find("activeSpeaker")` highlights its tile. Run it a few times: does it stay
  stable, flicker, or never show?
- **Note:** how Meet shows who is speaking (a ring, an outline, an icon), and whether the Mac's
  own tile ever shows as speaking.

### 8. Leave

```js
await isletDebug.execute("leave");
```

- **Check:** it returns `null` and you are out of the call. If Meet asks something first (for
  example whether to end the call for everyone), note the dialog and its buttons and answer it
  by hand.
- **Capture:** `left`, on the page shown after leaving. Expected: `{ "inCall": false }`.

## Round 2: English

Switch your Google Account language to **English**, reload, and repeat steps 1 to 8 with a new
`meet.new` meeting and the locale `en` in every file name.

## Before sending

1. Copy the `.html` and `.expected.json` files into `extension/test/fixtures/`.
2. Run `pnpm --filter @islet/extension test`. The **fixtures are sanitized** suite must pass: it
   fails on e-mails, `googleusercontent.com` URLs, meeting codes and any name in
   `.private-names.txt`. The **real Meet snapshots** suite may fail; that is what calibration
   fixes.
3. Open each file and search for every name once more.
4. Send the files and `calibration-notes.md`, and say which Chrome version you used.
5. Rebuild the release extension afterwards (`pnpm --filter @islet/extension build`).
