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
- Screenshot picker that uploads to a temporary file host and types a download command into the active terminal session
- Saved command snippets
- Theme, font size, and layout settings
- OTA updates for UI and terminal client logic through EAS Update

## Development

```bash
npm start
```

## iOS

Bundle identifier is currently set to `com.cyberlabterminal.app`. Adjust if needed before first App Store Connect registration.

## Codemagic

This repo includes [codemagic.yaml](/home/Nitehawk/Desktop/cyberlab-terminal/codemagic.yaml) with:

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
