/// MockEngine — in-memory file storage for Phase 1 development.
///
/// Stores files under `getApplicationDocumentsDirectory()/lco-mock/`.
/// Simulates Git command output. Emits [FileChangeEvent] via a
/// [StreamController] on every [saveFile] call.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:lco/engine/ide_engine.dart';
import 'package:lco/protocol/json_rpc.dart';
import 'package:path_provider/path_provider.dart';

class MockEngine implements IDEEngine {
  late final Directory _rootDir;
  final StreamController<FileChangeEvent> _fileChangeController =
      StreamController<FileChangeEvent>.broadcast();

  int _requestId = 0;

  /// Optional explicit root directory for testing.
  /// If null, falls back to `getApplicationDocumentsDirectory()/lco-mock`.
  final Directory? rootDirectory;

  MockEngine({this.rootDirectory});

  // ---------------------------------------------------------------------------
  // IDEEngine
  // ---------------------------------------------------------------------------

  @override
  Future<void> initialize() async {
    if (rootDirectory != null) {
      _rootDir = rootDirectory!;
    } else {
      final appDir = await getApplicationDocumentsDirectory();
      _rootDir = Directory('${appDir.path}/lco-workspace');
    }
    if (!await _rootDir.exists()) {
      await _rootDir.create(recursive: true);
    }
    // Seed demo files for the file explorer.
    await _seedDemoFiles();
  }

  /// Create a small set of demo files so the file explorer is not empty.
  Future<void> _seedDemoFiles() async {
    final demos = {
      '/src/main.dart':
          "void main() {\n  print('Hello LCO!');\n}\n",
      '/src/utils.dart':
          "String greet(String name) => 'Hello, \$name!';\n",
      '/pubspec.yaml':
          "name: lco_demo\ndescription: A demo project\nversion: 0.1.0\n",
      '/README.md':
          '# LCO Demo\n\nWelcome to Lite Code On-device.\n',
      '/.gitignore':
          '*.log\n.dart_tool/\nbuild/\n',
    };
    for (final entry in demos.entries) {
      final file = _resolvePath(entry.key);
      if (!await file.exists()) {
        await file.parent.create(recursive: true);
        await file.writeAsString(entry.value, flush: true);
      }
    }
  }

  @override
  Future<JsonRpcResponse> saveFile(String path, String content) async {
    final file = _resolvePath(path);
    try {
      await file.parent.create(recursive: true);
      await file.writeAsString(content, flush: true);

      // Build a simple checksum from the content hash.
      final checksum = 'sha256:${_simpleHash(content)}';

      final response = JsonRpcResponse.success(
        id: _nextId(),
        result: {'ok': true, 'checksum': checksum},
      );

      // Emit file change notification.
      _fileChangeController.add(FileChangeEvent(
        path: path,
        type: 'modified',
      ));

      return response;
    } catch (e) {
      return JsonRpcResponse.error(
        id: _nextId(),
        code: JsonRpcErrors.internalError,
        message: 'Failed to save file: $e',
      );
    }
  }

  @override
  Future<JsonRpcResponse> readFile(String path) async {
    final file = _resolvePath(path);
    try {
      if (!await file.exists()) {
        return JsonRpcResponse.error(
          id: _nextId(),
          code: JsonRpcErrors.fileNotFound,
          message: 'File not found: $path',
        );
      }
      final content = await file.readAsString();
      return JsonRpcResponse.success(
        id: _nextId(),
        result: {'content': content, 'encoding': 'utf-8'},
      );
    } catch (e) {
      return JsonRpcResponse.error(
        id: _nextId(),
        code: JsonRpcErrors.internalError,
        message: 'Failed to read file: $e',
      );
    }
  }

  @override
  Future<JsonRpcResponse> listFiles([String? dirPath]) async {
    final dir = dirPath != null ? _resolveDir(dirPath) : _rootDir;
    try {
      if (!await dir.exists()) {
        return JsonRpcResponse.success(
          id: _nextId(),
          result: {'files': []},
        );
      }
      final entries = await dir.list().toList();
      final files = <Map<String, dynamic>>[];
      for (final entry in entries) {
        final stat = await entry.stat();
        files.add({
          'name': entry.path.split(Platform.pathSeparator).last,
          'path': _relativePath(entry.path),
          'type': stat.type == FileSystemEntityType.directory
              ? 'directory'
              : 'file',
          'size': stat.size,
          'modified': stat.modified.toIso8601String(),
        });
      }
      return JsonRpcResponse.success(
        id: _nextId(),
        result: {'files': files},
      );
    } catch (e) {
      return JsonRpcResponse.error(
        id: _nextId(),
        code: JsonRpcErrors.internalError,
        message: 'Failed to list files: $e',
      );
    }
  }

