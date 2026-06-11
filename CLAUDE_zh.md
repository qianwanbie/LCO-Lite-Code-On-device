# CLAUDE.md — LCO（轻量级设备端代码编辑器）

## 项目简介

全栈 Android IDE。Flutter 应用在 WebView 中嵌入 Monaco Editor + xterm.js。Node.js 后端在 Termux 中运行，提供 PTY 终端、文件 I/O、Git 和 LLM 聊天功能。前后端通过 HTTP 上的 JSON-RPC 2.0 和 WebSocket 进行通信。

## 如何运行

**Flutter 应用（一次性）：**
```bash
flutter pub get && flutter build apk --debug
adb install build/app/outputs/flutter-apk/app-debug.apk
```

**后端（每次重启后，在 Termux 中执行）：**
```bash
cd ~/LCO/assets/server
bash -c 'source ~/.bashrc && exec node node_backend.js --port=9876'
```

必须 `source ~/.bashrc`——它会加载 `ANTHROPIC_API_KEY`（通过兼容 Anthropic 的接口调用 DeepSeek）。

## 架构（简化版）

```
用户在聊天侧边栏点击"发送"
  → chat.js 调用 LCOEditor.sendRpc('claudeChat', {message: "你好"})
  → editor.js JSON.stringify → LCOBridge.postMessage（JavaScript 通道）
  → Flutter JSBridge.handleMessage → _dispatchToEngine → TermuxEngine.claudeChat
  → HTTP POST http://127.0.0.1:9876/api/rpc（UTF-8 编码的请求体）
  → node_backend.js dispatchRpc → loadLLMConfig → chatWithLLM
  → HTTPS 请求到 api.deepseek.com/anthropic
  → 响应沿 JSON-RPC 原路返回 → Flutter → CustomEvent → chat.js 聊天气泡
```

## 源码地图

