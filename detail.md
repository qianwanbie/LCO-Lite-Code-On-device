# LCO — Technical Reference

## 1. Communication Flow (Detailed)

### 1.1 Chat Message (full trace)

```
[User types in chat sidebar, presses Enter]
  1. chat.js: sendMessage()
     → inputEl.value = "你好"
     → addBubble("你好", 'user')
     → LCOEditor.sendRpc('claudeChat', { message: "你好" })

  2. editor.js: sendRpc('claudeChat', { message: "你好" })
     → id = ++requestId
     → payload = { jsonrpc:'2.0', id:N, method:'claudeChat', params:{message:"你好"} }
     → LCOBridge.postMessage(JSON.stringify(payload))
     → pendingRequests[id] = { resolve, reject, timer(30s) }

  3. Flutter: editor_webview.dart → _onJsMessage(JavaScriptMessage)
     → message.message = '{"jsonrpc":"2.0","id":1,"method":"claudeChat","params":{"message":"你好"}}'
     → jsonDecode check: not 'editorReady' → fall through
     → _bridge.handleMessage(message.message)

  4. Flutter: js_bridge.dart → handleMessage(raw)
     → _parseJson(raw) → JsonRpcRequest.fromJson(json)
     → request.method = 'claudeChat', request.params = {message: "你好"}
     → _dispatchToEngine(1, 'claudeChat', {message: "你好"})
     → case 'claudeChat': msg = params['message'] = "你好"
     → _engine.claudeChat("你好")

  5. Flutter: termux_engine.dart → claudeChat("你好")
     → _sendRpc('claudeChat', {'message': "你好"})
     → body = jsonEncode({jsonrpc:'2.0',id:N,method:'claudeChat',params:{message:"你好"}})
     → bytes = utf8.encode(body)  ← CRITICAL: explicit UTF-8
     → HTTP POST http://127.0.0.1:9876/api/rpc
       Headers: Content-Type: application/json; charset=utf-8
                Content-Length: <byte_length>

  6. Node.js: node_backend.js → HTTP /api/rpc handler
     → body chunks → body = '{"jsonrpc":"2.0",...,"params":{"message":"你好"}}'
     → JSON.parse(body) → { id, method:'claudeChat', params:{message:"你好"} }
     → await dispatchRpc(id, method, params)

  7. Node.js: dispatchRpc → case 'claudeChat'
     → message = params.message = "你好"
     → cfg = loadLLMConfig()
       → reads /data/data/com.termux/files/home/lco-workspace/llm_config.json
       → returns { provider:'anthropic', endpoint:'https://api.deepseek.com/anthropic',
                    apiKey:'env:ANTHROPIC_API_KEY', model:'deepseek-chat' }
     → chatWithLLM(cfg, "你好", callback)

  8. Node.js: chatWithLLM → _callAnthropic
     → key = resolveApiKey(cfg) → process.env.ANTHROPIC_API_KEY = "sk-a4a8..."
     → body = JSON.stringify({ model:'deepseek-chat', max_tokens:2048,
           messages:[{role:'user',content:'你好'}] })
     → HTTPS POST api.deepseek.com/anthropic/v1/messages
       Headers: x-api-key: sk-a4a8..., anthropic-version: 2023-06-01

  9. DeepSeek API → Response
     → { content: [{ text: "你好！有什么可以帮你的？" }] }
     → callback(null, "你好！有什么可以帮你的？")

  10. Node.js: dispatchRpc resolves
      → jsonResult(id, { response: "你好！有什么可以帮你的？" })
      → '{"jsonrpc":"2.0","id":1,"result":{"response":"你好！有什么可以帮你的？"}}'

  11. Flutter: termux_engine.dart receives HTTP response
      → raw = await response.transform(utf8.decoder).join()
      → jsonDecode(raw) → JsonRpcResponse.fromJson
      → _sendRpc returns JsonRpcResponse

  12. Flutter: js_bridge.dart completes pending request
      → completer.complete(response)
      → handleMessage returns response.encode()
      → jsonEncode called on response string for JavaScript injection

  13. Flutter: editor_webview.dart
      → runJavaScript("window.dispatchEvent(new CustomEvent('lco-response',
           {detail: ${jsonEncode(response)}}))")
      → jsonEncode escapes quotes/newlines → valid JS string literal

  14. Browser: editor.js
      → window 'lco-response' event fires
      → e.detail = '{"jsonrpc":"2.0","id":1,"result":{"response":"你好！..."}}'
      → JSON.parse(e.detail) → handleResponse(response)
      → pendingRequests[id].resolve(response.result)
      → sendRpc promise resolves

  15. chat.js: .then(result)
      → updateClaudeBubble(el, result.response)
      → el.textContent = "你好！有什么可以帮你的？"
```

### 1.2 Terminal I/O (full trace)

