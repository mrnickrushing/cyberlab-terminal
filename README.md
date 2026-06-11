# CyberLab Terminal

CyberLab Terminal is a focused Expo app for connecting to the CyberLab terminal relay from iPhone with a terminal-first interface and OTA-friendly UI updates.

## Current direction

- Expo / React Native app for personal use
- Shares CyberLab branding and iconography
- Intended to connect to the existing Railway-hosted terminal relay
- Designed around reconnect behavior, command snippets, and better mobile terminal controls

## Planned features

- WebView-backed terminal client
- Resume-aware relay reconnect flow
- Accessory key row for `Esc`, `Tab`, `Ctrl`, arrows, and paste
- Saved command snippets
- Theme, font size, and layout settings
- OTA updates for UI and terminal client logic through EAS Update

## Development

```bash
npm start
```

## iOS

Bundle identifier is currently set to `com.cyberlabterminal.app`. Adjust if needed before first App Store Connect registration.