| 文件 | 作用 |
|---|---|
| `lib/main.dart` | 应用入口。`SystemChrome.immersiveSticky` 全屏，创建 `TermuxEngine`，启动 `EditorWebView` |
| `lib/engine/ide_engine.dart` | 抽象接口：10 个异步方法 + `fileChangeStream` |
| `lib/engine/termux_engine.dart` | 通过 `dart:io` HttpClient 将所有 RPC 调用代理到 `http://127.0.0.1:9876/api/rpc`。阅读此文件可了解 Flutter→后端的通信机制。 |
| `lib/engine/mock_engine.dart` | 第一阶段开发引擎。文件存储在 `getApplicationDocumentsDirectory()/lco-workspace/`。自动创建演示文件。生产环境不使用——`main.dart` 使用的是 `TermuxEngine`。 |
| `lib/protocol/json_rpc.dart` | `JsonRpcRequest`、`JsonRpcResponse`、`JsonRpcError`、`FileChangeEvent`。均含 `toJson()`/`fromJson()`。错误码：-32700 解析错误，-32601 方法未找到，-32602 参数无效，-32001 权限拒绝，-32002 文件未找到，-32603 内部错误。 |
| `lib/webview/asset_server.dart` | **单例** HTTP 服务器，监听 `127.0.0.1:随机端口`。提供 `pubspec.yaml` 中声明的所有资源文件。关键作用：如果没有它，WebView 的 `file:///` 源会阻止 CORS 和 Web Workers。`_isTextAsset()` 确保返回正确的 MIME 类型。 |
| `lib/webview/editor_webview.dart` | WebView 容器。`_startServerAndLoad()` → 启动 AssetServer → `loadRequest(http://127.0.0.1:PORT/index.html)`。`_onJsMessage` 处理 `editorReady`（隐藏 Flutter 加载遮罩）并分发 JSON-RPC。`_onConsoleMessage` 将所有 JS 控制台输出转发到 Flutter `debugPrint`。 |
| `lib/webview/js_bridge.dart` | JSON-RPC 消息路由。`_normalizePath()` 去除前导 `/`，阻止 `..`，合并斜杠。`_dispatchToEngine()` 用 switch-case 将方法名映射到引擎调用。**如果后端新增了 RPC 方法，必须在此处同步添加。** |
| `lib/models/file_model.dart` | `FileInfo`（名称、路径、类型、大小、修改时间）、`FileTree`、`FileType` 枚举。 |
| `assets/index.html` | 三栏布局。Monaco 引导：本地 `loader.js` → CDN 回退 → `require(['vs/editor/editor.main'])` → 隐藏加载遮罩 → 加载 `editor.js`。工作区栏、聊天侧边栏、模态对话框。xterm.js 本地优先 + CDN 回退。 |
| `assets/js/editor.js` | Monaco 初始化 + RPC 适配器。`sendRpc()` 自增 ID + 30 秒超时。`window.LCOEditor` 公开 API：`openFile()`、`save()`、`runTest()`、`toggleLocale()`。内容变更自动保存（1 秒防抖）、Ctrl+S、失焦保存。Workers 通过 `getWorkerUrl()` 使用相对路径。 |
| `assets/js/file-explorer.js` | 文件树渲染器。异步 `listFiles` RPC → 排序树节点（目录优先）。点击 → `LCOEditor.openFile()`。右键菜单：打开、复制路径、Git Status/Log/Add、**Run**、**Rename**、**Delete**、刷新。工作区栏：Home(⌂)、新建(+)、切换(⇄)、Claude 徽章(⌬)。 |
| `assets/js/terminal.js` | xterm.js 5.5 + FitAddon + WebLinksAddon。WebSocket `ws://127.0.0.1:9876/ws/terminal`。缓冲区重组长度和直接 JSON 两种格式的分片帧。解码 `encodeURIComponent` 数据。处理 `cd` 和 `terminalOutput` 服务端消息。最多重连 5 次。 |
| `assets/js/chat.js` | Claude 聊天侧边栏。`window.LCOChat.toggle/show/hide`。发送 `claudeChat` RPC。渲染用户/claude/系统气泡。回车发送，Shift+回车换行。 |
| `assets/js/i18n.js` | 中英文消息。`t(key)`、`setLocale()`、`getLocale()`。触发 `lco-locale-changed` 事件。 |
| `assets/css/lco.css` | 完整布局样式。CSS 变量主题系统。Flexbox 三栏布局。拖拽调整大小手柄（鼠标+触摸）。树节点、右键菜单、模态框、聊天气泡、工作区栏、工具栏、状态栏。 |
| `assets/server/node_backend.js` | **整个后端。** HTTP `/api/rpc` 分发 11 个方法。WebSocket `/ws/terminal`（node-pty PTY 或 child_process.spawn 回退）。WebSocket `/ws/file-events`（fs.watch）。`wsSend()` 辅助函数：长度前缀 + `encodeURIComponent` 确保中文安全。LLM 适配器：anthropic/deepseek/openai/claude-cli 四种提供商。 |
| `assets/vendor/xterm/` | xterm.js 5.5.0 + addon-fit 0.10.0 + addon-web-links 0.11.0。离线包。 |
| `assets/monaco-editor/min/vs/` | Monaco Editor 0.55.1 离线包。loader.js、editor.main.js/css、5 个 worker 文件、30+ 语言模块。 |

## 所有 RPC 方法

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `saveFile` | `{path, content}` | `{ok, checksum}` | 原子写入（临时文件→重命名） |
| `readFile` | `{path}` | `{content, encoding}` | UTF-8 编码读取 |
| `listFiles` | `{dirPath?}` | `{files: [{name,path,type,size,modified}]}` | 排序，目录在前 |
| `runGitCommand` | `{args: []}` | `{stdout, stderr, exitCode}` | clone/init 触发 fileTreeRefresh |
| `deleteFile` | `{path}` | `{ok, path}` | 目录递归删除 |
| `renameFile` | `{oldPath, newPath}` | `{ok, oldPath, newPath}` | 检查目标不存在 |
| `runScript` | `{path}` | `{ok, path, running}` | .py/.js/.sh/.dart → exec → 终端输出 |
| `switchWorkspace` | `{path? subFolder?}` | `{ok, workspace, path}` | 终端 cd + 广播刷新 |
| `changeWorkspace` | `{subFolder}` | 同上 | 旧版别名 |
| `claudeChat` | `{message}` | `{response}` | LLM 适配器 → API 调用 |
| `updateLLMConfig` | `{config}` | `{ok, path}` | 写入 llm_config.json |

## 后端启动与环境变量

服务器必须通过 bash 启动以继承 `.bashrc` 中的 API 密钥：
```bash
bash -c 'source /data/data/com.termux/files/home/.bashrc && exec node node_backend.js --port=9876'
```