  @override
  Future<JsonRpcResponse> runGitCommand(List<String> args) async {
    // Simulate Git output for common commands.
    final command = args.join(' ');
    String stdout = '';
    String stderr = '';
    int exitCode = 0;

    if (args.isEmpty) {
      stdout = 'usage: git [--version] [--help] ...';
    } else if (args.first == 'init') {
      stdout = 'Initialized empty Git repository in ${_rootDir.path}/.git/';
    } else if (args.first == 'status') {
      stdout = 'On branch main\nnothing to commit, working tree clean';
    } else if (args.first == 'branch') {
      stdout = '* main';
    } else if (args.first == 'log') {
      stdout = 'commit abc1234 (HEAD -> main)\nAuthor: LCO <lco@local>\n'
          'Date:   ${DateTime.now().toIso8601String()}\n\n    Mock commit';
    } else if (args.first == '--version') {
      stdout = 'git version 2.42.0 (mock)';
    } else {
      stdout = '[mock] git $command completed successfully';
    }

    return JsonRpcResponse.success(
      id: _nextId(),
      result: {
        'stdout': stdout,
        'stderr': stderr,
        'exitCode': exitCode,
      },
    );
  }

  @override
  Stream<FileChangeEvent> get fileChangeStream => _fileChangeController.stream;

  @override
  Future<JsonRpcResponse> changeWorkspace(String subFolder) async {
    final newRoot = Directory('${_rootDir.path}${Platform.pathSeparator}$subFolder');
    if (!await newRoot.exists()) {
      return JsonRpcResponse.error(
        id: _nextId(),
        code: JsonRpcErrors.fileNotFound,
        message: 'Project not found: $subFolder',
      );
    }
    // For MockEngine, update the root dir to the subfolder
    _rootDir = newRoot;
    // Notify file tree refresh
    _fileChangeController.add(FileChangeEvent(path: '/', type: 'refresh'));
    return JsonRpcResponse.success(
      id: _nextId(),
      result: {'ok': true, 'workspace': subFolder, 'path': newRoot.path},
    );
  }

  @override
  Future<JsonRpcResponse> deleteFile(String path) async {
    final file = _resolvePath(path);
    try {
      if (!await file.exists()) {
        final dir = Directory(file.path);
        if (!await dir.exists()) {
          return JsonRpcResponse.error(
            id: _nextId(),
            code: JsonRpcErrors.fileNotFound,
            message: 'File not found: $path',
          );
        }
        await dir.delete(recursive: true);
      } else {
        await file.delete();
      }
      _fileChangeController.add(FileChangeEvent(path: path, type: 'deleted'));
      return JsonRpcResponse.success(id: _nextId(), result: {'ok': true, 'path': path});
    } catch (e) {
      return JsonRpcResponse.error(id: _nextId(), code: JsonRpcErrors.internalError, message: 'Delete failed: $e');
    }
  }

  @override
  Future<JsonRpcResponse> renameFile(String oldPath, String newPath) async {
    final old = _resolvePath(oldPath);
    final newF = _resolvePath(newPath);
    try {
      if (!await old.exists()) {
        return JsonRpcResponse.error(id: _nextId(), code: JsonRpcErrors.fileNotFound, message: 'File not found: $oldPath');
      }
      if (await newF.exists()) {
        return JsonRpcResponse.error(id: _nextId(), code: JsonRpcErrors.invalidParams, message: 'Target exists: $newPath');
      }
      await old.rename(newF.path);
      _fileChangeController.add(FileChangeEvent(path: oldPath, type: 'deleted'));
      _fileChangeController.add(FileChangeEvent(path: newPath, type: 'created'));
      return JsonRpcResponse.success(id: _nextId(), result: {'ok': true, 'oldPath': oldPath, 'newPath': newPath});
    } catch (e) {
      return JsonRpcResponse.error(id: _nextId(), code: JsonRpcErrors.internalError, message: 'Rename failed: $e');
    }
  }

  @override
  Future<JsonRpcResponse> runScript(String path) async {
    return JsonRpcResponse.success(id: _nextId(), result: {
      'ok': true, 'path': path,
      'stdout': '[MockEngine] Script execution simulated: $path\n',
    });
  }

  @override
  Future<void> dispose() async {
    await _fileChangeController.close();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  File _resolvePath(String relativePath) {
    // Normalize: strip leading slash, use platform separator.
    final normalized = relativePath.replaceFirst(RegExp(r'^[/\\]+'), '');
    return File('${_rootDir.path}${Platform.pathSeparator}$normalized');
  }

  Directory _resolveDir(String relativePath) {
    final normalized = relativePath.replaceFirst(RegExp(r'^[/\\]+'), '');
    return Directory('${_rootDir.path}${Platform.pathSeparator}$normalized');
  }

  String _relativePath(String absolutePath) {
    final rootPath = _rootDir.path;
    if (absolutePath.startsWith(rootPath)) {
      return absolutePath.substring(rootPath.length).replaceAll('\\', '/');
    }
    return absolutePath;
  }

  int _nextId() => ++_requestId;

  /// Simple non-cryptographic hash for checksum generation.
  String _simpleHash(String input) {
    var hash = 0;
    for (var i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.codeUnitAt(i)) & 0xFFFFFFFF;
    }
    return hash.toRadixString(16);
  }
}
