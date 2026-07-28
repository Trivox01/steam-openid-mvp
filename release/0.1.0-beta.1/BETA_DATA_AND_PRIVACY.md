# Closed Beta data and privacy

Achievement Nexus 0.1.0-beta.1 is a local-first Closed Beta application.

## Steam credentials

- The Steam Web API key is kept only in the running Rust process memory.
- The key is sent directly to the official Steam Web API when a Steam request is made.
- Achievement Nexus has no application backend and does not forward the key to a private application server.
- The key is not stored in SQLite, preferences, logs, release files, or the installer.
- Exiting the application clears the in-memory key. A future sync session requires the key again.
- The application never asks for a Steam password.

## Local data

Game, achievement, activity, profile, and preference data is stored in SQLite under:

`%APPDATA%\com.achievementnexus.app\achievement-nexus.db`

The exact Windows profile prefix varies by user. Achievement Nexus does not provide cloud synchronization or an Achievement Nexus account.

## Deleting data

The current Settings deletion control is a confirmation preview and does not delete the database. To remove local beta data manually:

1. Exit Achievement Nexus.
2. Optionally copy the database file as a backup.
3. Delete `%APPDATA%\com.achievementnexus.app\achievement-nexus.db`.

Do not delete the containing folder while the application is running.

## Uninstall behavior

The Windows uninstaller removes installed program files. It is not configured to delete the AppData database automatically, so local data is expected to remain available after reinstalling. Delete the database manually only when you intentionally want to remove all local Achievement Nexus data.

Backups are the tester's responsibility in this beta. There is no cloud backup or recovery service.

