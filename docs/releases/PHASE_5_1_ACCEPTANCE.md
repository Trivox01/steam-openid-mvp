# Phase 5.1 acceptance record

Date: 2026-08-01  
Version: `0.1.0-beta.1`  
Channel: Beta only  
Decision: **NO-GO for public Beta distribution**

## Completed locally

- `release/version.json` is the source of truth and matches npm, Cargo, and Tauri.
- SemVer, channel, and exact `v<version>` tag validation are automated.
- NSIS is the selected per-user Windows installer; upgrades are designed to leave the application data directory untouched.
- The release workflow is manual, protected by concurrency, creates Draft prereleases, and refuses to run without updater signing material.
- Update checks from automatic startup, Settings, and System Tray use one coordinator with a ten-second check timeout, no concurrent operation, and downgrade rejection.
- Download and installation require an explicit user action. Progress, retry-safe errors, bilingual text, RTL, reduced motion, and forced colors are covered.
- About shows version/channel and supports check, What's New, and copyable diagnostics without account data.
- What's New state is local and account-independent.

## Automated evidence

- Desktop TypeScript and production Vite build: PASS.
- Backend TypeScript: PASS.
- Release metadata, secret filename scan, update architecture, themes, microcopy, native UX, Smart Library, Game Details, Tools, CSP, navigation, onboarding, Developer Center, badges, artwork, Smart Sync: PASS.
- `cargo check`: PASS.
- `cargo test`: PASS, 22 tests.
- Backend unit suite: 124 PASS; PostgreSQL integration could not connect from the restricted local runner (`EACCES`). No staging write was attempted as a workaround.
- `git diff --check`: PASS before each commit.

## Required before GO

- Generate the official Tauri updater key pair on a trusted maintainer machine; configure the protected GitHub environment secrets and public-key variable. No key was fabricated or logged during this work.
- Execute the Draft workflow and verify the signed NSIS artifact, `.sig`, updater manifest, SHA-256 file, filenames, and clean-machine install/uninstall/upgrade behavior.
- Perform the required two-version test from build A `0.2.0-beta.1` to build B `0.2.0-beta.2`, including downloaded bytes, signature acceptance, SQLite/settings preservation, restart, decline/later, offline, timeout, corrupt manifest, wrong signature, and downgrade rejection.
- Test Windows 10 and 11, standard user and admin, Arabic/English, Light/Dark/System, RTL, narrow window, DPI, keyboard, screen reader, and Tray update action inside packaged Tauri builds.
- Record GitHub repository visibility and Windows Authenticode status. Without a trusted code-signing certificate, `Unknown Publisher` remains a NO-GO for broad public distribution.
- Complete the Phase 5.0 security gate: rotate the exposed PostgreSQL staging credential, update Render `DATABASE_URL`, redeploy, verify health, prove the old credential is rejected, and scan Git history/logs. If this cannot be completed, close or disable the Tools surface before Beta.
- Publish neither the Draft Release nor the Beta channel manifest without an explicit maintainer order.

This record deliberately does not claim manual acceptance, signing, credential rotation, or public publication that was not performed.
