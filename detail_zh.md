# LCO — 技术参考手册

## 1. 通信流程（详细）

### 1.1 聊天消息（完整链路追踪）

```
[用户在聊天侧边栏输入，按回车]
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
     → jsonDecode 检查：不是 'editorReady' → 继续向下
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
     → bytes = utf8.encode(body)  ← 关键：显式 UTF-8 编码
     → HTTP POST http://127.0.0.1:9876/api/rpc
       请求头: Content-Type: application/json; charset=utf-8
              Content-Length: <字节长度>

  6. Node.js: node_backend.js → HTTP /api/rpc 处理器
     → body 分片拼接 → body = '{"jsonrpc":"2.0",...,"params":{"message":"你好"}}'
     → JSON.parse(body) → { id, method:'claudeChat', params:{message:"你好"} }
     → await dispatchRpc(id, method, params)

  7. Node.js: dispatchRpc → case 'claudeChat'
     → message = params.message = "你好"
     → cfg = loadLLMConfig()
       → 读取 /data/data/com.termux/files/home/lco-workspace/llm_config.json
       → 返回 { provider:'anthropic', endpoint:'https://api.deepseek.com/anthropic',
                apiKey:'env:ANTHROPIC_API_KEY', model:'deepseek-chat' }
     → chatWithLLM(cfg, "你好", callback)

  8. Node.js: chatWithLLM → _callAnthropic
     → key = resolveApiKey(cfg) → process.env.ANTHROPIC_API_KEY = "sk-a4a8..."
     → body = JSON.stringify({ model:'deepseek-chat', max_tokens:2048,
           messages:[{role:'user',content:'你好'}] })
     → HTTPS POST api.deepseek.com/anthropic/v1/messages
       请求头: x-api-key: sk-a4a8..., anthropic-version: 2023-06-01

  9. DeepSeek API → 响应
     → { content: [{ text: "你好！有什么可以帮你的？" }] }
     → callback(null, "你好！有什么可以帮你的？")

  10. Node.js: dispatchRpc 完成
      → jsonResult(id, { response: "你好！有什么可以帮你的？" })
      → '{"jsonrpc":"2.0","id":1,"result":{"response":"你好！有什么可以帮你的？"}}'

  11. Flutter: termux_engine.dart 接收 HTTP 响应
      → raw = await response.transform(utf8.decoder).join()
      → jsonDecode(raw) → JsonRpcResponse.fromJson
      → _sendRpc 返回 JsonRpcResponse

  12. Flutter: js_bridge.dart 完成等待中的请求
      → completer.complete(response)
      → handleMessage 返回 response.encode()
      → 对响应字符串调用 jsonEncode 用于 JavaScript 注入

  13. Flutter: editor_webview.dart
      → runJavaScript("window.dispatchEvent(new CustomEvent('lco-response',
           {detail: ${jsonEncode(response)}}))")
      → jsonEncode 转义引号/换行 → 生成合法的 JS 字符串字面量

  14. 浏览器: editor.js
      → window 'lco-response' 事件触发
      → e.detail = '{"jsonrpc":"2.0","id":1,"result":{"response":"你好！..."}}'
      → JSON.parse(e.detail) → handleResponse(response)
      → pendingRequests[id].resolve(response.result)
      → sendRpc Promise 完成

  15. chat.js: .then(result)
      → updateClaudeBubble(el, result.response)
      → el.textContent = "你好！有什么可以帮你的？"
```

### 1.2 终端输入输出（完整链路追踪）

```
[用户在终端输入 'ls']
  1. xterm.onData('l')
  2. xterm.onData('s')
  3. xterm.onData('\r')
     → ws.send(JSON.stringify({ type:'input', data:'ls\r' }))

  4. Node.js: ws.on('message')
     → msg = JSON.parse(data) → { type:'input', data:'ls\r' }
     → ptyProcess.write('ls\r')

  5. bash 执行 'ls'
     → stdout: 'src  pubspec.yaml  README.md\n'
     → ptyProcess.onData('src  pubspec.yaml  README.md\n')

  6. Node.js: ptyProcess.onData 处理器
     → wsSend(ws, { type:'output', data:'src  pubspec.yaml  README.md\n' })
     → data = encodeURIComponent('src  pubspec.yaml  README.md\n')
     → json = '{"type":"output","data":"src%20%20pubspec.yaml%20%20README.md%0A"}'
     → ws.send('82|{"type":"output","data":"src%20%20pubspec.yaml%20%20README.md%0A"}')

  7. 浏览器: ws.onmessage
     → msgBuffer += '82|{"type":"output","data":"src%20%20pubspec.yaml%20%20README.md%0A"}'
     → 解析: pipeIdx=2, len=82, json 从索引 3 开始
     → JSON.parse → { type:'output', data:'src%20%20pubspec.yaml%20%20README.md%0A' }
     → decodeURIComponent → 'src  pubspec.yaml  README.md\n'
     → xterm.write('src  pubspec.yaml  README.md\n')
```

