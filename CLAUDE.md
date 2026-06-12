# CLAUDE.md — LCO (Lite Code On-device)

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
| `lib/engine/ide_engine.dart` | Abstract interface: 11 async methods + fileChangeStream |
| `lib/engine/termux_engine.dart` | HTTP proxy to backend, explicit UTF-8 encoding for Chinese |
| `lib/engine/mock_engine.dart` | Phase 1 dev engine, temp dir + seed files, not used in production |
| `lib/protocol/json_rpc.dart` | JsonRpcRequest/Response/Error, FileChangeEvent, error codes |
| `lib/webview/asset_server.dart` | **Singleton** HTTP server, solves file:/// CORS/Worker issues in WebView |
| `lib/webview/editor_webview.dart` | WebView container, LCOBridge channel, console→debugPrint forwarding |
| `lib/webview/js_bridge.dart` | JSON-RPC routing, _normalizePath() strips leading / and blocks .. |
| `lib/models/file_model.dart` | FileInfo, FileTree, FileType enum |
| `assets/index.html` | Three-panel layout, Monaco/xterm bootstrap, workspace bar, chat sidebar |
| `assets/js/editor.js` | Monaco init + RPC adapter + auto-save (1s debounce) + Ctrl+S/blur |
| `assets/js/file-explorer.js` | Tree renderer, click→open, right-click menu (Git/Delete/Rename/Run), workspace bar |
| `assets/js/terminal.js` | xterm.js 5.5 + WebSocket buffer reassembly + URI decode |
| `assets/js/chat.js` | Claude chat sidebar, sends claudeChat RPC, renders bubbles |
| `assets/js/i18n.js` | EN/ZH messages, setLocale/toggle |
| `assets/css/lco.css` | Complete layout, CSS variables, resize handles, modal, chat bubbles |
| `assets/server/node_backend.js` | **Entire backend.** 14 RPC methods + PTY terminal + WebSocket + LLM adapter + auto file creation |
| `assets/vendor/xterm/` | xterm.js 5.5 offline bundle (local primary, CDN fallback) |
| `assets/monaco-editor/min/vs/` | Monaco 0.55.1 offline bundle |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Flutter App (APK)                         │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ WebView (http://127.0.0.1:PORT/)                         ││
│  │ ┌──────────┬────────────────────┬──────────────────────┐ ││
│  │ │ Explorer │   Monaco Editor    │  Chat Sidebar (RPC)  │ ││
│  │ │ + WS bar │                    │  or Terminal (CLI)   │ ││
│  │ └──────────┴────────────────────┴──────────────────────┘ ││
│  └──────────────────────┬───────────────────────────────────┘│
│                         │ LCOBridge (JSON-RPC 2.0)           │
│  ┌──────────────────────▼───────────────────────────────────┐│
│  │  JSBridge → TermuxEngine (HTTP POST /api/rpc, UTF-8)     ││
│  │  AssetServer (HTTP singleton)                            ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
          │ HTTP /api/rpc          │ WebSocket /ws/terminal
          │                        │ WebSocket /ws/file-events
          ▼                        ▼
┌──────────────────────────────────────────────────────────────┐
│              Node.js Backend (Termux, port 9876)              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  HTTP POST /api/rpc                                      ││
│  │  ├── saveFile, readFile, listFiles, runGitCommand        ││
│  │  ├── deleteFile, renameFile, runScript                    ││
│  │  ├── switchWorkspace, mkdir, updateLLMConfig             ││
│  │  └── claudeChat → loadLLMConfig → chatWithLLM            ││
│  │       └── Auto-exec: ```file:``` ```shell:``` ```read:```││
│  ├── WebSocket /ws/terminal → node-pty bash PTY              ││
│  ├── WebSocket /ws/file-events → fs.watch                    ││
│  └── PROJECT_ROOT: /data/data/com.termux/files/home/         ││
│                     lco-workspace/                           ││
└──────────────────────────────────────────────────────────────┘
```

## All RPC Methods (14 total)

| Method | Params | Returns | Description |
|---|---|---|---|
| `saveFile` | `{path, content}` | `{ok, checksum}` | Atomic write (temp→rename) |
| `readFile` | `{path}` | `{content, encoding}` | UTF-8 read |
| `listFiles` | `{dirPath?}` | `{files: [{name,path,type,size,modified}]}` | Sorted dirs-first |
| `runGitCommand` | `{args: []}` | `{stdout, stderr, exitCode}` | clone/init→broadcast refresh |
| `deleteFile` | `{path}` | `{ok, path}` | Directories: recursive rm |
| `renameFile` | `{oldPath, newPath}` | `{ok, oldPath, newPath}` | Checks target doesn't exist |
| `runScript` | `{path}` | `{ok, path, running}` | .py/.js/.sh/.dart→exec→terminal |
| `switchWorkspace` | `{path?\|subFolder?}` | `{ok, workspace, path}` | cd terminal + broadcast tree |
| `mkdir` | `{path}` | `{ok, path}` | Create directory |
| `claudeChat` | `{message}` | `{response}` | LLM adapter + workspace context |
| `updateLLMConfig` | `{config}` | `{ok, path}` | Save llm_config.json |
| `tools.writeFile` | `{path, content}` | → saveFile | MCP alias |
| `tools.readFile` | `{path}` | → readFile | MCP alias |
| `tools.listDirectory` | `{path}` | → listFiles | MCP alias |
| `tools.mkdir` | `{path}` | → mkdir | MCP alias |

## Dual Chat Strategy

**Chat Sidebar (⌬ button)** → JSON-RPC `claudeChat` → LLM Adapter → DeepSeek/Anthropic/OpenAI API
- Stable, always works, auto-executes file:/shell:/read: blocks
- Workspace context (file tree) automatically injected into prompt

**Terminal** → PTY bash → type `claude` for full interactive Claude Code CLI
- Same experience as desktop Claude Code
- Requires API key in .bashrc: `export ANTHROPIC_API_KEY="sk-..."`

## LLM Adapter

Config: `lco-workspace/llm_config.json`
```json
{
  "provider": "anthropic",
  "endpoint": "https://api.deepseek.com/anthropic",
  "apiKey": "env:ANTHROPIC_API_KEY",
  "model": "deepseek-chat"
}
```
Providers: `anthropic`, `deepseek`, `openai`, `claude-cli`. Keys via `env:VAR_NAME`.

## Auto File Creation

Claude responses parsed for special blocks:
- `` ```file:path\ncontent``` `` → writes file, refreshes tree
- `` ```shell:command``` `` → executes, shows output
- `` ```read:path``` `` → reads file, shows contents

## Path Security

`ALLOWED_ROOTS`: `/data/data/` and `/data/user/0/` prefixes. `isPathAllowed()` uses `fs.realpathSync` for symlink-aware comparison. `resolvePath()` blocks `..` traversal.

## Build Config

Flutter 3.44.1, compileSdk 36, Gradle 8.14, AGP 8.11.1, Kotlin 2.2.20, Monaco 0.55.1 (bundled), xterm.js 5.5.0 (bundled), node-pty 1.1.0 (ARM64 native).

## Common Issues

1. **Loading Monaco stuck** → Monaco subdirs not in pubspec.yaml assets
2. **RPC -32601** → Method not in JSBridge _dispatchToEngine() switch
3. **Chinese garbled** → Check utf8.encode in TermuxEngine, wsSend encodeURIComponent
4. **Chat timeout** → API key missing; use `source ~/.bashrc` when starting server
5. **Gradle download fails** → Tencent mirror + file:// URL
6. **WebView file:/// CORS** → AssetServer singleton serves via HTTP
