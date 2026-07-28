# Achievement Nexus Closed Beta tester guide

## Requirements

- Windows 10 or Windows 11, 64-bit.
- Microsoft Edge WebView2 Runtime.
- Internet access for Steam synchronization.
- A public Steam profile and public Game details.
- A SteamID64 and Steam Web API key.

## Install

1. Download the installer and its SHA-256 file from the beta coordinator.
2. Verify the checksum.
3. Run the installer. The build is unsigned, so Windows may identify it as coming from an Unknown Publisher.
4. Do not bypass a warning unless the filename and checksum match the coordinator's release.

## Steam setup

Obtain a Steam Web API key from Steam's official developer key page. Enter it only in Achievement Nexus. Never send the key in a bug report, screenshot, log, or chat message.

In Steam privacy settings, make **My profile** and **Game details** public so the application can read the library and achievement progress.

## First steps

1. Complete the First Launch Experience.
2. Choose a language and theme.
3. Connect the Steam profile.
4. Run Library Sync, followed by Achievement Sync.
5. Explore Library, Game Details, Achievement Journey, and Statistics.
6. Exit and reopen the application to verify local data persists. The API key should not persist.

## What to test

- Installation, first launch, restart, reinstall, and uninstall.
- Steam connection and meaningful error messages.
- Library and achievement synchronization without duplicates.
- Missing artwork, unsupported games, partial data, search, filters, and sorting.
- English/Arabic, Dark/Light/System, keyboard-only use, and Reduced Motion.

## Bug reports

Use the channel supplied by the Closed Beta coordinator and include:

- Achievement Nexus version.
- Windows edition and version.
- Exact reproduction steps.
- Expected result.
- Actual result.
- Screenshot when useful.
- Relevant logs only after removing personal or sensitive data.

Never include the Steam Web API key.

