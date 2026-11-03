// Islet: one anonymized snapshot of a Google Meet call, by hand. Paste into the DevTools console
// of a meet.google.com tab, with the console context set to "Islet". Development builds only.
//
// It asks for the names to redact, prints a summary of everything it kept and removed, and asks
// before saving a local .html file; nothing is sent anywhere. The capture itself lives in the
// development build (extension/src/debug/snapshot.ts), shared with the calibration runner.
// For a full session, use calibration-runner.js instead.

(() => {
  const debug = globalThis.isletDebug;
  if (!debug?.captureSnapshot) {
    console.error(
      "Islet: isletDebug is not here. Load the development build (pnpm --filter @islet/extension build:dev) " +
        'and set the console context to "Islet", not "top".',
    );
    return;
  }
  debug.captureSnapshot();
})();
