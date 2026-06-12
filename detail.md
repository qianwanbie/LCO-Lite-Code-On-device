# LCO — Technical Reference

## 1. Project Overview

LCO is a full-stack Android IDE: Flutter shell → WebView (Monaco Editor + xterm.js) → JSON-RPC 2.0 + WebSocket → Node.js backend in Termux. It provides a complete code editing environment on Android tablets with file management, Git integration, interactive terminal, and AI chat capabilities.

### Key Numbers
- 14 JSON-RPC methods
- 4 LLM providers (anthropic/deepseek/openai/claude-cli)
- 2 WebSocket channels (/ws/terminal, /ws/file-events)
- 30+ Monaco language modules bundled offline
- 6 unit tests for MockEngine contract
- ~43 source files in git (not counting bundled libraries)

---

## 2. Architecture Layers

### 2.1 Flutter (Dart)

**Entry Point** (`lib/main.dart`):
- `SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky)` for fullscreen
- Creates `TermuxEngine()` which proxies all RPC to Node.js backend
- `MaterialApp` with dark theme → `EditorWebView(engine)`

**IDEEngine Interface** (`lib/engine/ide_engine.dart`):
```dart
abstract class IDEEngine {
  Future<JsonRpcResponse> saveFile(String path, String content);
  Future<JsonRpcResponse> readFile(String path);
  Future<JsonRpcResponse> listFiles([String? dirPath]);
  Future<JsonRpcResponse> runGitCommand(List<String> args);
  Future<JsonRpcResponse> changeWorkspace(String subFolder);
  Future<JsonRpcResponse> deleteFile(String path);
  Future<JsonRpcResponse> renameFile(String oldPath, String newPath);
  Future<JsonRpcResponse> runScript(String path);
  Future<JsonRpcResponse> claudeChat(String message);
  Future<JsonRpcResponse> updateLLMConfig(Map<String, dynamic> config);
  Stream<FileChangeEvent> get fileChangeStream;
  Future<void> initialize();
  Future<void> dispose();
}
```

**TermuxEngine** (`lib/engine/termux_engine.dart`):
- All RPC methods call `_sendRpc(method, params)` which:
  1. `jsonEncode` the request
  2. `utf8.encode(body)` for explicit UTF-8
  3. HTTP POST to `http://127.0.0.1:9876/api/rpc`
  4. Parse JSON response → `JsonRpcResponse`
- Emits `FileChangeEvent` on mutations (saveFile, deleteFile)

**MockEngine** (`lib/engine/mock_engine.dart`):
- Phase 1 development engine
- Stores files in `getApplicationDocumentsDirectory()/lco-workspace/`
- Seeds demo files: `src/main.dart`, `src/utils.dart`, `pubspec.yaml`, `README.md`, `.gitignore`
- Simulates Git output
- Injectable `rootDirectory` for testing

**JSON-RPC Protocol** (`lib/protocol/json_rpc.dart`):
- `JsonRpcRequest`: jsonrpc, id, method, params, toJson/fromJson, encode
- `JsonRpcResponse`: jsonrpc, id, result, error, toJson/fromJson, encode
- `JsonRpcError`: code, message, data
- `FileChangeEvent`: path, type (created/modified/deleted/refresh), converts to notification
- Error codes: -32700 parse, -32601 method, -32602 params, -32001 perm, -32002 not found, -32603 internal

**AssetServer** (`lib/webview/asset_server.dart`):
- Singleton (factory → private instance)
- Binds `HttpServer` to `127.0.0.1:0` (random available port)
- Serves all `pubspec.yaml`-declared assets via HTTP
- `_isTextAsset()`: .html/.js/.css/.json/.svg/.xml/.yaml/.yml/.md/.txt/.dart → string + charset=utf-8
- Binary: .png/.woff2/etc → bytes
- CORS: `Access-Control-Allow-Origin: *`, no-cache
- **Why it exists**: Android WebView with `file:///` origin (origin=null) blocks CORS and Web Workers. Serving via HTTP gives proper origin.

**EditorWebView** (`lib/webview/editor_webview.dart`):
- `_startServerAndLoad()`: starts AssetServer → `loadRequest(http://127.0.0.1:PORT/index.html)`
- `_onJsMessage()`: intercepts `editorReady` notification → `setState(_isEditorReady = true)` to hide Flutter loading overlay
- All other messages → `_bridge.handleMessage()` → response injected as CustomEvent
- `_onConsoleMessage()`: forwards all JS console (info/warn/error) to Flutter debugPrint
- `_fileChangeSub`: subscribes to engine.fileChangeStream, pushes `lco-file-change` events to JS

