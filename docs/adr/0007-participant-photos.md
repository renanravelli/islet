# ADR 0007 — Participant photos from the page, without the network

- Status: Accepted
- Date: 2026-11-04

## Context

The island draws each participant as initials on a colored circle. The owner wants the photos
Meet shows instead. A photo is personal data, like a name, and Islet is local-first (CLAUDE.md,
principle 4): the extension makes no network requests and asks only for `nativeMessaging` and
`meet.google.com`, and the app's only network access is the updater (ADR 0006).

There were three ways to get a photo to the app:

- **The app downloads it** from the URL Meet uses. The app would contact Google with every
  participant's photo URL: a second network exception, about other people.
- **The extension downloads it.** A new host permission for `googleusercontent.com` and requests
  from the extension, both of which the project forbids.
- **The extension reads the image Meet already loaded.** No request and no permission, if the
  page lets a canvas read it: an image from another origin loaded without CORS "taints" the
  canvas, and `toDataURL` then throws.

A probe in a real call (`runCalibration("avatars")`, step 12 of
`docs/meet-adapter/calibration-session.md`; report in `docs/meet-adapter/reports/`, 2026-11-04)
answered it. Every photo Meet shows is tainted, but each video tile also holds a hidden 75×75
copy that Meet loads with `crossorigin="use-credentials"`, and a canvas reads it. With a camera
on, that tile has no photo.

## Decision

1. **The extension reads the photo from the page, and only there.** In a video tile it takes the
   image `selectors.json` names (the tile entry's `avatar`, today `img[crossorigin]`), only when
   it is loaded and comes from `https://*.googleusercontent.com` (a profile photo, never a video
   frame), draws it on a 48 px canvas and sends a WebP data URL, about 1–2 KB. A tainted canvas,
   a missing image or any error leaves the photo out. No request, no new permission.
2. **It remembers the last photo per tile** (`data-participant-id`) in the content script's
   memory, for the call: a person who turns the camera on keeps their photo. It reads a photo
   again only when its source changes.
3. **Protocol v1, an optional field.** `Participant` and `ActiveSpeaker` gain `avatar`, sent only
   for the people the island shows (up to three, the active speaker and the user). No new
   message type: a photo is resent with each update, a few KB over the local socket, well under
   the 64 KB limit.
4. **The core accepts only small images.** `data:image/(png|jpeg|webp);base64,` with base64
   text, at most 16 KB; anything else is dropped, so the island never loads a URL. `Debug`
   redacts it like a name.
5. **Photos are treated like names.** Memory only; never logged or written to disk; with "show
   names" off (now "Mostrar nomes e fotos") the core drops them with the names. A photo comes
   from the same tile as its name, or the island draws initials: never someone else's photo.
6. **Initials stay** as the fallback: before the first photo, without one, or when the page does
   not allow reading it.

## Consequences

- People see the faces Meet shows, with no new network access and no new permission.
- If Meet stops loading that copy with CORS, the island falls back to initials; the probe
  tells which. `selectors.json` keeps the image selector as data, like the rest (ADR 0004).
- `PRIVACY.md`, the READMEs, the app's privacy text and the Chrome Web Store's privacy form say
  that the extension reads participants' photos.
- Still to verify: that the 75 px image is the person's photo and not a placeholder, an account
  without a photo, 3+ people, and English.
