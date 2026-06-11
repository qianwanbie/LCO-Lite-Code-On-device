# LCO — Detailed Architecture & Implementation

## 1. Project Overview

LCO is a full-stack Android IDE combining Flutter, Monaco Editor, and a Termux-hosted Node.js backend. The architecture enforces strict abstraction: the UI communicates through `IDEEngine`, enabling development-phase MockEngine and production-phase TermuxEngine.

### Current State (Phase 2)
- **TermuxEngine** proxies all RPC calls to Node.js backend via HTTP POST
- **PROJECT_ROOT**: `/data/data/com.termux/files/home/lco-workspace/`
- File tree, terminal, editor all read/write the same workspace
- Node.js backend provides PTY bash, file I/O, git, script execution

---

## 2. Architecture Layers

### 2.1 Flutter Layer

#### Entry (`lib/main.dart`)
- Creates `TermuxEngine()` instead of MockEngine
- Engine initialized (verifies backend reachability)
- `LCOApp` (MaterialApp, dark theme) → `EditorWebView(engine)`

#### IDEEngine Interface (`lib/engine/ide_engine.dart`)
9 abstract methods: `saveFile`, `readFile`, `listFiles`, `runGitCommand`, `changeWorkspace`, `deleteFile`, `renameFile`, `runScript`, plus `fileChangeStream`, `initialize()`, `dispose()`

#### TermuxEngine (`lib/engine/termux_engine.dart`)
- Proxies all RPC methods to `http://127.0.0.1:9876/api/rpc` via `dart:io` HttpClient
- Emits `FileChangeEvent` on mutations (saveFile, deleteFile) for frontend refresh
- Falls back to error response if backend unreachable

#### JSON-RPC Protocol (`lib/protocol/json_rpc.dart`)
- `JsonRpcRequest`/`JsonRpcResponse`/`JsonRpcError` with `toJson()`/`fromJson()`
- Error codes: -32700 parse, -32601 method, -32602 params, -32001 permission, -32002 file not found, -32603 internal

#### JSBridge (`lib/webview/js_bridge.dart`)
- Routes WebView JSON-RPC messages to IDEEngine
- `_normalizePath()`: strips leading `/`, prevents `..`, collapses slashes
- `_dispatchToEngine()`: switch-case on method name → engine call
- Pending request tracking by ID, 30s timeout

#### AssetServer (`lib/webview/asset_server.dart`)
- Singleton HTTP server on `127.0.0.1` random port
- Serves all pubspec.yaml-declared assets via HTTP
- `_isTextAsset()` for correct Content-Type (text vs binary)
- CORS headers, no-cache, 404 fallback

#### EditorWebView (`lib/webview/editor_webview.dart`)
- WebView setup: `JavaScriptMode.unrestricted`, `LCOBridge` channel
- `_startServerAndLoad()` → AssetServer → `loadRequest(http://127.0.0.1:PORT/index.html)`
- `_onJsMessage()`: intercepts `editorReady` notification → `setState(_isEditorReady = true)`
- `onConsoleMessage` → Flutter `debugPrint` for all JS logs
- File change subscription → pushes `lco-file-change` events to JS

### 2.2 WebView Frontend

#### index.html
- Three-panel layout: sidebar | editor | terminal
- Monaco bootstrap: local loader.js → CDN fallback → `require(['vs/editor/editor.main'])`
- xterm.js: local primary + CDN fallback
- Floating toolbar: Test, Save, EN/ZH, Git
- Workspace bar: project name display, + new, ⇄ switch
- Modal dialog for new/switch project
- Drag resize handles (mouse + touch)

#### editor.js — Monaco + RPC Adapter
- `configureWorkers()`: `getWorkerUrl` with relative paths to local workers
- `createEditor()`: vs-dark theme, Cascadia Code font, automaticLayout, Ctrl+S save, blur save, debounced auto-save (1s)
- `sendRpc(method, params)`: incrementing ID, 30s timeout, `LCOBridge.postMessage`
- Response handling via `lco-response` CustomEvent
- File change handling via `lco-file-change` → re-read from engine
- Public API: `window.LCOEditor` — `runTest()`, `save()`, `toggleLocale()`, `openFile()`

#### file-explorer.js — File Tree + Workspace
- Tree rendering: async `listFiles` RPC, expand/collapse, lazy child loading
- 30+ file type icons
- Click → `LCOEditor.openFile()` → `setValue()`
- Right-click menu: Open, Copy Path, Git Status/Log/Add, Run, Rename, Delete, Refresh
- Workspace bar: new project (modal → saveFile/.lco → mkdir), switch project (list folders → changeWorkspace)
- `deleteFileConfirm()`: `confirm()` → `deleteFile` RPC
- `renameFilePrompt()`: `prompt()` → `renameFile` RPC
- `runScriptFile()`: `runScript` RPC → output to terminal