**JSBridge** (`lib/webview/js_bridge.dart`):
- `handleMessage(raw)`: parse JSON → dispatch to engine → return encoded response
- `_parseJson(raw)`: tries `jsonDecode`, falls back to single-quote→double-quote replacement
- `_normalizePath(raw)`: strips leading `/`, converts `\` to `/`, collapses slashes, blocks `..`
- `_dispatchToEngine()`: switch-case mapping 14 method names to engine calls
- Pending request tracking by ID with 30s timeout
- `disposePending()`: complete all pending on disposal

### 2.2 WebView Frontend (HTML/CSS/JS)

**index.html**:
- Three-panel flex layout: sidebar | main (editor + terminal) | chat sidebar
- Monaco bootstrap:
  1. Try local `loader.js`
  2. On error → CDN `loader.js` from jsDelivr
  3. `require(['vs/editor/editor.main'])` → hide loading overlay → load editor.js
  4. CDN retry without reloading loader.js
- xterm.js: local primary + CDN fallback with document.write detection
- Workspace bar: project name + ⌂(home) + +(new) + ⇄(switch) + ⌬(Claude badge)
- Floating toolbar: ▶ Test | 💾 Save | EN | ⎇ Git
- Modal dialog for new/switch project
- Drag resize handles (mouse + touch) for sidebar width and terminal height

**Script Load Order**:
```
1. lco.css, xterm.css
2. i18n.js
3. Monaco path config (inline)
4. Monaco bootstrap (inline, async)
5. xterm.js + addons (local + CDN)
6. file-explorer.js
7. terminal.js
8. chat.js
```

**editor.js** (Monaco + RPC Adapter):
- `configureWorkers()`: getWorkerUrl with relative paths to local worker files (.js/.css/.html/.ts)
- `createEditor()`: vs-dark theme, automaticLayout, Cascadia Code font, no minimap, word wrap
- `sendRpc(method, params)`: incrementing ID, 30s timeout, LCOBridge.postMessage(JSON.stringify(payload))
- Response handling via `lco-response` CustomEvent → JSON.parse → resolve pending promise
- File change handling via `lco-file-change` → re-read modified files
- Auto-save: `onDidChangeModelContent` → 1s debounce → `explicitSave()`
- Explicit save: Ctrl+S / `onDidBlurEditorWidget` / toolbar Save button
- Window API: `window.LCOEditor.sendRpc()`, `.openFile()`, `.save()`, `.runTest()`, `.toggleLocale()`

**file-explorer.js** (File Tree + Workspace):
- `refresh()`: async `listFiles` RPC from root
- `loadChildren(parent, dirPath)`: load directory contents, sort dirs-first
- `renderNode(parent, fileInfo, depth)`: create tree node with icon + chevron + name
- Click → `LCOEditor.openFile(path, language)` → setValue
- Right-click context menu:
  - Open, Copy Path
  - Git Status, Git Log, Git Add
  - **Run** (for .py/.js/.sh/.dart)
  - **Rename** (prompt for new name)
  - **Delete** (confirm dialog)
  - Refresh
- Workspace bar: ⌂(home), +(new project modal), ⇄(switch project modal), ⌬(Claude badge)
- `switchWorkspace(folderName)`: RPC switchWorkspace → cd terminal + broadcast + refresh
- `switchToHome()`: reset to PROJECT_ROOT
- `checkClaudeConfig()`: detect `.claude` directory → show badge

**terminal.js** (xterm.js + WebSocket):
- xterm.js 5.5 with FitAddon + WebLinksAddon
- 16-color VS Code dark palette
- WebSocket `ws://127.0.0.1:9876/ws/terminal`
- **Buffer assembly**: handles fragmented WebSocket frames via length-prefix protocol (`LENGTH|JSON`) or direct JSON parse
- **URI decode**: `decodeURIComponent` for Chinese character safety
- Reconnect: 5 attempts, 3s delay between retries
- Message handlers: output, error, cd, terminalOutput (from runScript)
- `cd` into file detection: buffers input, warns if target looks like a file
- Window API: `window.LCOTerminal.write()`, `.clear()`, `.focus()`, `.connect()`

**chat.js** (Chat Sidebar):
- Sends `claudeChat` JSON-RPC for each message
- Renders bubbles: user (right, blue), claude (left, dark), system (center, grey)
- ANSI escape code stripping for clean display
- Enter to send, Shift+Enter for newline
- Window API: `window.LCOChat.toggle()`, `.show()`, `.hide()`

**i18n.js**:
- EN/ZH message sets
- `t(key, locale)`: lookup with fallback to EN
- `setLocale(locale)`: switch language, emits `lco-locale-changed` event
- Messages: loading states, file ops, git, errors

