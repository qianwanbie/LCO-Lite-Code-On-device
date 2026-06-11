# CLAUDE.md — LCO (Lite Code On-device)

## What This Is

Full-stack Android IDE. Flutter embeds Monaco Editor + xterm.js in WebView. Node.js backend in Termux provides PTY terminal, file I/O, Git, and LLM chat. Chat auto-creates files — when Claude outputs a ``file:path`` code block, the backend writes it to disk and refreshes the file tree.

## How To Run

**Flutter app (once):**
```bash
flutter pub get && flutter build apk --debug
adb install build/app/outputs/flutter-apk/app-debug.apk
```

**Backend (every reboot, in Termux):**
```bash
cd ~/LCO/assets/server
bash -c 'source ~/.bashrc && exec node node_backend.js --port=9876'
```

## Source Map

| File | Role |
|---|---|
| `lib/main.dart` | Entry, immersive fullscreen, TermuxEngine init |
| `lib/engine/termux_engine.dart` | HTTP proxy to backend, explicit UTF-8 encoding |
| `lib/webview/asset_server.dart` | **Singleton** HTTP server, solves file:/// CORS/Worker issues |
| `lib/webview/editor_webview.dart` | WebView container, console listener forwards all JS logs |
| `lib/webview/js_bridge.dart` | JSON-RPC routing, path normalization, method dispatch |
| `assets/index.html` | Three-panel layout, Monaco/xterm bootstrap, workspace bar, chat |
| `assets/js/editor.js` | Monaco init + RPC adapter + auto-save |
| `assets/js/file-explorer.js` | File tree + workspace management (new/switch/home/Claude badge) |
| `assets/js/terminal.js` | xterm.js + WebSocket buffer + URI decode |
| `assets/js/chat.js` | Claude chat sidebar, bubble UI |
| `assets/server/node_backend.js` | **Entire backend.** 14 RPC methods + PTY + WebSocket + LLM adapter + auto file creation |

## All RPC Methods

saveFile, readFile, listFiles, runGitCommand, deleteFile, renameFile, runScript, switchWorkspace, mkdir, claudeChat, updateLLMConfig, tools.writeFile, tools.readFile, tools.listDirectory, tools.mkdir

## LLM Adapter

Config: `lco-workspace/llm_config.json`. Providers: anthropic, deepseek, openai, claude-cli. Keys via `env:VAR_NAME`.

## Auto File Creation

Claude outputs ``file:path\ncontent`` → backend auto-creates directory, writes file, refreshes tree, shows `✓ created path`.

## Path Security

`ALLOWED_ROOTS` accepts both `/data/data/` and `/data/user/0/`. `isPathAllowed()` uses `fs.realpathSync`. `..` blocked.

## Build Config

Flutter 3.44.1, compileSdk 36, Gradle 8.14, AGP 8.11.1, Kotlin 2.2.20, Monaco 0.55.1 (bundled), xterm.js 5.5.0 (bundled).
