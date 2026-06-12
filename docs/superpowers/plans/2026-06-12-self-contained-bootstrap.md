# LCO Self-Contained Bootstrap Plan

## Phase 1: Bundle Node.js ARM64 (immediate)

### 1.1 Download Pre-compiled Node.js
Node.js provides official ARM64 Linux binaries. On Android (which uses bionic libc, not glibc), we use the Termux-compiled Node.js binary.

**Source**: Extract the existing Node.js binary from Termux on the device:
```bash
# Already at /data/data/com.termux/files/usr/bin/node
# Size: ~40MB
```

Package it into APK assets:
```
assets/bin/node        # Node.js ARM64 binary
assets/bin/node_modules.tar.gz  # node_modules (ws, node-pty)
assets/server/node_backend.js   # Already present
```

### 1.2 Bootstrap Manager (`lib/engine/bootstrap.dart`)

```dart
class LCOBootstrap {
  static Future<String> get binDir async {
    final dir = Directory('${(await getApplicationDocumentsDirectory()).path}/bin');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir.path;
  }

  static Future<String> get nodePath async {
    final nodePath = '${await binDir}/node';
    if (!File(nodePath).existsSync()) {
      // Extract from APK assets
      final data = await rootBundle.load('assets/bin/node');
      await File(nodePath).writeAsBytes(data.buffer.asUint8List());
      // Make executable
      await Process.run('chmod', ['+x', nodePath]);
    }
    return nodePath;
  }

  static Future<void> ensureEnvironment() async {
    final node = await nodePath;
    // Extract node_modules if missing
    final modulesDir = Directory('${await binDir}/node_modules');
    if (!await modulesDir.exists()) {
      // Extract tar.gz from assets
      await _extractAsset('assets/bin/node_modules.tar.gz', await binDir);
    }
  }
}
```

### 1.3 Backend Launcher

Replace TermuxEngine with direct Node.js process:
```dart
// In main.dart
final nodePath = await LCOBootstrap.nodePath;
final serverScript = 'assets/server/node_backend.js'; // from rootBundle
Process.start(nodePath, [serverScript, '--port=9876']);
```

### 1.4 pubspec.yaml Changes
```yaml
assets:
  - assets/bin/node
  - assets/bin/node_modules.tar.gz
```

## Phase 2: PTY Terminal (node-pty)

node-pty is a native Node.js addon (.node file). It must be compiled for android-arm64.
- Extract existing `.node` from Termux installation
- Place in `assets/bin/node_modules/node-pty/build/Release/pty.node`
- Or: use `child_process.spawn('sh')` as fallback (already implemented)

## Phase 3: Git (Optional)

Git is a large binary (~20MB). For Phase 1:
- `runGitCommand` returns helpful error if git not available
- User can install Termux manually for git support

## Phase 4: What Stays in Termux (Optional Extras)

| Feature | Without Termux | With Termux |
|---|---|---|
| Backend | ✅ Bundled Node.js | Same |
| Terminal (PTY) | ✅ node-pty or sh | Same |
| File operations | ✅ Built-in | Same |
| Git | ❌ Not available | ✅ git |
| Python/Ruby | ❌ Not available | ✅ from Termux |
| Claude CLI | ❌ Not available | ✅ claude |
| LLM Chat | ✅ HTTP API adapter | ✅ |

---

## Implementation Steps (Send to Claude Code)

### 任务：实现 LCO 自包含启动引擎

1. **提取 Node.js 二进制**：
   - 从平板的 Termux 中复制 `/data/data/com.termux/files/usr/bin/node` 到项目 `assets/bin/node`
   - 从服务器目录复制 `node_modules/` 打包为 `assets/bin/node_modules.tar.gz`
   - 更新 `pubspec.yaml` 声明这两个资源

2. **创建 Bootstrap 模块** (`lib/engine/bootstrap.dart`)：
   - `ensureBinDir()` — 确保 `files/bin/` 存在
   - `ensureNode()` — 首次启动时从 APK 提取 node 二进制 + chmod
   - `ensureModules()` — 解压 node_modules
   - `startBackend()` — 启动 Node.js 进程，传入 `--port=9876 --root=<workspace>`

3. **改造 main.dart**：
   - 先调用 `LCOBootstrap.ensureEnvironment()`
   - 用 `Process.start(node, [serverScript, ...])` 替代手动启动
   - 健康检查：轮询 `http://127.0.0.1:9876/health` 直到就绪

4. **回退方案**：
   - 如果 Termux 已安装 → 使用 Termux 的 Node.js（当前行为）
   - 如果 Termux 未安装 → 使用 APK 内置的 Node.js（新模式）

5. **工作区路径调整**：
   - 使用 `getApplicationDocumentsDirectory()/lco-workspace/` 作为默认工作区
   - 替代硬编码的 Termux 路径