#### terminal.js — xterm.js Integration
- xterm.js 5.5 + FitAddon + WebLinksAddon
- 16-color VS Code dark palette
- WebSocket: `ws://127.0.0.1:9876/ws/terminal`, 5 retry attempts, 3s delay
- Data flow: `xterm.onData` → `ws.send({type:"input",data})` → backend → `ws.onmessage({type:"output",data})` → `xterm.write()`
- Resize: `onResize` → `ws.send({type:"resize",cols,rows})`
- Offline banner when backend unreachable
- `cd` into file detection with warning
- `terminalOutput` handler for RunScript results

#### i18n.js
- EN/ZH message sets, `t(key, locale)` lookup, `setLocale()` switch with event dispatch

#### lco.css
- CSS variables for theming, flexbox three-panel layout
- Resize handles, tree nodes, context menu, modal dialog
- Workspace bar, toolbar, status bar
- Custom scrollbar, collapsed states

### 2.3 Node.js Backend (`assets/server/node_backend.js`)

```
Server (port 9876)
├── HTTP POST /api/rpc          — Unified JSON-RPC endpoint
│   ├── saveFile                — Atomic write (temp → rename) + checksum
│   ├── readFile                — UTF-8 read with path traversal protection
│   ├── listFiles               — Directory listing with FileType metadata
│   ├── runGitCommand           — Git subprocess (30s timeout, clone/init triggers refresh)
│   ├── changeWorkspace         — Switch workspace subfolder
│   ├── deleteFile              — fs.unlinkSync / fs.rmSync (recursive)
│   ├── renameFile              — fs.renameSync (checks target doesn't exist)
│   └── runScript               — child_process.exec (.py/.js/.sh/.dart) → terminal output
├── HTTP GET /health            — Status endpoint
├── WebSocket /ws/terminal      — PTY bash interactive shell
│   ├── PTY mode: node-pty spawn bash, resize, termux PATH
│   └── Fallback: child_process.spawn with pipe stdio
└── WebSocket /ws/file-events   — fs.watch recursive → push events
```

**PROJECT_ROOT**: `/data/data/com.termux/files/home/lco-workspace/`

**PTY Environment**:
```
TERM=xterm-256color
PATH=/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/bin/applets:/usr/bin:/bin:/system/bin:/system/xbin
PS1=\[\e[32m\]\W\[\e[0m\]\$
```

**Terminal Welcome**: On connect, shows `ls -la` of workspace (or empty-workspace banner with `git clone` hint).

---

## 4. Communication Protocols

### 4.1 JSON-RPC 2.0 (LCOBridge)

```
JS → Flutter:  LCOBridge.postMessage({jsonrpc:"2.0", id:N, method:"readFile", params:{path:"/src/main.dart"}})
Flutter → JS:  window.dispatchEvent(CustomEvent('lco-response', {detail: response}))
```

### 4.2 WebSocket Terminal

```
Frontend → Backend:  {type: "input", data: "ls\r"}
                     {type: "resize", cols: 80, rows: 24}
Backend → Frontend:  {type: "output", data: "file1  file2\r\n"}
                     {type: "terminalOutput", data: "Hello", path: "/script.py"}
```

---

## 5. Build & Deployment

### Gradle Configuration
- Gradle: 8.14 (file:// URL from local cache)
- AGP: 8.11.1 (matches Flutter SDK compileOnly)
- Kotlin: 2.2.20
- compileSdk: 36, targetSdk: 36, minSdk: 24
- NDK: 28.2.13676358

### Termux Setup
```bash
pkg install clang make python binutils nodejs -y
cd ~/LCO/assets/server
npm install ws
npm install node-pty --build-from-source
node node_backend.js --port=9876
termux-wake-lock
```

### Known Issues
- Gradle download may fail behind firewall → use Tencent mirror + file:// URL
- AGP 8.2.1 too low for Flutter 3.44.1 → upgrade to 8.11.1
- Kotlin 1.9.24 too low → upgrade to 2.2.20
- file:/// CORS blocks Workers → use AssetServer HTTP on localhost
- node-pty compile: remove android_ndk_path from binding.gyp → set CC=clang

---

## 6. Security

- Path traversal: `resolvePath()` verifies resolved path stays within PROJECT_ROOT
- `_normalizePath()` blocks `..` patterns
- All servers bind to `127.0.0.1` only (localhost)
- WebView loads from localhost HTTP (not file:///), giving proper origin for Workers

## 7. Testing

6 unit tests in `test/engine/mock_engine_test.dart`:
- saveFile, readFile, readFile error, fileChange stream emission, listFiles, runGitCommand
- Uses injectable `rootDirectory` for isolated temp dirs
