# Meet DOM fixtures

**Every fixture here is synthetic.** They are hand-written to exercise the adapter against the
strategies in `src/content/meet/selectors.json`. None was captured from Google Meet, so passing
tests prove the adapter logic, not that the selectors match the real Meet. All names, titles and
messages are made up.

Real, anonymized snapshots replace them after calibration (`docs/meet-adapter/calibration.md`).
Name those `meet-real-<what>.<locale>.html` and keep the synthetic ones for edge cases.
