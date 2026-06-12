# CLAUDE.md — LCO（轻量级设备端代码编辑器）

全栈 Android IDE。Flutter 在 WebView 中嵌入 Monaco Editor + xterm.js。Node.js 后端在 Termux 中运行，提供 PTY 终端、文件 I/O、Git 和 LLM 聊天功能。聊天支持自动创建文件——当 Claude 输出 ``file:path`` 代码块时，后端自动写入磁盘并刷新文件树。

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

## 源码地图

| 文件 | 作用 |
|---|---|
| `lib/main.dart` | 入口，全屏沉浸式，初始化 TermuxEngine |
| `lib/engine/ide_engine.dart` | 抽象接口：11 个异步方法 + fileChangeStream |
| `lib/engine/termux_engine.dart` | HTTP 代理到后端，显式 UTF-8 编码支持中文 |
| `lib/engine/mock_engine.dart` | 阶段一开发引擎，临时目录 + 种子文件，生产不使用 |
| `lib/protocol/json_rpc.dart` | JsonRpcRequest/Response/Error、FileChangeEvent、错误码 |
| `lib/webview/asset_server.dart` | **单例** HTTP 服务器，解决 WebView file:/// CORS/Worker 问题 |
| `lib/webview/editor_webview.dart` | WebView 容器，LCOBridge 通道，控制台→debugPrint 转发 |
| `lib/webview/js_bridge.dart` | JSON-RPC 路由，_normalizePath() 去除前导 / 并阻止 .. |
| `lib/models/file_model.dart` | FileInfo、FileTree、FileType 枚举 |
| `assets/index.html` | 三栏布局，Monaco/xterm 引导，工作区栏，聊天侧边栏 |
| `assets/js/editor.js` | Monaco 初始化 + RPC 适配器 + 自动保存（1 秒防抖）+ Ctrl+S/失焦 |
| `assets/js/file-explorer.js` | 树渲染器，点击→打开，右键菜单（Git/删除/重命名/运行），工作区栏 |
| `assets/js/terminal.js` | xterm.js 5.5 + WebSocket 缓冲区重组 + URI 解码 |
| `assets/js/chat.js` | Claude 聊天侧边栏，发送 claudeChat RPC，渲染气泡 |
| `assets/js/i18n.js` | 中英文消息，setLocale/切换语言 |
| `assets/css/lco.css` | 完整布局，CSS 变量，拖拽调整大小，模态框，聊天气泡 |
| `assets/server/node_backend.js` | **整个后端。** 14 个 RPC 方法 + PTY 终端 + WebSocket + LLM 适配器 + 自动文件创建 |
| `assets/vendor/xterm/` | xterm.js 5.5 离线包（本地优先，CDN 回退） |
| `assets/monaco-editor/min/vs/` | Monaco 0.55.1 离线包 |

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Flutter 应用 (APK)                        │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ WebView (http://127.0.0.1:PORT/)                         ││
│  │ ┌──────────┬────────────────────┬──────────────────────┐ ││
│  │ │ 文件树   │   Monaco 编辑器     │  聊天侧边栏 (RPC)    │ ││
│  │ │ + 工作区 │                    │  或终端 (CLI)        │ ││
│  │ └──────────┴────────────────────┴──────────────────────┘ ││
│  └──────────────────────┬───────────────────────────────────┘│
│                         │ LCOBridge (JSON-RPC 2.0)           │
│  ┌──────────────────────▼───────────────────────────────────┐│
│  │  JSBridge → TermuxEngine (HTTP POST /api/rpc, UTF-8)     ││
│  │  AssetServer (单例 HTTP 服务器)                          ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
          │ HTTP /api/rpc          │ WebSocket /ws/terminal
          │                        │ WebSocket /ws/file-events
          ▼                        ▼
┌──────────────────────────────────────────────────────────────┐
│              Node.js 后端 (Termux, 端口 9876)                 │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  HTTP POST /api/rpc                                      ││
│  │  ├── saveFile, readFile, listFiles, runGitCommand        ││
│  │  ├── deleteFile, renameFile, runScript                    ││
│  │  ├── switchWorkspace, mkdir, updateLLMConfig             ││
│  │  └── claudeChat → loadLLMConfig → chatWithLLM            ││
│  │       └── 自动执行: ```file:``` ```shell:``` ```read:``` ││
│  ├── WebSocket /ws/terminal → node-pty bash PTY              ││
│  ├── WebSocket /ws/file-events → fs.watch                    ││
│  └── PROJECT_ROOT: /data/data/com.termux/files/home/         ││
│                     lco-workspace/                           ││
└──────────────────────────────────────────────────────────────┘
```

## 所有 RPC 方法（共 14 个）

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `saveFile` | `{path, content}` | `{ok, checksum}` | 原子写入（临时→重命名） |
| `readFile` | `{path}` | `{content, encoding}` | UTF-8 读取 |
| `listFiles` | `{dirPath?}` | `{files: [{name,path,type,size,modified}]}` | 排序，目录在前 |
| `runGitCommand` | `{args: []}` | `{stdout, stderr, exitCode}` | clone/init→广播刷新 |
| `deleteFile` | `{path}` | `{ok, path}` | 目录递归删除 |
| `renameFile` | `{oldPath, newPath}` | `{ok, oldPath, newPath}` | 检查目标不存在 |
| `runScript` | `{path}` | `{ok, path, running}` | .py/.js/.sh/.dart→exec→终端 |
| `switchWorkspace` | `{path?\|subFolder?}` | `{ok, workspace, path}` | 终端 cd + 广播树刷新 |
| `mkdir` | `{path}` | `{ok, path}` | 创建目录 |
| `claudeChat` | `{message}` | `{response}` | LLM 适配器 + 工作区上下文 |
| `updateLLMConfig` | `{config}` | `{ok, path}` | 保存 llm_config.json |
| `tools.writeFile` | `{path, content}` | → saveFile | MCP 别名 |
| `tools.readFile` | `{path}` | → readFile | MCP 别名 |
| `tools.listDirectory` | `{path}` | → listFiles | MCP 别名 |
| `tools.mkdir` | `{path}` | → mkdir | MCP 别名 |

## 双通道聊天策略

**聊天侧边栏（⌬ 按钮）** → JSON-RPC `claudeChat` → LLM 适配器 → DeepSeek/Anthropic/OpenAI API
- 稳定可靠，自动执行 file:/shell:/read: 代码块
- 工作区上下文（文件树）自动注入到提示词中

**终端** → PTY bash → 输入 `claude` 获取完整交互式 Claude Code CLI
- 与桌面版 Claude Code 完全相同的体验
- 需要在 .bashrc 中配置 API 密钥：`export ANTHROPIC_API_KEY="sk-..."`

## LLM 适配器

配置文件：`lco-workspace/llm_config.json`
```json
{
  "provider": "anthropic",
  "endpoint": "https://api.deepseek.com/anthropic",
  "apiKey": "env:ANTHROPIC_API_KEY",
  "model": "deepseek-chat"
}
```
提供商：`anthropic`、`deepseek`、`openai`、`claude-cli`。密钥通过 `env:变量名` 读取环境变量。

## 自动文件创建

Claude 回复中的特殊代码块解析：
- `` ```file:路径\n内容``` `` → 写入文件，刷新文件树
- `` ```shell:命令``` `` → 执行，显示输出
- `` ```read:路径``` `` → 读取文件，显示内容

## 路径安全

`ALLOWED_ROOTS`：`/data/data/` 和 `/data/user/0/` 前缀。`isPathAllowed()` 使用 `fs.realpathSync` 进行符号链接感知的路径比较。`resolvePath()` 阻止 `..` 路径穿越。

## 构建配置

Flutter 3.44.1，compileSdk 36，Gradle 8.14，AGP 8.11.1，Kotlin 2.2.20，Monaco 0.55.1（本地），xterm.js 5.5.0（本地），node-pty 1.1.0（ARM64 原生）。

## 常见问题

1. **Loading Monaco 卡住** → Monaco 子目录未在 pubspec.yaml 资源中声明
2. **RPC -32601** → 方法未在 JSBridge _dispatchToEngine() switch 中注册
3. **中文乱码** → 检查 TermuxEngine 中的 utf8.encode，wsSend 中的 encodeURIComponent
4. **聊天超时** → API 密钥缺失；启动服务器时使用 `source ~/.bashrc`
5. **Gradle 下载失败** → 腾讯镜像 + file:// URL
6. **WebView file:/// CORS** → AssetServer 单例通过 HTTP 提供服务