## 2. 文件操作链路

### 2.1 文件树点击 → 打开

```
file-explorer.js: 点击 'main.dart'
  → openFile('/src/main.dart', 'main.dart')
  → LCOEditor.openFile('/src/main.dart', 'dart')
  → sendRpc('readFile', { path:'/src/main.dart' })
  → ... (RPC 往返：Flutter → 后端) ...
  → result = { content:'void main() {...}', encoding:'utf-8' }
  → monaco.editor.createModel(content, 'dart', uri)
  → editor.setModel(model)
```

### 2.2 自动保存

```
editor.js: onDidChangeModelContent
  → isDirty = true
  → 1 秒防抖 → explicitSave()
  → sendRpc('saveFile', { path: model.uri.path, content: model.getValue() })
  → ... 后端写入磁盘（原子操作：临时文件→重命名）...
  → FileChangeEvent 触发 → Flutter fileChangeStream
  → editor_webview.dart 推送 'lco-file-change' CustomEvent 到 JS
  → editor.js handleFileChange → 重新读取文件 → model.setValue()
```

### 2.3 右键 → 删除

```
file-explorer.js: 右键 → Delete
  → deleteFileConfirm(fileInfo)
  → confirm("确定删除 'main.dart'？")
  → sendRpc('deleteFile', { path:'/src/main.dart' })
  → ... 后端: fs.unlinkSync(resolvedPath) ...
  → FileChangeEvent('deleted')
  → refresh() → listFiles → 重新渲染文件树
```

### 2.4 右键 → 运行

```
file-explorer.js: 右键 test.py → Run
  → runScriptFile('/test.py', 'test.py')
  → terminal.write('\x1b[1;36m▶ 运行: /test.py\x1b[0m\r\n')
  → sendRpc('runScript', { path:'/test.py' })
  → ... 后端: exec('python /path/to/test.py') ...
  → stdout → 以 'terminalOutput' 广播到终端客户端
  → terminal.js: ws.onmessage → processMessage → xterm.write(output)
```

## 3. 工作区管理

### 3.1 切换项目

```
file-explorer.js: 点击 ⇄ → openModal('switch')
  → loadProjectList()
  → sendRpc('listFiles', { dirPath:'/' })
  → 过滤目录 → 渲染 .project-item 列表
  → 用户点击 'my-project'
  → switchWorkspace('my-project')
  → sendRpc('switchWorkspace', { subFolder:'my-project' })
  → ... 后端: isPathAllowed(newRoot) → 广播 cd 到终端 → broadcastFileTreeRefresh ...
  → terminal.js: 收到 { type:'cd', path } → 发送 'cd "/path"\r' + 'clear\r' 到 PTY
  → file-explorer.js: refresh() → 从新根目录 listFiles
```

### 3.2 新建项目

```
file-explorer.js: 点击 + → openModal('new')
  → 用户输入 'my-app' → handleModalConfirm
  → sendRpc('saveFile', { path:'/my-app/.lco', content:'' })
  → ... 后端创建 my-app/ 目录 ...
  → refresh() → 树中出现新文件夹
```

### 3.3 Home 按钮

```
file-explorer.js: 点击 ⌂ → switchToHome()
  → sendRpc('switchWorkspace', { path:'' })
  → ... 后端: newRoot = PROJECT_ROOT ...
  → 终端 cd 到 PROJECT_ROOT
  → 从 PROJECT_ROOT 刷新文件树
```

## 4. 后端参考

### 4.1 服务结构

```
服务器 (http://127.0.0.1:9876)
│
├── POST /api/rpc
│   └── dispatchRpc(id, method, params) — 异步
│       ├── saveFile       → 原子写入 + 校验和
│       ├── readFile       → UTF-8 读取
│       ├── listFiles      → 目录列表
│       ├── runGitCommand  → child_process.execSync('git ...')
│       ├── deleteFile     → fs.unlinkSync / fs.rmSync
│       ├── renameFile     → fs.renameSync
│       ├── runScript      → child_process.exec → 终端输出
│       ├── switchWorkspace → 更新根目录 + 终端 cd + 广播
│       ├── claudeChat     → chatWithLLM → API 调用
│       └── updateLLMConfig → fs.writeFileSync
│
├── GET /health
│   └── { status, ptyAvailable, root, watcherActive }
│
├── WebSocket /ws/terminal
│   ├── PTY 模式: pty.spawn(bash) ← node-pty
│   ├── 回退模式: spawn(bash) ← child_process
│   └── 消息: {type:'input'}, {type:'output'}, {type:'resize'}, {type:'cd'}
│
└── WebSocket /ws/file-events
    └── fs.watch(ROOT, {recursive:true}) → 广播 {type:'fileChange',...}
```

