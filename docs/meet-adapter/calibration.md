# Calibrating the Meet adapter

The adapter finds Meet's controls through `extension/src/content/meet/selectors.json`
([ADR 0004](../adr/0004-selectors-as-data.md)). Each key says whether it was confirmed in a real
call (`"verified"`) and in which Meet languages (`"verifiedIn"`); the others are educated
guesses, and the tests run against synthetic fixtures. This guide turns them into verified
selectors, and is also the fix procedure when Meet changes its interface.

The quickest way to gather everything is the **calibration runner**
([calibration-session.md](calibration-session.md)): it drives the Mac, captures every state and
writes a report. The sections below are the manual path and what to do with the results.

You need the **development** build of the extension
(`pnpm --filter @islet/extension build:dev`, loaded as in the
[install guide](../install-extension.md)): only it has `isletDebug`, and release builds fail
their check if it is there. You also need a Meet call with a second device or account, so there
is another participant and someone speaking. For a ready-made call script, see
[calibration-session.md](calibration-session.md).

## 1. Check the live page

1. Join the call. Open DevTools on the Meet tab (`⌥⌘I`).
2. In the Console, open the context menu at the top (it says `top`) and pick **Islet**. That is
   the extension's isolated world; the Meet page cannot see it.
3. Run:

   ```js
   isletDebug.readState()
   ```

   `state` is what the extension would send; `failed` lists the required keys it could not
   resolve or read. Compare it with what you see: mic, camera, hand, participant count, who is
   speaking, the title. `isletDebug.inCall()` tells whether the adapter thinks you are in a
   call, and `isletDebug.find("micButton")` (or any other key) returns the element a key
   resolves to; hover it in the Console to see it highlighted on the page.
4. Try each command and watch the page:

   ```js
   await isletDebug.execute("toggle_mic")   // null means confirmed
   await isletDebug.execute("toggle_cam")
   await isletDebug.execute("toggle_hand")
   ```

   `"not_confirmed"` means the click happened but the state change was not seen within 1.5 s;
   `"control_not_found"` means the selector found nothing. Leave `leave` for last.

## 2. Capture anonymized snapshots

For each state below, set it up in the call, then paste the contents of
`extension/scripts/capture-snapshot.js` into the Console (context **Islet**; it uses the
development build's capture, shared with the runner). It copies only the control bar and call
buttons, participant tiles, notices, the top bar (title and People button), whatever a selector
matches and the labels those point to. When asked, type your
name and every participant's name, comma separated. It then prints a summary of everything it
removed and asks before saving; nothing is sent.

| Snapshot          | Set up                                                  |
| ----------------- | ------------------------------------------------------- |
| `in-call-mic-on`  | mic on, camera off, hand down                           |
| `in-call-mic-off` | mic off, camera on, hand raised                         |
| `speaking`        | the other participant talking                           |
| `muted-speaking`  | you talking with the mic off, until Meet shows a notice |
| `lobby`           | the pre-join screen                                     |

Do it twice: with Meet in English and in Português (Brasil). Meet follows your Google
Account's language; switch it there and reload the Meet tab.

**Review every file before using or sharing it.** The script removes text (except short numbers
and a recognized notice), the chat panel, images, URLs, IDs, data attributes no selector uses,
meeting codes, e-mails and the names you typed, but it cannot know every name. Search each file
for every participant's name. The Console lists every label it kept on controls.

List the real names in `extension/test/.private-names.txt` (git-ignored, one per line). The
"fixtures are sanitized" test fails if any fixture contains one of them, an e-mail, a
`googleusercontent.com` URL or a meeting code; it also runs in CI, without the names.

## 3. Add them as fixtures

Rename each file to `extension/test/fixtures/meet-real-<snapshot>.<locale>.html` (for example
`meet-real-in-call-mic-off.pt-BR.html`) and write, next to it, a
`meet-real-<snapshot>.<locale>.expected.json` with what the page showed:

```json
{
  "inCall": true,
  "self": { "mic": "off", "cam": "on", "hand": "on" },
  "participant_count": 2,
  "speaking": false,
  "speaking_while_muted": false
}
```

Every field except `inCall` is optional. Then run:

```sh
pnpm --filter @islet/extension test
```

`test/real-snapshots.test.ts` checks every real snapshot against its expectations.

## 4. Fix the selectors

Edit `selectors.json` until the real snapshots pass:

- Each key has ordered `strategies`: `css`, `ariaLabel` (a regex per locale, optionally limited
  by `css`), `labelledBy` (elements matched by `css` whose `aria-labelledby` target text matches
  a regex per locale), `text` (a regex on the text of elements matched by `css`) or
  `attribute`. The first one that finds an element wins, so put the most specific first and
  keep a fallback. Google's `jsname` values are stable for a while but can change; keep a
  label-based fallback next to them.
- `participantCount` can say where the number is inside the element (`count`), and
  `activeSpeaker` where the name is inside the tile (`name`).
- Toggles also have `state` rules: an attribute with its `on` and `off` values, or `ariaLabel`
  regexes for each state. Remember that Meet labels the _action_: "Turn off microphone" means
  the mic is on.
- Regexes are case-insensitive. Anchor them (`^leave call`) and allow both locales.
- Never point a selector at the chat or at free text other than the call controls, the speaker
  tile, the participant count, the title and the "are you talking?" notice.
- `required: true` keys mark the session degraded when missing during a call.

When a key is confirmed in real snapshots, set `"verified": true`, list the languages in
`"verifiedIn"` (for example `["pt-BR"]` until the English round is done), update `updated` and
increase `version`. A test rejects `verified` without `verifiedIn`. Keep the synthetic
fixtures: they cover edge cases.

## 5. Confirm in a call

Load the rebuilt extension (`pnpm --filter @islet/extension build`, then reload it in
`chrome://extensions`), repeat step 1, and go through the Meet section of
`docs/testing/manual-checklist.md`.

<!-- TODO: docs/testing/manual-checklist.md is written in Phase 6. -->

## When Meet changes its interface

Users see the island's degraded indicator, and Settings → Integrações → "Saúde do adaptador"
lists the failing selector keys. Capture snapshots of the affected state, add them as fixtures
with expectations, fix the keys and open a pull request.
