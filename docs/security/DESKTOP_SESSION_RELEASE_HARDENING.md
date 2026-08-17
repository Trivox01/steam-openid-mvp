# Desktop session release hardening

These are independent Public Beta gates. Neither issue caused the most recent
silent-restore run, which contained one refresh followed by an explicit Change
Account logout.

## Ambiguous refresh recovery

Current timing is unsafe as a protocol contract: the desktop transport may wait
15 seconds, while replaying a rotated predecessor is idempotent for only 8
seconds. A later caller can therefore reuse the predecessor after the server has
rotated it but before the replacement reached secure storage.

The recommended fix is a persisted, random refresh-operation id bound to the
rotation. The desktop writes that id beside its credential before sending the
request. PostgreSQL stores only its hash on the predecessor. A retry with the
same predecessor and operation id reconstructs the same deterministic child
credential for a bounded recovery lifetime; a different or missing id remains
reuse and revokes the family.

This is preferable to merely widening the general replay grace because it does
not make every stolen predecessor acceptable for the longer network window. It
also works across backend processes and restarts because the binding is in
PostgreSQL and replacement credentials are deterministic. The recovery lifetime
must remain bounded, and successful persistence of the replacement must clear
the pending operation locally.

This change requires a separately reviewed migration, request-contract update,
Credential Manager value-versioning, process-restart tests, multi-instance
backend tests, lost-response tests, and negative tests for a wrong operation id.
It is intentionally not implemented in the silent-restore verification work.

## Single application instance

The current Tauri application does not register a single-instance guard. Before
Public Beta, add the official `tauri-plugin-single-instance` desktop dependency
and register it before every other plugin, as required by the Tauri v2 plugin
documentation. Its callback should reuse `show_main_window`, restore/unminimize
the main window, focus it, and emit the existing visibility event. The rejected
second process must not reach setup, Credential Manager access, or frontend boot
initialization.

Expected files are `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
`src-tauri/src/lib.rs`, and `src-tauri/tests/plugin_registration.rs`. Tests must
cover registration ordering, a negative control without the plugin, a second
launch focusing the existing window, tray-hidden behavior, and proof that only
one process enters session initialization.

Official reference: https://v2.tauri.app/plugin/single-instance/
