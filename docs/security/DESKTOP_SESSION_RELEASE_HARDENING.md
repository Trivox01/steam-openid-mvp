# Desktop session release hardening

These independent Public Beta gates are implemented in the release-hardening
working tree and must pass the full validation gate before commit.

## Ambiguous refresh recovery

The former timing was unsafe as a protocol contract: the desktop transport may wait
15 seconds, while replaying a rotated predecessor is idempotent for only 8
seconds. A later caller can therefore reuse the predecessor after the server has
rotated it but before the replacement reached secure storage.

The implemented fix uses a persisted, random refresh-operation id bound to the
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

Migration 018 adds only `refresh_operation_hash` and
`refresh_operation_expires_at` to the predecessor. The recovery window is ten
minutes. The raw operation id remains in the versioned Windows Credential
Manager record beside the predecessor credential, is sent only to the refresh
route, and is cleared only after the replacement credential is persisted.

## Single application instance

The application uses the official `tauri-plugin-single-instance` v2 plugin. It
is applied to the Tauri builder before opener, notification, updater, setup, or
any managed application state. Its callback reuses `show_main_window` to
unminimize, show, focus, and emit the existing visibility event. The rejected
second process therefore cannot reach setup, Credential Manager access, Steam
discovery, or frontend boot initialization.

Official reference: https://v2.tauri.app/plugin/single-instance/