```
[User types 'ls' in terminal]
  1. xterm.onData('l')
  2. xterm.onData('s')
  3. xterm.onData('\r')
     → ws.send(JSON.stringify({ type:'input', data:'ls\r' }))

  4. Node.js: ws.on('message')
     → msg = JSON.parse(data) → { type:'input', data:'ls\r' }
     → ptyProcess.write('ls\r')

  5. bash executes 'ls'
     → stdout: 'src  pubspec.yaml  README.md\n'
     → ptyProcess.onData('src  pubspec.yaml  README.md\n')

  6. Node.js: ptyProcess.onData handler
     → wsSend(ws, { type:'output', data:'src  pubspec.yaml  README.md\n' })
     → data = encodeURIComponent('src  pubspec.yaml  README.md\n')
     → json = '{"type":"output","data":"src%20%20pubspec.yaml%20%20README.md%0A"}'
     → ws.send('82|{"type":"output","data":"src%20%20pubspec.yaml%20%20README.md%0A"}')

  7. Browser: ws.onmessage
     → msgBuffer += '82|{"type":"output","data":"src%20%20pubspec.yaml%20%20README.md%0A"}'
     → Parse: pipeIdx=2, len=82, json starts at index 3
     → JSON.parse → { type:'output', data:'src%20%20pubspec.yaml%20%20README.md%0A' }
     → decodeURIComponent → 'src  pubspec.yaml  README.md\n'
     → xterm.write('src  pubspec.yaml  README.md\n')
```

## 2. File Operation Traces

### 2.1 File Tree Click → Open

```
file-explorer.js: click on 'main.dart'
  → openFile('/src/main.dart', 'main.dart')
  → LCOEditor.openFile('/src/main.dart', 'dart')
  → sendRpc('readFile', { path:'/src/main.dart' })
  → ... (RPC roundtrip through Flutter → backend) ...
  → result = { content:'void main() {...}', encoding:'utf-8' }
  → monaco.editor.createModel(content, 'dart', uri)
  → editor.setModel(model)
```

### 2.2 Auto-Save

```
editor.js: onDidChangeModelContent
  → isDirty = true
  → debounce 1s → explicitSave()
  → sendRpc('saveFile', { path: model.uri.path, content: model.getValue() })
  → ... backend writes to disk (atomic: temp→rename) ...
  → FileChangeEvent emitted → Flutter fileChangeStream
  → editor_webview.dart pushes 'lco-file-change' CustomEvent to JS
  → editor.js handleFileChange → re-reads file → model.setValue()
```

### 2.3 Right-Click → Delete

```
file-explorer.js: right-click → Delete
  → deleteFileConfirm(fileInfo)
  → confirm("Delete 'main.dart'?")
  → sendRpc('deleteFile', { path:'/src/main.dart' })
  → ... backend: fs.unlinkSync(resolvedPath) ...
  → FileChangeEvent('deleted')
  → refresh() → listFiles → re-render tree
```

### 2.4 Right-Click → Run

```
file-explorer.js: right-click test.py → Run
  → runScriptFile('/test.py', 'test.py')
  → terminal.write('\x1b[1;36m▶ Running: /test.py\x1b[0m\r\n')
  → sendRpc('runScript', { path:'/test.py' })
  → ... backend: exec('python /path/to/test.py') ...
  → stdout → broadcast to terminal clients as 'terminalOutput'
  → terminal.js: ws.onmessage → processMessage → xterm.write(output)
```

## 3. Workspace Management

### 3.1 Switch Project

```
file-explorer.js: click ⇄ → openModal('switch')
  → loadProjectList()
  → sendRpc('listFiles', { dirPath:'/' })
  → filter directories → render .project-item for each
  → User clicks 'my-project'
  → switchWorkspace('my-project')
  → sendRpc('switchWorkspace', { subFolder:'my-project' })
  → ... backend: isPathAllowed(newRoot) → broadcast cd to terminal → broadcastFileTreeRefresh ...
  → terminal.js: receives { type:'cd', path } → sends 'cd "/path"\r' + 'clear\r' to PTY
  → file-explorer.js: refresh() → listFiles from new root
```

### 3.2 New Project

```
file-explorer.js: click + → openModal('new')
  → User types 'my-app' → handleModalConfirm
  → sendRpc('saveFile', { path:'/my-app/.lco', content:'' })
  → ... backend creates my-app/ directory ...
  → refresh() → new folder appears in tree
```

### 3.3 Home Button

```
file-explorer.js: click ⌂ → switchToHome()
  → sendRpc('switchWorkspace', { path:'' })
  → ... backend: newRoot = PROJECT_ROOT ...
  → cd to PROJECT_ROOT in terminal
  → refresh tree from PROJECT_ROOT
```

## 4. Backend Reference

### 4.1 Server Structure

