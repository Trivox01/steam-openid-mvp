# Phase 5.1 release policy

`release/version.json` is the release source of truth. Run `npm run release:validate` in every release build and use `npm run release:set-version -- <semver>` for an intentional bump. A release tag must be exactly `v<version>`.

Only the Beta channel is active. Development, staging, and stable are reserved and must remain disabled until separately accepted. Update checks never authorize installation: the user must explicitly choose to download and install each version.

Windows releases use an NSIS per-user installer. Upgrades must preserve the application data directory, including SQLite data and user preferences. Uninstall behavior must be verified manually before a public Beta.

Updater signing and Windows Authenticode signing are separate controls. The updater public key is embedded into the release build; the encrypted private key and its password belong only in GitHub Actions secrets. No test key, private key, password, certificate, or PFX file may be committed. Without a trusted Windows code-signing certificate, Windows may display `Unknown Publisher`; that is a NO-GO for broad public distribution.

Phase 5.0 remains a security gate: rotate any exposed staging database credential, redeploy Render with the new `DATABASE_URL`, verify health and rejection of the old credential, and confirm secrets are absent from Git history and logs. Do not publish a Beta until this gate is documented as complete.