`.bashrc` 需包含：
```bash
export ANTHROPIC_API_KEY="sk-..."
export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
```

## 工作区

`PROJECT_ROOT` = `/data/data/com.termux/files/home/lco-workspace/`

所有文件操作都被沙盒在此目录内。`ALLOWED_ROOTS` 同时接受 `/data/data/` 和 `/data/user/0/` 前缀（Android 将它们符号链接到同一位置）。`isPathAllowed()` 使用 `fs.realpathSync()` 进行符号链接感知的路径比较。路径穿越（`..`）被 `resolvePath()` 阻止。

## LLM 适配器

通过 `lco-workspace/llm_config.json` 配置：
```json
{
  "provider": "anthropic",
  "endpoint": "https://api.deepseek.com/anthropic",
  "apiKey": "env:ANTHROPIC_API_KEY",
  "model": "deepseek-chat"
}
```

支持的提供商：
- `anthropic` → POST /v1/messages，使用 `x-api-key` 请求头
- `deepseek` / `openai` → POST /v1/chat/completions，使用 `Authorization: Bearer`
- `claude-cli` → 启动 `/data/data/com.termux/files/usr/bin/claude`（bash 脚本，需要 glibc）

API 密钥：`env:变量名` → 读取 `process.env[变量名]`。也可以直接填写密钥。

## 关键设计决策

1. **AssetServer 是单例。** 每个应用只有一个 HTTP 服务器。没有它，Android WebView 的 `file:///` 源会阻止 CORS 和 Web Workers。
2. **JSBridge 规范化所有路径。** 去除前导 `/`，阻止 `..`。JSBridge 和后端各自独立进行路径验证。
3. **后端大部分方法同步分发，claudeChat 异步。** `dispatchRpc` 是 `async` 的，因为 `claudeChat` 使用了 `await new Promise` 包裹 spawn/HTTP。
4. **所有 WebView 控制台 → Flutter debugPrint。** `onConsoleMessage` 处理器转发所有 JS 日志。对设备调试至关重要。
5. **加载遮罩通过两种方式隐藏。** HTML 的 `onReady()` 用 `style.display='none'` 隐藏 HTML 遮罩。Flutter 的 `editorReady` 通知设置 `_isEditorReady=true` 移除 Flutter 的 `CircularProgressIndicator`。
6. **xterm.js 和 Monaco 本地打包。** CDN 仅作回退。两者均在 `pubspec.yaml` 资源中声明。
7. **WebSocket 使用长度前缀 + URI 编码。** `wsSend()` 将每条消息包装为 `长度|JSON`。terminal.js 的缓冲区重组长分片帧。`encodeURIComponent`/`decodeURIComponent` 保护中文字符。
8. **TermuxEngine 显式使用 UTF-8 编码 HTTP 请求体。** `utf8.encode(body)` + `Content-Length` 请求头。中文文本要在 Flutter→后端传输中存活，此步骤必不可少。

## 构建配置

```yaml
# pubspec.yaml（关键依赖）
webview_flutter: ^4.13.1
path_provider: ^2.1.5
permission_handler: ^11.4.0
```

```
# android/app/build.gradle
compileSdk: 36, targetSdk: 36, minSdk: 24
ndkVersion: "28.2.13676358"
```

```
# android/settings.gradle
AGP: 8.11.1, Kotlin: 2.2.20
```

```
# android/gradle/wrapper/gradle-wrapper.properties
Gradle: 8.14（本地 file:// URL，通过腾讯镜像下载）
```

## 常见问题与修复

1. **"Loading Monaco Editor..." 卡住** → Monaco 文件未打包进 APK。检查 `pubspec.yaml` 资源声明是否包含所有子目录。
2. **RPC 错误 -32601** → 方法未在 JSBridge 的 `_dispatchToEngine()` switch 中注册。添加对应 case。
3. **RPC 错误 -32001** → 路径不在 `ALLOWED_ROOTS` 中。检查 `isPathAllowed()`。
4. **聊天返回超时** → API 密钥缺失。确保服务器用 `source ~/.bashrc` 启动。
5. **中文乱码** → 检查 TermuxEngine 中的 `utf8.encode`，后端的 `wsSend` encodeURIComponent。
6. **Gradle 下载失败** → 使用腾讯镜像：`https://mirrors.cloud.tencent.com/gradle/gradle-X.Y-all.zip` → file:// URL。