```
Server (http://127.0.0.1:9876)
│
├── POST /api/rpc
│   └── dispatchRpc(id, method, params) — async
│       ├── saveFile       → atomic write + checksum
│       ├── readFile       → UTF-8 read
│       ├── listFiles      → directory listing
│       ├── runGitCommand  → child_process.execSync('git ...')
│       ├── deleteFile     → fs.unlinkSync / fs.rmSync
│       ├── renameFile     → fs.renameSync
│       ├── runScript      → child_process.exec → terminal output
│       ├── switchWorkspace → update root + cd terminal + broadcast
│       ├── claudeChat     → chatWithLLM → API call
│       └── updateLLMConfig → fs.writeFileSync
│
├── GET /health
│   └── { status, ptyAvailable, root, watcherActive }
│
├── WebSocket /ws/terminal
│   ├── PTY mode: pty.spawn(bash) ← node-pty
│   ├── Fallback: spawn(bash) ← child_process
│   └── Messages: {type:'input'}, {type:'output'}, {type:'resize'}, {type:'cd'}
│
└── WebSocket /ws/file-events
    └── fs.watch(ROOT, {recursive:true}) → broadcast {type:'fileChange',...}
```

### 4.2 Path Security

```javascript
const ALLOWED_ROOTS = [
  '/data/data/com.termux/files/home/lco-workspace',
  '/data/user/0/com.termux/lco-workspace',  // Android symlink alias
  '/data/data/com.termux/files/home',
  '/data/user/0/com.termux',
];

function isPathAllowed(targetPath) {
  // 1. Try fs.realpathSync for symlink resolution
  // 2. Fallback to string prefix match
  // 3. Check against ALLOWED_ROOTS
}
```

### 4.3 wsSend Helper

```javascript
function wsSend(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (obj.data) obj.data = encodeURIComponent(obj.data);  // Chinese safety
  const json = JSON.stringify(obj);
  ws.send(Buffer.byteLength(json, 'utf-8') + '|' + json); // length-prefix
}
```

## 5. Frontend Reference

### 5.1 Script Load Order

```
index.html:
  1. lco.css (stylesheet)
  2. xterm.css (stylesheet)
  3. i18n.js
  4. Monaco path config (inline)
  5. Monaco bootstrap (inline) — async, loads editor.js when ready
  6. xterm.js + addons (local + CDN fallback)
  7. file-explorer.js
  8. terminal.js
  9. chat.js
```

### 5.2 Global APIs

```javascript
// All available on window after load:
window.LCOEditor        // Monaco + RPC adapter
  .sendRpc(method, params)  → Promise<result>
  .openFile(path, lang)     → Promise
  .save() / .runTest() / .toggleLocale()
  .isReady() / .isDirty()

window.LCOFileExplorer  // File tree
  .refresh() / .openFile()

window.LCOTerminal      // xterm.js terminal
  .write(text) / .clear() / .focus()

window.LCOChat          // Claude chat sidebar
  .toggle() / .show() / .hide()

window.LCO_i18n         // Internationalization
  .t(key) / .setLocale(locale) / .getLocale()
```

### 5.3 Chat Message Protocol

```
Frontend → Backend (via JSON-RPC):
{ jsonrpc:'2.0', id:N, method:'claudeChat', params:{ message:string } }

Backend → Frontend (via JSON-RPC response):
{ jsonrpc:'2.0', id:N, result:{ response:string } }
// OR
{ jsonrpc:'2.0', id:N, error:{ code:int, message:string } }
```

## 6. Build & Deploy

### 6.1 Flutter APK

```bash
cd LCO
flutter pub get
flutter build apk --debug
# Output: build/app/outputs/flutter-apk/app-debug.apk
adb install build/app/outputs/flutter-apk/app-debug.apk
```

### 6.2 Backend Setup (one-time)

```bash
# In Termux:
pkg install clang make python binutils nodejs -y
cd ~
mkdir -p LCO/assets/server
# Copy node_backend.js to ~/LCO/assets/server/
cd ~/LCO/assets/server
npm install ws
npm install node-pty  # May need: export CC=clang CXX=clang++
```

### 6.3 Backend Start (every reboot)

```bash
cd ~/LCO/assets/server
bash -c 'source ~/.bashrc && exec node node_backend.js --port=9876'
termux-wake-lock  # Keep alive when screen off
```

### 6.4 API Key Setup

```bash
# In Termux, add to ~/.bashrc:
echo 'export ANTHROPIC_API_KEY="sk-your-key-here"' >> ~/.bashrc
echo 'export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"' >> ~/.bashrc
source ~/.bashrc
```

## 7. Known Limitations

1. **Monaco Editor bundle** (~117 files) must be declared in `pubspec.yaml` subdirectory by subdirectory. Missing `editor/` or `assets/` subdirectory → "Loading Monaco Editor..." stuck.
2. **node-pty** requires native ARM64 compilation in Termux. `npm install node-pty` may fail if `clang`/`make` not installed. Fallback: `child_process.spawn('bash')`.
3. **Claude CLI** (claude-chat provider) is a bash script requiring glibc. Spawning it from `run-as` context has TTY issues. The HTTP API providers (anthropic/deepseek/openai) are recommended.
4. **Wireless ADB** ports expire every few minutes. USB debugging is more stable for development.
5. **Gradle** download from `services.gradle.org` may be blocked. Use Tencent mirror + `file://` URL in `gradle-wrapper.properties`.
6. **WebView `file:///` origin** blocks CORS and Workers. AssetServer singleton solves this by serving via HTTP.
