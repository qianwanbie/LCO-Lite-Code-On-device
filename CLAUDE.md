# CLAUDE.md

## Project: LCO (Lite Code On-device)

A lightweight Android IDE powered by Monaco Editor, Flutter WebView, and a pluggable backend engine architecture. Phase 2 connects to a Node.js backend running in Termux for real file I/O and PTY terminal.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Flutter App (Dart)                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  WebView (Monaco Editor)                                │ │
│  │  assets/index.html  ← HTTP localhost (AssetServer)       │ │
│  │  assets/js/editor.js, file-explorer.js, terminal.js      │ │
│  │  assets/css/lco.css                                     │ │
│  └────────────────┬────────────────────────────────────────┘ │
│                   │ JavaScriptChannel (LCOBridge)            │
│                   │ JSON-RPC 2.0                             │
│  ┌────────────────▼────────────────────────────────────────┐ │
│  │  lib/webview/js_bridge.dart — message routing            │ │
│  │  lib/protocol/json_rpc.dart — Request/Response models    │ │
│  └────────────────┬────────────────────────────────────────┘ │
│                   │                                          │
│  ┌────────────────▼────────────────────────────────────────┐ │
│  │  IDEEngine (abstract)                                    │ │
│  │  ├── MockEngine (Phase 1) — temp dir + seed files        │ │
│  │  └── TermuxEngine (Phase 2) — HTTP proxy to Node.js      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  lib/webview/asset_server.dart — local HTTP asset server      │
└──────────────────────────────────────────────────────────────┘
           │                                          │
           │  HTTP POST http://127.0.0.1:9876/api/rpc │
           │  WebSocket /ws/terminal                  │
           │  WebSocket /ws/file-events               │
           ▼                                          ▼
┌──────────────────────────────────────────────────────────────┐
│              Termux (Node.js backend)                         │
│  assets/server/node_backend.js                               │
│  ├── node-pty → bash PTY terminal                            │
│  ├── ws (WebSocket server)                                   │
│  ├── child_process (exec/spawn for runScript and fallback)    │
│  ├── fs.watch → file change events                           │
│  └── PROJECT_ROOT: /data/data/com.termux/files/home/lco-workspace/ │
└──────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

- **Backend abstraction**: All engine operations go through the `IDEEngine` abstract interface. `TermuxEngine` proxies RPC calls to the Node.js backend via HTTP POST, completely replacing MockEngine in Phase 2.
- **JSON-RPC 2.0**: The communication protocol between WebView JS and Flutter/Dart. Both `MockEngine` and `TermuxEngine` conform to the same request/response format.
- **Local HTTP asset server**: Android WebView blocks CORS and Web Workers on `file:///` pages (origin=`null`). A singleton `AssetServer` serves all assets via `http://127.0.0.1:PORT/`, giving the page a proper origin.
- **Offline-first Monaco**: Monaco Editor v0.55.1 bundled in `assets/monaco-editor/min/vs/`. CDN fallback only. xterm.js v5.5 also bundled locally in `assets/vendor/xterm/`.
- **PROJECT_ROOT**: `/data/data/com.termux/files/home/lco-workspace/` — the single canonical workspace directory. All file operations, terminal cwd, and file watching are anchored here.
- **node-pty PTY terminal**: Real interactive bash shell via node-pty (compiled natively for ARM64 in Termux). Falls back to `child_process.spawn` if node-pty unavailable.

## RPC Methods

| Method | Params | Description |
|---|---|---|
| `saveFile` | `{path, content}` | Atomic file write (temp→rename) |
| `readFile` | `{path}` | Read file content |
| `listFiles` | `{dirPath?}` | List directory contents |
| `runGitCommand` | `{args: []}` | Execute git command |
| `changeWorkspace` | `{subFolder}` | Switch workspace subfolder |
| `deleteFile` | `{path}` | Delete file or directory |
| `renameFile` | `{oldPath, newPath}` | Rename file or directory |
| `runScript` | `{path}` | Execute .py/.js/.sh/.dart |
| `pushFileChange` | (notification) | File change push notification |

## Build Configuration

| Component | Version |
|---|---|
| Flutter | 3.44.1 |
| Dart | 3.12.1 |
| Gradle | 8.14 (file://) |
| AGP | 8.11.1 |
| Kotlin | 2.2.20 |
| compileSdk | 36 |
| targetSdk | 36 |
| minSdk | 24 |
| NDK | 28.2.13676358 |
| Node.js (Termux) | 26.2.0 |
| Monaco Editor | 0.55.1 |
| node-pty | 1.1.0 |
| xterm.js | 5.5.0 |

## Directory Structure

```
LCO/
├── lib/
│   ├── main.dart                          # Entry point (TermuxEngine)
│   ├── engine/
│   │   ├── ide_engine.dart                # IDEEngine abstract interface
│   │   ├── mock_engine.dart               # MockEngine (Phase 1 dev)
│   │   └── termux_engine.dart             # TermuxEngine → HTTP proxy to backend
│   ├── protocol/
│   │   └── json_rpc.dart                  # JSON-RPC 2.0 models
│   ├── webview/
│   │   ├── asset_server.dart              # Singleton HTTP server
│   │   ├── editor_webview.dart            # WebView container + console listener
│   │   └── js_bridge.dart                 # JS ↔ engine message router
│   └── models/
│       └── file_model.dart                # FileInfo, FileTree
├── assets/
│   ├── index.html                         # Editor frontend + Monaco bootstrap
│   ├── config.json                        # UI theme/settings
│   ├── css/lco.css                        # Complete layout stylesheet
│   ├── js/
│   │   ├── editor.js                      # Monaco init + RPC adapter
│   │   ├── file-explorer.js               # Tree renderer + workspace mgmt
│   │   ├── terminal.js                    # xterm.js + WebSocket terminal
│   │   └── i18n.js                        # EN/ZH strings
│   ├── vendor/xterm/                      # xterm.js offline bundle
│   ├── monaco-editor/min/vs/              # Monaco Editor offline bundle
│   └── server/
│       └── node_backend.js                # Node.js backend
├── android/
├── test/
├── pubspec.yaml
├── CLAUDE.md
├── README.md
├── detail.md
└── requirements.txt
```

## Building & Running

```bash
# Flutter app
flutter pub get && flutter build apk --debug
adb install build/app/outputs/flutter-apk/app-debug.apk

# Backend (in Termux)
cd ~/LCO/assets/server
npm install ws node-pty
node node_backend.js --port=9876
termux-wake-lock
```

## Coding Conventions

- All engine implementations extend `IDEEngine` and depend only on the interface.
- JSON-RPC method names use camelCase.
- Error codes: `-32700` parse, `-32601` method, `-32602` params, `-32001` permission, `-32002` file not found, `-32603` internal.
- File paths use forward slashes, normalized by `JsBridge._normalizePath()`.
- `AssetServer` is a singleton.
- WebView console → Flutter `debugPrint` via `onConsoleMessage`.
