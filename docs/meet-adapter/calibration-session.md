# Calibration session

One calibration call, about 20 minutes, in **Português (Brasil)**. It produces the snapshots,
readings and report that [calibration.md](calibration.md) turns into verified selectors. The
English round is pending: until it is done, keys are verified for pt-BR only.

You need a Mac with Chrome and an iPhone signed in to a second Google account (the Meet app or
Safari). The **calibration runner** does everything on the Mac and asks you only for what is
physical: joining from the iPhone, talking, raising a hand. Its steps are data in
`extension/src/debug/steps.ts`; this page describes the same steps, and a test fails if the two
diverge.

## Before the call

1. Build the **development** extension, which has `isletDebug` and the runner (release builds
   do not):

   ```sh
   pnpm install
   pnpm --filter @islet/extension build:dev
   ```

   Load or reload `extension/dist` in `chrome://extensions` ([install guide](../install-extension.md)).
2. Create `extension/test/.private-names.txt` (git-ignored) with one name per line: yours, the
   iPhone account's and anyone else who may appear. The fixture test uses it to catch leaks.
3. Set your Google Account language to Português (Brasil). Meet follows it.
4. **Downloads:** the runner saves about 25 files. On the first ones, Chrome asks whether
   meet.google.com may **download multiple files**: allow it. You can take the permission back
   afterwards in `chrome://settings/content/automaticDownloads`.

## Run the session

1. On the Mac, open `meet.new` and stop at the pre-join screen.
2. Open DevTools (`⌥⌘I`) → Console, and set the context menu at the top (it says `top`) to
   **Islet**, the extension's isolated world.
3. Paste the whole `extension/scripts/calibration-runner.js` and press Enter, then run
   `runCalibration()`. It asks once for the names to redact (the same as in
   `.private-names.txt`), and detects the language from the page.
4. Follow the console. It shows **one instruction at a time**, prefixed `Islet ▸`, and waits
   until it sees the result on the page. Nothing is drawn on the page itself, so nothing extra
   ends up in the snapshots.
   - If the page shows what was asked but the runner does not move on (a selector cannot see
     it yet), run `isletContinue()`.
   - If nothing happens, it gives up after the step's timeout and moves on. Both cases are in
     the report.
5. Leaving may reload the page, which stops the runner. If it does, paste the runner again and
   run `runCalibration("left")` on the page shown after leaving.

