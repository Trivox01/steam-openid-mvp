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

## Public R2 Beta channel

The protected `beta-release` environment also requires these secrets:

- `R2_RELEASES_ACCESS_KEY_ID`
- `R2_RELEASES_SECRET_ACCESS_KEY`

And these non-secret environment variables:

- `R2_RELEASES_ENDPOINT`
- `R2_RELEASES_REGION`
- `R2_RELEASES_BUCKET`
- `R2_RELEASES_PUBLIC_BASE_URL`
- `TAURI_UPDATER_ENDPOINT`

Use the existing R2 bucket with a write credential restricted to the `releases/beta/` prefix when the provider policy supports prefix scoping. Do not reuse the badges/tools prefix. Public reads should expose only the release prefix through a trusted HTTPS custom domain, with directory listing disabled.

The workflow uploads immutable, versioned Windows files under `releases/beta/windows-x86_64/<version>/`, verifies each upload, and writes `releases/beta/latest.json` last with `no-cache`. GitHub remains the private Draft release manager; the Desktop receives no GitHub or R2 credential.
