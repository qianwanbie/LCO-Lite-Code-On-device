# LCO — 技术参考手册

## 1. 项目总览

LCO 是一个全栈 Android IDE：Flutter 外壳 → WebView（Monaco Editor + xterm.js）→ JSON-RPC 2.0 + WebSocket → 运行在 Termux 中的 Node.js 后端。在 Android 平板设备上提供完整的代码编辑环境，具备文件管理、Git 集成、交互式终端和 AI 聊天功能。

### 关键数字
- 14 个 JSON-RPC 方法
- 4 个 LLM 提供商（Anthropic/DeepSeek/OpenAI/Claude-CLI）
- 2 个 WebSocket 通道（/ws/terminal、/ws/file-events）
- 30+ Monaco 语言模块离线打包
- 6 个 MockEngine 契约单元测试
- 约 43 个源代码文件（不含第三方库）

---

## 2. 架构层级

### 2.1 Flutter 层（Dart）

**入口**（`lib/main.dart`）：
- `SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky)` 实现全屏
- 创建 `TermuxEngine()`，将所有 RPC 代理到 Node.js 后端
- `MaterialApp` 暗色主题 → `EditorWebView(engine)`

**IDEEngine 接口**（`lib/engine/ide_engine.dart`）：11 个异步方法 + fileChangeStream + initialize/dispose

**TermuxEngine**（`lib/engine/termux_engine.dart`）：
- 所有 RPC 方法调用 `_sendRpc(method, params)`：
  1. `jsonEncode` 请求
  2. `utf8.encode(body)` 显式 UTF-8 编码
  3. HTTP POST 到 `http://127.0.0.1:9876/api/rpc`
  4. 解析 JSON 响应 → `JsonRpcResponse`

**MockEngine**（`lib/engine/mock_engine.dart`）：阶段一开发使用，生产不用。

**JSON-RPC 协议**（`lib/protocol/json_rpc.dart`）：请求/响应/错误/文件变更事件模型，含序列化方法。

**AssetServer**（`lib/webview/asset_server.dart`）：单例 HTTP 服务器，解决 WebView `file:///` 下的 CORS 和 Worker 限制。

**EditorWebView**（`lib/webview/editor_webview.dart`）：WebView 容器，LCOBridge 通道，控制台日志转发。

**JSBridge**（`lib/webview/js_bridge.dart`）：JSON-RPC 路由，路径规范化，方法分发。

### 2.2 WebView 前端（HTML/CSS/JS）

**index.html**：三栏 flex 布局、Monaco/xterm 引导、工作区栏、聊天侧边栏、模态框、拖拽调整大小。

**editor.js**：Monaco 初始化 + RPC 适配器 + 自动保存。`window.LCOEditor` 公开 API。

**file-explorer.js**：文件树渲染，右键菜单（Git/删除/重命名/运行），工作区管理（⌂新建/切换/Claude徽章）。

**terminal.js**：xterm.js 5.5 + WebSocket 缓冲区重组 + URI 解码 + 5 次重连。

**chat.js**：Claude 聊天侧边栏，通过 JSON-RPC 通信，气泡 UI。

**i18n.js**：中英文切换。

**lco.css**：CSS 变量主题系统、Flexbox 布局、拖拽手柄、树节点、右键菜单、模态框、聊天气泡、自定义滚动条。

### 2.3 Node.js 后端（`assets/server/node_backend.js`）

**服务结构**：
```
http://127.0.0.1:9876
├── POST /api/rpc → dispatchRpc（异步，11 方法 + 4 工具别名）
├── GET /health
├── WebSocket /ws/terminal → PTY bash 终端
├── WebSocket /ws/file-events → 文件变更推送
```

**LLM 适配器**：从 `llm_config.json` 读取配置，支持 anthropic/deepseek/openai/claude-cli。

**自动执行代码块**：`file:` 创建文件、`shell:` 运行命令、`read:` 读取文件。

**终端 WebSocket**：node-pty（PTY 模式）或 child_process.spawn（回退模式）。wsSend() 长度前缀 + URI 编码。

**路径安全**：ALLOWED_ROOTS、isPathAllowed（符号链接感知）、resolvePath（阻止 ..）。

**PROJECT_ROOT**：`/data/data/com.termux/files/home/lco-workspace/`

**工作区上下文注入**：每条聊天消息自动前缀文件树快照 + 可用工具。

---

## 3. 通信协议

### 3.1 JSON-RPC 2.0（聊天 + 文件操作）

聊天消息完整链路（15 步）：chat.js → JSON.stringify → LCOBridge → Flutter JSBridge → TermuxEngine → HTTP POST → 后端 → LLM API → 响应原路返回 → chat.js 气泡。

### 3.2 WebSocket（终端）

xterm.onData → ws.send → 后端 PTY → bash → PTY 输出 → wsSend（长度前缀+URI编码）→ terminal.js 缓冲区重组 → xterm.write

---

## 4. UI 布局

三栏：左侧文件树 + 工作区栏 | 中间 Monaco 编辑器 + 底部终端 | 右侧聊天侧边栏。右上角浮动工具栏。底部状态栏。

---

## 5. 构建与部署

### Flutter APK
```bash
flutter pub get && flutter build apk --debug
adb install build/app/outputs/flutter-apk/app-debug.apk
```

### Gradle 配置
gradle-wrapper: 8.14（file://），AGP 8.11.1，Kotlin 2.2.20，compileSdk 36，NDK 28.2

### 后端（Termux 一次性设置）
```bash
pkg install clang make python binutils nodejs proot-distro -y
cd ~/LCO/assets/server && npm install ws node-pty
```

### 后端启动（每次重启）
```bash
cd ~/LCO/assets/server
bash -c 'source ~/.bashrc && exec node node_backend.js --port=9876'
termux-wake-lock
```

---

## 6. 双通道聊天策略（最终方案）

**方案 A — 聊天侧边栏（LLM 适配器）** ✅ 生产使用
- 通过 JSON-RPC → 后端 → HTTP API 调用
- 优点：稳定，无需 glibc/proot，支持 file:/shell:/read: 自动执行
- 缺点：非交互式（单轮对话）

**方案 B — 终端 CLI** ✅ 已可用
- 在 PTY 终端中输入 `claude` 即可使用完整 Claude Code
- 需要在 .bashrc 中配置 API 密钥

**方案 C — WebSocket Claude PTY** ⚠️ 实验阶段
- 后端通过 node-pty 启动 Claude 进行流式 I/O
- 已验证：Claude 二进制在 proot-distro Ubuntu 中能正常运行并返回正确结果
- 待解决：spawn + proot-distro 的 stdin/stdout 管道集成

---

## 7. 安全

- resolvePath：阻止 `..` 路径穿越
- isPathAllowed：fs.realpathSync 符号链接感知路径比较
- 所有服务仅绑定 127.0.0.1
- AssetServer 仅提供 APK 内资源（只读）

## 8. 测试

6 个单元测试（mock_engine_test.dart）：saveFile、readFile、readFile 错误、FileChangeEvent 发射、listFiles、runGitCommand。使用可注入 rootDirectory 进行隔离测试。
