# LCO — Lite Code On-device

A lightweight Android IDE that brings Monaco Editor to mobile. Write, edit, and manage code projects on your Android tablet with a real PTY terminal backend.

## Features

- **Monaco Editor** — VS Code kernel with 30+ language syntax highlighting, IntelliSense
- **File Explorer** — Tree view, click-to-open, right-click Git/Delete/Rename/Run
- **Integrated Terminal** — Real PTY bash via node-pty + xterm.js
- **Workspace Management** — New/Switch projects, unified `lco-workspace` root
- **Git Integration** — Status, log, add, clone with auto-refresh
- **i18n** — EN/ZH toggle
- **Offline-First** — Monaco + xterm.js bundled locally, CDN fallback

## Tech Stack

| Layer | Technology |
|---|---|
| UI | Flutter 3.44.1 / Dart 3.12.1 |
| Editor | Monaco Editor 0.55.1 |
| Terminal | xterm.js 5.5 + node-pty 1.1 (ARM64 native) |
| Backend | Node.js 26.2 in Termux |
| Protocol | JSON-RPC 2.0 + WebSocket |

## Quick Start

### Prerequisites
- Flutter SDK 3.x, Android SDK 36
- Android device (API 24+, ARM64)
- Termux with Node.js

### Build & Install
```bash
cd LCO
flutter pub get
flutter build apk --debug
adb install build/app/outputs/flutter-apk/app-debug.apk
```

### Backend (Termux)
```bash
cd ~/LCO/assets/server
pkg install clang make python binutils -y
npm install ws node-pty
node node_backend.js --port=9876
termux-wake-lock
```

### Workspace
```
/data/data/com.termux/files/home/lco-workspace/
├── src/
│   ├── main.dart
│   └── utils.dart
├── pubspec.yaml
├── README.md
└── .gitignore
```

## Architecture

```
Flutter App ←→ WebView (Monaco + xterm.js)
    │ LCOBridge (JSON-RPC)
    ▼
TermuxEngine (HTTP POST /api/rpc)
    │
    ▼
Node.js Backend (Termux)
├── PTY Terminal (bash)
├── File I/O (read/save/list/delete/rename)
├── Git (exec)
├── Script Runner (.py/.js/.sh/.dart)
└── File Watcher (fs.watch)
```

## License

MIT
