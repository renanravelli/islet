# Calibrating the Meet adapter

The adapter finds Meet's controls through `extension/src/content/meet/selectors.json`
([ADR 0004](../adr/0004-selectors-as-data.md)). **No entry has been checked against a real call
yet**: they are educated guesses, every one is marked `"verified": false`, and the tests run
against synthetic fixtures. This guide turns them into verified selectors, and is also the fix
procedure when Meet changes its interface.

You need the extension loaded ([install guide](../install-extension.md)), a Meet call, and,
ideally, a second device or account in the call so there is another participant and someone
speaking.

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
   speaking, the title.
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
`extension/scripts/capture-snapshot.js` into the Console (context `top`). When asked, type your
name and every participant's name, comma separated. The file downloads; nothing is sent.

| Snapshot          | Set up                                                  |
| ----------------- | ------------------------------------------------------- |
| `in-call-mic-on`  | mic on, camera off, hand down                           |
| `in-call-mic-off` | mic off, camera on, hand raised                         |
| `speaking`        | the other participant talking                           |
| `muted-speaking`  | you talking with the mic off, until Meet shows a notice |
| `lobby`           | the pre-join screen                                     |

Do it twice: with Meet in English and in Português (Brasil). Meet follows your Google
Account's language; switch it there and reload the Meet tab.

**Review every file before using or sharing it.** The script removes text, the chat panel,
meeting codes, e-mails and the names you typed, but it cannot know every name. Search each file
for every participant's name. The Console lists every label it kept on controls.

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
  by `css`), `text` (a regex on the text of elements matched by `css`) or `attribute`. The first
  one that finds an element wins, so put the most specific first and keep a fallback.
- Toggles also have `state` rules: an attribute with its `on` and `off` values, or `ariaLabel`
  regexes for each state. Remember that Meet labels the _action_: "Turn off microphone" means
  the mic is on.
- Regexes are case-insensitive. Anchor them (`^leave call`) and allow both locales.
- Never point a selector at the chat or at free text other than the call controls, the speaker
  tile, the participant count, the title and the "are you talking?" notice.
- `required: true` keys mark the session degraded when missing during a call.

When a key is confirmed in real snapshots in both languages, set `"verified": true`, update
`updated` and increase `version`. Keep the synthetic fixtures: they cover edge cases.

## 5. Confirm in a call

Load the rebuilt extension (`pnpm --filter @islet/extension build`, then reload it in
`chrome://extensions`), repeat step 1, and go through the Meet section of
`docs/testing/manual-checklist.md`.

<!-- TODO: docs/testing/manual-checklist.md is written in Phase 6. -->

## When Meet changes its interface

Users see the island's degraded indicator, and Settings → Integrações → "Saúde do adaptador"
lists the failing selector keys. Capture snapshots of the affected state, add them as fixtures
with expectations, fix the keys and open a pull request.
