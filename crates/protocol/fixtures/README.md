# Protocol fixtures

Canonical JSON for every bridge message. They are the compatibility contract between the
extension and the app: `crates/protocol/tests/fixtures.rs` checks that each one decodes and
re-encodes to the same JSON, and the extension tests use them too.

All data here is synthetic. Do not paste real meeting codes, titles or names.

When a field is added, add it to a fixture. Never change an existing fixture in a way an older
peer could not read; that needs a new protocol version.
