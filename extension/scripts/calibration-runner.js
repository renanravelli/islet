// Islet calibration runner. Paste into the DevTools console of a meet.google.com tab, with the
// console context set to "Islet" (the extension's isolated world). Development builds only:
// `pnpm --filter @islet/extension build:dev`. See docs/meet-adapter/calibration-session.md.
//
// The runner itself lives in the development build (extension/src/debug/), so it is typed,
// tested and absent from release builds. This file only checks the build and starts it.
//
// Pasting it starts nothing. Then run:
//   runCalibration()          the whole session (from the lobby, or from the call)
//   runCalibration("short")   who speaks, the muted notice and leaving as the host
//   runCalibration("lobby")   only the pre-join snapshot
//   runCalibration("left")    only the after-leaving snapshot, if leaving reloaded the page
//   runCalibration("<step>")  redo one step; isletDebug.steps lists them
//   isletContinue()           end the current wait when the page shows it but Islet cannot see it

(() => {
  const debug = globalThis.isletDebug;
  if (!debug?.runCalibration) {
    console.error(
      "Islet: isletDebug is not here. Load the development build (pnpm --filter @islet/extension build:dev) " +
        'and set the console context to "Islet", not "top".',
    );
    return;
  }
  globalThis.runCalibration = (entry) => debug.runCalibration(entry);
  globalThis.isletContinue = () => debug.continue();
  console.info(`Islet: calibration runner ready (selectors v${debug.selectorsVersion}).`);
  console.info(
    'Islet: run runCalibration() for the whole session, or runCalibration("short") for the short one.',
  );
})();