### 4.2 路径安全

```javascript
const ALLOWED_ROOTS = [
  '/data/data/com.termux/files/home/lco-workspace',
  '/data/user/0/com.termux/lco-workspace',  // Android 符号链接别名
  '/data/data/com.termux/files/home',
  '/data/user/0/com.termux',
];

function isPathAllowed(targetPath) {
  // 1. 尝试使用 fs.realpathSync 解析符号链接
  // 2. 回退到字符串前缀匹配
  // 3. 检查是否在 ALLOWED_ROOTS 中
}
```

### 4.3 wsSend 辅助函数

```javascript
function wsSend(ws, obj) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (obj.data) obj.data = encodeURIComponent(obj.data);  // 中文安全
  const json = JSON.stringify(obj);
  ws.send(Buffer.byteLength(json, 'utf-8') + '|' + json); // 长度前缀
}
```

## 5. 前端参考

### 5.1 脚本加载顺序

```
index.html:
  1. lco.css（样式表）
  2. xterm.css（样式表）
  3. i18n.js
  4. Monaco 路径配置（内联）
  5. Monaco 引导（内联）— 异步，就绪后加载 editor.js
  6. xterm.js + 插件（本地 + CDN 回退）
  7. file-explorer.js
  8. terminal.js
  9. chat.js
```

### 5.2 全局 API

```javascript
// 加载完成后在 window 上可用的所有对象：
window.LCOEditor        // Monaco + RPC 适配器
  .sendRpc(method, params)  → Promise<result>
  .openFile(path, lang)     → Promise
  .save() / .runTest() / .toggleLocale()
  .isReady() / .isDirty()

window.LCOFileExplorer  // 文件树
  .refresh() / .openFile()

window.LCOTerminal      // xterm.js 终端
  .write(text) / .clear() / .focus()

window.LCOChat          // Claude 聊天侧边栏
  .toggle() / .show() / .hide()

window.LCO_i18n         // 国际化
  .t(key) / .setLocale(locale) / .getLocale()
```

### 5.3 聊天消息协议

```
前端 → 后端（通过 JSON-RPC）:
{ jsonrpc:'2.0', id:N, method:'claudeChat', params:{ message:string } }

后端 → 前端（通过 JSON-RPC 响应）:
{ jsonrpc:'2.0', id:N, result:{ response:string } }
// 或
{ jsonrpc:'2.0', id:N, error:{ code:int, message:string } }
```

## 6. 构建与部署

### 6.1 Flutter APK

```bash
cd LCO
flutter pub get
flutter build apk --debug
# 输出: build/app/outputs/flutter-apk/app-debug.apk
adb install build/app/outputs/flutter-apk/app-debug.apk
```

### 6.2 后端设置（一次性）

```bash
# 在 Termux 中：
pkg install clang make python binutils nodejs -y
cd ~
mkdir -p LCO/assets/server
# 将 node_backend.js 复制到 ~/LCO/assets/server/
cd ~/LCO/assets/server
npm install ws
npm install node-pty  # 可能需要: export CC=clang CXX=clang++
```

### 6.3 后端启动（每次重启）

```bash
cd ~/LCO/assets/server
bash -c 'source ~/.bashrc && exec node node_backend.js --port=9876'
termux-wake-lock  # 息屏时保持运行
```

### 6.4 API 密钥设置

```bash
# 在 Termux 中，添加到 ~/.bashrc：
echo 'export ANTHROPIC_API_KEY="sk-你的密钥"' >> ~/.bashrc
echo 'export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"' >> ~/.bashrc
source ~/.bashrc
```

## 7. 已知限制

1. **Monaco Editor 离线包**（约 117 个文件）必须在 `pubspec.yaml` 中逐个子目录声明。漏掉 `editor/` 或 `assets/` 子目录 → "Loading Monaco Editor..." 卡住。
2. **node-pty** 需要在 Termux 中进行原生 ARM64 编译。未安装 `clang`/`make` 时 `npm install node-pty` 可能失败。回退方案：`child_process.spawn('bash')`。
3. **Claude CLI**（claude-chat 提供商）是依赖 glibc 的 bash 脚本。从 `run-as` 上下文启动存在 TTY 问题。推荐使用 HTTP API 提供商（anthropic/deepseek/openai）。
4. **无线 ADB** 端口每隔几分钟过期。USB 调试在开发时更稳定。
5. **Gradle** 从 `services.gradle.org` 下载可能被墙。使用腾讯镜像 + `file://` URL 配置在 `gradle-wrapper.properties` 中。
6. **WebView 的 `file:///` 源**会阻止 CORS 和 Workers。AssetServer 单例通过 HTTP 提供服务来解决此问题。