**lco.css**:
- CSS variables: `--lco-bg`, `--lco-accent`(#007acc), `--lco-sidebar-width`(240px), `--lco-terminal-height`(200px)
- Flexbox three-panel layout
- Resize handles: 4px draggable, highlight on hover, mouse+touch
- Tree nodes: indentation, chevrons (▸/▾), file type icons, hover/active states
- Context menu: fixed position, drop shadow, separator lines
- Modal: overlay + box, form inputs, project list
- Chat bubbles: user/claude/system roles, code/pre formatting
- Floating toolbar: top-right, semi-transparent, full opacity on hover
- Status bar: 22px, color-coded (success green / info blue / error red / warn orange)
- Custom scrollbar: 8px, dark theme
- Collapsed states for sidebar and terminal

### 2.3 Node.js Backend (`assets/server/node_backend.js`)

**Server Structure**:
```
http://127.0.0.1:9876
├── POST /api/rpc → dispatchRpc(id, method, params)
├── GET /health → { status, ptyAvailable, root, watcherActive }
├── WebSocket /ws/terminal → handleTerminalConnection
├── WebSocket /ws/file-events → file change push
└── WebSocket /ws/claude → handleClaudeConnection (experimental)
```

**dispatchRpc** (async):
- 11 method cases + 4 tool aliases + unknown handler
- `claudeChat` is the only async case (uses `await new Promise` for API call)
- All other methods are synchronous filesystem operations

**LLM Adapter**:
```
loadLLMConfig() → reads lco-workspace/llm_config.json
  ↓
chatWithLLM(cfg, message, callback)
  ├── provider='anthropic' → _callAnthropic(endpoint, key, model, msg)
  │     POST /v1/messages, x-api-key header, anthropic-version: 2023-06-01
  ├── provider='deepseek'/'openai' → _callOpenAI(endpoint, key, model, msg)
  │     POST /v1/chat/completions, Authorization: Bearer header
  └── provider='claude-cli' → spawn bash → claude bash script
```

**Auto-Execution Blocks** (in claudeChat response processing):
1. ` ```file:path\ncontent``` ` → resolvePath → mkdir -p → writeFile → actions.push('✓ created path')
2. ` ```shell:command``` ` → execSync(command, {cwd:ROOT}) → insert output
3. ` ```read:path``` ` → readFileSync → insert content with language tag

After execution: `broadcastFileTreeRefresh()` if any files changed.

**Terminal WebSocket** (/ws/terminal):
- **PTY mode** (node-pty): `pty.spawn(bash, [], {name:'xterm-256color', cols, rows, cwd, env})`
  - PTY → WS: `pty.onData(data)` → `wsSend(ws, {type:'output', data})`
  - WS → PTY: `ws.on('message', {type:'input', data})` → `pty.write(data)`
  - Resize: `ws.on('message', {type:'resize', cols, rows})` → `pty.resize(cols, rows)`
  - Exit: `pty.onExit({exitCode})` → notify client + cleanup
- **Fallback mode** (child_process.spawn): bash with pipe stdio, no TTY
- **wsSend()**: length-prefix (`Buffer.byteLength|JSON`) + `encodeURIComponent` on data fields
- **Termux PATH**: `/data/data/com.termux/files/usr/bin:` + applets + system paths
- **PS1**: `\[\e[32m\]\W\[\e[0m\]\$ ` (green current-dir$ prompt)
- **Welcome**: `ls -la` on connect (or empty-workspace banner with git clone hint)

**Path Security**:
```javascript
const ALLOWED_ROOTS = [
  '/data/data/com.termux/files/home/lco-workspace',
  '/data/user/0/com.termux/lco-workspace',  // Android symlink
  '/data/data/com.termux/files/home',
  '/data/user/0/com.termux',
];

function isPathAllowed(targetPath) {
  // 1. fs.realpathSync for symlink resolution
  // 2. String prefix fallback for non-existent paths
}
```

**PROJECT_ROOT**: `/data/data/com.termux/files/home/lco-workspace/`

**Workspace Context Injection** (`getWorkspaceContext()`):
- Prepend to every claudeChat message:
  - Project identity (LCO IDE, Android)
  - Current workspace path
  - File tree (recursive, 2 levels deep, skipping dotfiles except .claude)
  - Available tool block reference (file:, shell:, read:)

---

## 3. Communication Protocols

### 3.1 JSON-RPC 2.0 (Chat + File Operations)

```
JS (WebView)                          Flutter (Dart)                     Backend (Node.js)
──────────                            ────────────                       ────────────────
chat.js: sendRpc('claudeChat',{msg})
  → JSON.stringify(payload)
  → LCOBridge.postMessage       ──→  _onJsMessage
                                      → _bridge.handleMessage
                                        → _parseJson
                                        → _dispatchToEngine
                                        → _engine.claudeChat(msg)
                                          → utf8.encode(body)
                                          → HTTP POST /api/rpc     ──→  JSON.parse(body)
                                                                        → dispatchRpc
                                                                        → chatWithLLM
                                                                        → API call
                                                                        ← jsonResult(id,{response})
                                          ← HTTP response          ←──
                                        ← JsonRpcResponse
                                      → jsonEncode(response)
                                      → runJavaScript(CustomEvent) ──→  window 'lco-response'
  → JSON.parse(e.detail)
  → handleResponse(result)
  → updateBubble(text)
```

### 3.2 WebSocket (Terminal)

```
xterm.onData → ws.send({type:'input',data})
  → node_backend.js → ptyProcess.write(data) → bash
  → ptyProcess.onData → wsSend(ws,{type:'output',data:encodeURIComponent(data)})
  → terminal.js → msgBuffer assemble → decodeURIComponent → xterm.write
```

---

## 4. UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ▶ Test  💾 Save  EN  ⎇ Git    ← Floating Toolbar               │
├───────────────┬──────────────────────────┬───────────────────────┤
│ lco-workspace │                          │ ⌬ CLAUDE CHAT    ✕   │
│ ⌂ + ⇄ ⌬      │    Monaco Editor          │                       │
│ EXPLORER   ↻  │                           │  [You] Hello         │
│               │    void main() {          │                       │
│ ▸ src/        │      print("hi");         │  [Claude] Hi! How    │
│   main.dart   │    }                      │  can I help?         │
│ ▸ test/       │                           │                       │
│ hello.py      │                           │  [______________] ↑  │
├───────────────┴──────────────────────────┴───────────────────────┤
│  TERMINAL  ◻ ⌧ ✕                                                │
│  lco-workspace $ ls                                              │
│  src/  hello.py  llm_config.json                                 │
├──────────────────────────────────────────────────────────────────┤
│  ● Monaco Editor ready                                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Build & Deploy

### Flutter APK
```bash
flutter pub get && flutter build apk --debug
adb install build/app/outputs/flutter-apk/app-debug.apk
```

### Gradle Configuration
```
gradle-wrapper.properties:  gradle-8.14-all.zip (file://)
settings.gradle:            AGP 8.11.1, Kotlin 2.2.20
app/build.gradle:           compileSdk 36, targetSdk 36, minSdk 24, NDK 28.2.13676358
```

### Backend (one-time setup in Termux)
```bash
pkg install clang make python binutils nodejs proot-distro -y
cd ~/LCO/assets/server
npm install ws
npm install node-pty  # CC=clang CXX=clang++ if needed
```

### Backend Start (every reboot)
```bash
cd ~/LCO/assets/server
bash -c 'source ~/.bashrc && exec node node_backend.js --port=9876'
termux-wake-lock
```

---

## 6. Dual Chat Strategy (Final)

**Approach A — Chat Sidebar (LLM Adapter)** ✅ Production
- Frontend: chat.js → JSON-RPC `claudeChat` → backend → HTTP API call
- Pros: Stable, works without glibc/proot, supports file:/shell:/read: auto-execution
- Cons: Not interactive Claude Code (single-turn)

**Approach B — Terminal CLI** ✅ Available
- User types `claude` in PTY terminal → full interactive Claude Code
- Pros: Complete desktop Claude experience
- Cons: Requires API key in .bashrc, proot-distro needed for glibc

**Approach C — WebSocket Claude PTY** ⚠️ Experimental
- Backend spawns Claude via node-pty for streaming I/O
- Persists across WebSocket disconnects
- Currently blocked by: glibc binary in Termux context doesn't produce stdout

**Verified workaround**: Claude binary runs inside `proot-distro login ubuntu` and returns correct output. Full integration requires solving stdin/stdout piping through proot+spawn.

---

## 7. Security

- `resolvePath()`: blocks `..` traversal, verifies resolved path starts with ALLOWED_ROOTS
- `isPathAllowed()`: symlink-aware comparison via `fs.realpathSync`
- All servers bind to `127.0.0.1` only (localhost)
- AssetServer serves from APK assets (read-only)
- `_normalizePath()` in JSBridge as second layer of path validation

---

## 8. Testing

6 unit tests in `test/engine/mock_engine_test.dart`:
1. saveFile creates file and returns checksum
2. readFile returns saved content
3. readFile errors for missing file
4. saveFile emits FileChangeEvent
5. listFiles returns file entries
6. runGitCommand simulates git init

Test infrastructure: `TestWidgetsFlutterBinding`, injectable `rootDirectory` (Directory.systemTemp), cleanup.
