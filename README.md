# CyberLab Terminal

CyberLab Terminal is a focused Expo app for connecting to the live terminal at `terminal.vitallity.org` from iPhone with a terminal-first interface and OTA-friendly UI updates.

## Current direction

- Expo / React Native app for personal use
- Shares CyberLab branding and iconography
- Designed around reconnect behavior, command snippets, and better mobile terminal controls

## Planned features

- WebView-backed terminal client using the live terminal site
- Resume-aware reconnect flow
- Accessory key row for `Esc`, `Tab`, `Ctrl`, arrows, and paste
- Screenshot picker that stages the image to local cache, uploads it to `tmpfiles.org`, and types a download command into the active terminal session
- Saved command snippets
- Theme, font size, and layout settings
- OTA updates for UI and terminal client logic through EAS Update

## Development

```bash
npm start
```

## OTA updates

EAS Update is configured for the Expo project
`@rushingtechnologies/cyberlab-terminal`. Release builds use the app version as
their runtime version and the `production` channel. On app launch, a release
build downloads the latest compatible update in the background and applies it
on the next restart.

Validate the local update configuration before publishing:

```bash
npm run validate:ota
```

Publish to a preview build first:

```bash
npm run ota:preview -- --message "Describe the update"
```

After testing, publish the same commit to production:

```bash
npm run ota:production -- --message "Describe the update"
```

The Codemagic `ota-update` workflow also publishes JS-only commits pushed to
`main` directly to the production channel. It skips changes to dependencies,
Expo/build configuration, and native projects because those changes require a
new binary. When native code or Expo config changes, bump the matching version
in both `app.json` and `package.json`, then create and install a new release
build before publishing updates for the new runtime.

To verify an update on a release build, launch the app once so it can download
the update, then fully close and reopen it. Expo Go cannot load updates that use
a runtime version.

## Terminal relay server (Railway)

The app's WebView points at `https://terminal.vitallity.org`, which is the relay
server in [server/terminal-relay-server.ts](server/terminal-relay-server.ts)
running on Railway (project `Terminal-Relay`, service `terminal-relay`).

That service uses Railway's serverless `function-bun` image, so there is no git
build step. The server code is shipped to the container as a single base64
environment variable (`SERVER_B64`) and decoded + executed at boot by the service
start command.

To change the relay, edit `server/terminal-relay-server.ts` and redeploy with:

```bash
RAILWAY_TOKEN=<railway-token> ./server/deploy-relay.sh
```

Do **not** hand-edit `SERVER_B64` in the Railway dashboard, and never split it
into `PART1`/`PART2`/... chunks — that is what previously corrupted the deploy and
took the site down. Always change the source file and re-run the script, which
re-encodes from source and verifies a byte-for-byte base64 round-trip before
shipping.

## iOS

Bundle identifier is currently set to `com.cyberlabterminal.app`. Adjust if needed before first App Store Connect registration.

## Codemagic

This repo includes [codemagic.yaml](codemagic.yaml) with:

- `validate` for config and TypeScript checks
- `ota-update` for EAS Update publishes to the `production` branch
- `ios-testflight` for Expo prebuild, code signing, IPA export, and TestFlight submission

Codemagic environment groups expected by the workflow:

- `expo_credentials`
  - `EXPO_TOKEN`
- `ios_credentials`
  - `APP_STORE_CONNECT_PRIVATE_KEY`
  - `APP_STORE_CONNECT_KEY_IDENTIFIER`
  - `APP_STORE_CONNECT_ISSUER_ID`

The repository-side Codemagic config is ready, but the repo still needs to be imported in the Codemagic web UI under the `Rushing Technologies` team before builds can trigger there.

## App Store Connect

The Apple bundle ID exists for this app:

- `com.cyberlabterminal.app`

One manual Apple step still remains: create the `CyberLab Terminal` app record in the App Store Connect web UI with:

- Name: `CyberLab Terminal`
- Bundle ID: `com.cyberlabterminal.app`
- SKU: `com.cyberlabterminal.app`
- Primary language: `English (U.S.)`

The API key used here can read and manage existing resources, but the App Store Connect API rejected `CREATE` on the `apps` resource, so that app record must be created from the web UI before TestFlight submission can succeed.