Other entries, after pasting the runner once: `runCalibration("short")` (see
[Short session](#short-session)), `runCalibration("lobby")` on a pre-join screen,
when the session started inside a call; `runCalibration("<step>")` to redo one step
(`isletDebug.steps` lists them).

**What it saves** (each snapshot goes through the same anonymization as the manual capture,
with its summary printed in the console):

- per captured step: `meet-real-<step>.<locale>.html`, `.expected.json` (what the step expects)
  and `.observed.json` (what the adapter read, with names, the title and the meeting code
  replaced);
- `calibration-report.<locale>.json` before leaving and `calibration-report.<locale>.after-leave.json`
  at the end (or `calibration-report.<locale>.<step>.json` for a single entry): expected against
  observed per step, failed keys, where each key resolved (tag, role, jsname and the data-*
  attributes selectors use; no text), every command with its result and time, waits and
  measurements.

## The steps

### 1. Lobby

- **Snapshot:** `meet-real-lobby.<locale>.html`, only when the session starts on the pre-join
  screen.
- **Expected:** `{"inCall":false}`

### 2. Both in the call

- **You:** "Join the call on the Mac." Then the runner sets mic on, camera off, hand down, and
  asks: "Join from the iPhone with the meeting code, then admit it on the Mac."
- **It waits for:** the participant count to read 2.
- **Snapshot:** `meet-real-in-call-mic-on.<locale>.html`
- **Expected:** `{"inCall":true,"self":{"mic":"on","cam":"off","hand":"off"},"participant_count":2}`

### 3. Mic off, camera on, hand raised

- **The runner** turns the mic off, the camera on and raises your hand through
  `isletDebug.execute`, and confirms each with `readState`. If it cannot read a state or the
  command does not get there, it asks you to set it by hand.
- **Snapshot:** `meet-real-in-call-mic-off.<locale>.html`
- **Expected:** `{"inCall":true,"self":{"mic":"off","cam":"on","hand":"on"},"participant_count":2}`

### 4. Commands through Islet

- **The runner** toggles the mic, the camera and the hand once more through `execute`, back to
  mic on, camera off, hand down, and records each result and how long the confirmation took.
- **No snapshot.** Watch the iPhone: the changes should show there too.

### 5. The iPhone raises its hand

- **You:** "On the iPhone: mute, turn the camera on and raise the hand."
- **It waits for:** a "raised a hand" label or notice on the page (a heuristic, also reported).
- **Snapshot:** `meet-real-remote-hand.<locale>.html`. Your own state must not change: the
  iPhone's hand must not show up as yours.
- **Expected:** `{"inCall":true,"self":{"mic":"on","cam":"off","hand":"off"},"participant_count":2}`
- **Then:** "Lower the iPhone's hand."

### 6. Nobody talks

- **The runner** mutes the Mac. **You:** "Mute the iPhone. Nobody talks for the next 10 s."
- **Snapshot:** `meet-real-silence.<locale>.html`, then it samples the active speaker for 10 s:
  it should find nobody.
- **Expected:** `{"inCall":true,"self":{"mic":"off","cam":"off","hand":"off"},"speaking":false}`

### 7. The Mac talks

- **The runner** turns the Mac's mic on. Then **you:**
  "On the Mac, keep talking with the mic on until the runner moves on. The iPhone stays muted."
- **It waits for:** an active speaker, captures, then samples it for 10 s. The report gives the
  position of the speaking tile (no name), to compare with step 8.
- **Snapshot:** `meet-real-speaking-mac.<locale>.html`
- **Expected:** `{"inCall":true,"self":{"mic":"on","cam":"off","hand":"off"},"speaking":true}`

### 8. The iPhone talks

- **The runner** mutes the Mac and says "Stop talking on the Mac." for 5 s, so the Mac's speaking
  indicator settles. Then **you:** "Unmute the iPhone and keep talking until the runner moves on."
- **It waits for:** an active speaker, captures, then samples it every 0.5 s for 10 s (how often
  it is present, how often it changes, which tile; counts and positions only, no names).
- **Snapshot:** `meet-real-speaking.<locale>.html`
- **Expected:** `{"inCall":true,"self":{"mic":"off","cam":"off","hand":"off"},"speaking":true}`

### 9. Talking with the mic off

- **The runner** mutes the Mac and says "Mute the iPhone." Then **you:**
  "On the Mac, keep talking with the mic off until Meet shows its notice."
- **It waits for:** `speaking_while_muted`, then captures at once, while the notice shows, and
  measures how long it stays on screen. While waiting it also records the text of every live
  notice that mentions the mic or talking (names replaced), so the notice can be calibrated
  even if its current pattern is wrong.
- **Snapshot:** `meet-real-muted-speaking.<locale>.html`
- **Expected:** `{"inCall":true,"self":{"mic":"off","cam":"off","hand":"off"},"speaking_while_muted":true}`

### 10. Leave

- **The runner** clicks Leave through `execute`. When Meet asks the host whether to leave or end
  the call for everyone, the adapter picks **Sair da chamada**; it never ends the call for
  everyone. The runner records the dialog's button labels. If a dialog it does not recognize
  stays open, it asks you to answer it by hand.
- **Then:** "On the iPhone, check that the call goes on without the Mac."
- **No snapshot.** The report is saved just before this step, in case leaving reloads the page.

### 11. After leaving

- **Snapshot:** `meet-real-left.<locale>.html`, on the page shown after leaving.
- **Expected:** `{"inCall":false}`

## Short session

To check only who speaks, the muted notice and leaving as the host, start a call from the Mac
(`meet.new`), paste the runner and run `runCalibration("short")` instead of `runCalibration()`.
It runs steps 2 and 6 to 11, asks for the names once and saves its reports as
`calibration-report.<locale>.short.json` and `calibration-report.<locale>.short.after-leave.json`.
You must be the meeting's host for step 10 to show the leave dialog.

## Manual alternative

If the runner cannot be used, do the steps yourself:

1. Follow the steps above by hand: set the Mac's state in Meet, ask the iPhone to do its part.
2. For each snapshot, paste `extension/scripts/capture-snapshot.js` into the Console (context
   **Islet**). It asks for the names, prints the same summary and asks before saving.
3. Rename the file as the step says, and write the step's **Expected** JSON next to it as
   `meet-real-<step>.<locale>.expected.json`.
4. Check the adapter yourself with `isletDebug.readState()`, `isletDebug.find("<key>")` and
   `await isletDebug.execute("toggle_mic")` (and the other actions), and write the results in a
   `calibration-notes.md` outside the repository.

## Before sending

1. Copy the `.html`, `.expected.json` and `.observed.json` files into `extension/test/fixtures/`.
2. Run `pnpm --filter @islet/extension test`. The **fixtures are sanitized** suite must pass: it
   fails on e-mails, `googleusercontent.com` URLs, meeting codes and any name in
   `.private-names.txt`. The **real Meet snapshots** suite may fail; that is what calibration
   fixes.
3. Open each file and search for every name once more.
4. Send the files and the `calibration-report.*.json` files.
5. Rebuild the release extension afterwards (`pnpm --filter @islet/extension build`).
