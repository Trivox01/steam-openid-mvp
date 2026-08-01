# Updater signing runbook

Generate the updater key pair only on a trusted maintainer machine with the official Tauri CLI:

```powershell
npm run tauri -- signer generate --write-keys <outside-repository-path>
```

Use a strong password entered interactively. Do not paste the private key or password into an issue, commit, application setting, Render, or a local `.env` file in this repository.

Configure the protected GitHub `beta-release` environment with:

- secret `TAURI_SIGNING_PRIVATE_KEY`: encrypted private key contents;
- secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: key password;
- variable `TAURI_UPDATER_PUBLIC_KEY`: public key contents.

The workflow fails before dependency/build/release work if any value is absent. The runner creates `src-tauri/tauri.release.conf.json` containing only the public key and HTTPS endpoint; the file is ignored by Git. The application never receives the private key.

`Windows Beta Draft` is manual and creates a **Draft prerelease** only. It does not publish the GitHub release or update the Beta channel manifest. Publishing and promoting `latest.json` require a separate explicit maintainer action after two-version acceptance and all security gates pass.
