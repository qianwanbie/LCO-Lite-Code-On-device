# LCO — Lite Code On-device (v1.0.0)

[![LCO v1.0.0 Release](https://img.shields.io/badge/Download-LCO_v1.0.0_APK-blue?logo=android)](https://github.com/qianwanbie/LCO-Lite-Code-On-device/releases/tag/v1.0.0)

**LCO is a code IDE for Android.** It combines a Monaco Editor, terminal emulator, file manager, and Git client into a single app. Claude Code can run in the terminal for AI-assisted coding. All editor components are bundled offline — no network needed to start coding.

> **[Download lco-v1.0.0.apk](https://github.com/qianwanbie/LCO-Lite-Code-On-device/releases/tag/v1.0.0)**
> `sha256: 91bcf0da9e8ccdd0f9f909048d32fe41aac1732c54aea3bf325a0cf29074aa77`

## Features

- **Monaco Editor** — Full VS Code editing experience with syntax highlighting for 30+ languages, IntelliSense, and multi-language support
- **Integrated Terminal** — Multi-tab PTY bash terminal via node-pty, with virtual keyboard bar for Ctrl/Alt/arrows
- **File Explorer** — Tree view with click-to-open, right-click Git/Delete/Rename/Run, workspace management (new/switch/home)
- **Web Preview** — Embedded iframe panel for localhost dev server preview
- **Claude CLI** — Run `claude` directly in the terminal for AI-assisted coding
- **LLM Chat Adapter** — JSON-RPC chat with DeepSeek/Anthropic/OpenAI APIs (configurable via llm_config.json)
- **Dark/Light Mode** — Theme toggle with CSS variable system
- **One-Click Setup** — Deployment Center auto-installs Git, Python, Claude CLI, and more in Termux
- **i18n** — English/Chinese language toggle
- **Offline-First** — Monaco Editor and xterm.js bundled locally, no CDN dependency
- **Multi-Tab Terminal** — Create, switch, and close independent terminal sessions, each with its own PTY process

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Flutter App (APK)                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  WebView (http://127.0.0.1:PORT/)                   │  │
│  │  ┌──────────┬──────────────────┬────────────────┐  │  │
│  │  │ File     │  Monaco Editor   │  Web Preview   │  │  │
│  │  │ Explorer │                  │  Panel         │  │  │
│  │  ├──────────┴──────────────────┴────────────────┤  │  │
│  │  │  Terminal (xterm.js, multi-tab)              │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └──────────────────┬───────────────────────────────┘  │
│                     │ LCOBridge (JSON-RPC 2.0)          │
│  ┌──────────────────▼───────────────────────────────┐  │
│  │  JSBridge → TermuxEngine (HTTP POST /api/rpc)     │  │
│  │  AssetServer (HTTP singleton, random port)        │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
           │ HTTP /api/rpc          │ WebSocket /ws/terminal
           │                        │ WebSocket /ws/file-events
           ▼                        ▼
┌─────────────────────────────────────────────────────────┐
│              Node.js Backend (Termux, port 9876)         │
│  ├── HTTP /api/rpc — 14 JSON-RPC methods                │
│  ├── WebSocket /ws/terminal — node-pty bash PTY          │
│  ├── WebSocket /ws/file-events — fs.watch push           │
│  ├── LLM Adapter — anthropic/deepseek/openai/claude-cli  │
│  └── PROJECT_ROOT: ~/lco-workspace/                      │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | Flutter 3.44.1 / Dart 3.12.1 |
| Editor | Monaco Editor 0.55.1 (bundled) |
| Terminal | xterm.js 5.5.0 (bundled) + node-pty 1.1.0 (ARM64 native) |
| WebView | webview_flutter 4.13.1 |
| Backend | Node.js 26.2.0 in Termux |
| Protocol | JSON-RPC 2.0 + WebSocket |
| LLM | DeepSeek/Anthropic/OpenAI API (configurable) |

## Project Structure

```
LCO/
├── lib/                          # Dart (Flutter) source
│   ├── main.dart                 # App entry: immersive fullscreen, TermuxEngine
│   ├── engine/
│   │   ├── ide_engine.dart       # Abstract interface (11 async methods)
│   │   ├── termux_engine.dart    # HTTP proxy to Node.js backend (UTF-8)
│   │   └── mock_engine.dart      # Phase 1 dev engine (temp dir + seed files)
│   ├── protocol/
│   │   └── json_rpc.dart         # JsonRpcRequest/Response/Error, FileChangeEvent
│   ├── webview/
│   │   ├── asset_server.dart     # Singleton HTTP server (solves CORS/Worker)
│   │   ├── editor_webview.dart   # WebView container + LCOBridge + console
│   │   └── js_bridge.dart        # JSON-RPC routing + path normalization
│   └── models/
│       └── file_model.dart       # FileInfo, FileTree, FileType
├── assets/                       # WebView frontend
│   ├── index.html                # Main page: layout + Monaco/xterm bootstrap
│   ├── config.json               # UI theme + locale settings
│   ├── css/
│   │   └── lco.css               # Complete layout stylesheet
│   ├── js/
│   │   ├── editor.js             # Monaco init + RPC adapter + auto-save
│   │   ├── file-explorer.js      # File tree + workspace management
│   │   ├── terminal.js           # xterm.js + WebSocket + multi-tab
│   │   ├── preview.js            # Web preview panel
│   │   ├── ui.js                 # Settings, theme, locale, keyboard
│   │   └── i18n.js               # EN/ZH strings
│   ├── vendor/xterm/             # xterm.js 5.5 offline bundle
│   ├── monaco-editor/min/vs/     # Monaco 0.55.1 offline bundle
│   └── server/
│       └── node_backend.js       # Node.js backend (all RPC + WS + LLM)
├── android/                      # Android platform (Gradle, Manifest)
├── test/
│   └── engine/
│       └── mock_engine_test.dart # 6 unit tests
├── pubspec.yaml                  # Flutter dependencies + asset declarations
├── README.md
└── docs/
    └── superpowers/plans/        # Implementation plans
```

## Getting Started

### Prerequisites

- **Flutter SDK** 3.x (Dart 3.12+)
- **Android SDK** 36 (API 36, build-tools 35+)
- **Android device/emulator** (API 24+, ARM64)
- **Termux** (F-Droid, latest) on the device

### Build & Install Flutter App

```bash
cd LCO
flutter pub get
flutter build apk --debug
adb install build/app/outputs/flutter-apk/app-debug.apk
```

### Setup Backend (one-time in Termux)

```bash
# Install build tools + Node.js
pkg install clang make python binutils nodejs -y

# Create project directory and copy backend
mkdir -p ~/LCO/assets/server
# (copy assets/server/node_backend.js to ~/LCO/assets/server/)

# Install Node.js dependencies
cd ~/LCO/assets/server
npm install ws
npm install node-pty  # May need: export CC=clang CXX=clang++
```

### Start Backend (every reboot)

```bash
cd ~/LCO/assets/server
bash -c 'source ~/.bashrc && exec node node_backend.js --port=9876'
termux-wake-lock  # Keep alive when screen off
```

### Configure LLM API Key

Add to `~/.bashrc` in Termux:

```bash
export ANTHROPIC_API_KEY="sk-your-key-here"
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
```

### Create llm_config.json (in workspace)

```json
{
  "provider": "anthropic",
  "endpoint": "https://api.deepseek.com/anthropic",
  "apiKey": "env:ANTHROPIC_API_KEY",
  "model": "deepseek-chat"
}
```

### Monorepo Download Script

For first-time setup, download the large bundles:

```bash
# Monaco Editor
npm pack monaco-editor@0.55.1
tar xzf monaco-editor-0.55.1.tgz
cp -r package/min/vs assets/monaco-editor/min/vs

# xterm.js
npm pack @xterm/xterm@5.5.0
npm pack @xterm/addon-fit@0.10.0
npm pack @xterm/addon-web-links@0.11.0
# Extract and copy lib/ files to assets/vendor/xterm/
```

## How It Works

### Communication Flow

1. **WebView → Flutter**: JavaScript calls `LCOBridge.postMessage(JSON-RPC)`
2. **Flutter → Backend**: TermuxEngine proxies via `HTTP POST http://127.0.0.1:9876/api/rpc`
3. **Backend → Terminal**: WebSocket `/ws/terminal` with node-pty bash
4. **Backend → File Tree**: WebSocket `/ws/file-events` with fs.watch

### Key Design Decisions

- **AssetServer singleton**: Android WebView blocks CORS and Web Workers on `file:///` pages. A local HTTP server on `127.0.0.1:random_port` serves all assets with proper origin.
- **JSBridge path normalization**: All file paths are normalized (strip leading `/`, block `..`) at the Flutter level before reaching the backend.
- **wsSend length-prefix**: WebSocket messages use `LENGTH|JSON` format with `encodeURIComponent` for Chinese character safety.
- **TERM=vt100**: Android/Termux environments have ncurses compatibility issues with xterm-256color. Using vt100 ensures PS1 renders correctly.
- **CLAUDE_CODE_TMPDIR**: Set to `$HOME/.tmp` to avoid `/tmp` permission errors in Termux.

## Troubleshooting

| Issue | Fix |
|---|---|
| "Loading Monaco Editor..." stuck | Check `pubspec.yaml` assets declare all Monaco subdirs |
| Terminal white screen | Ensure node-pty installed: `npm install node-pty` |
| Terminal disconnected | Start backend: `node node_backend.js --port=9876` |
| Chinese garbled | Check `utf8.encode` in TermuxEngine, `encodeURIComponent` in wsSend |
| Gradle download fails | Use Tencent mirror + file:// URL in gradle-wrapper.properties |
| `Can only have one anonymous define` | Monaco loader.js loaded twice — known issue, non-fatal |
| Claude CLI permission denied | Set `CLAUDE_CODE_TMPDIR=$HOME/.tmp` in .bashrc |

## Roadmap

- [x] **v1.0.0** — Multi-tab terminal, Git, file explorer, web preview, LLM chat adapter, dark/light mode, deployment center
- [ ] **v1.1** — Native Android file picker (SAF), open large projects
- [ ] **v1.2** — Self-contained Node.js backend (no Termux required for basic features)
- [ ] **v2.0** — Plugin system, LSP integration, remote dev via SSH

## License

MIT
