/// Abstract interface for the IDE backend engine.
///
/// All engine implementations ([MockEngine], [TermuxEngine]) must implement
/// this interface. The UI layer must never depend on a concrete engine type —
/// only on [IDEEngine].
library;

import 'package:lco/protocol/json_rpc.dart';

/// Abstract engine that handles file I/O, Git commands, and file change
/// notifications.
abstract class IDEEngine {
  /// Save file content to [path]. Returns a success response with a checksum.
  Future<JsonRpcResponse> saveFile(String path, String content);

  /// Read file content from [path].
  Future<JsonRpcResponse> readFile(String path);

  /// List files under [dirPath]. If [dirPath] is null, lists the project root.
  Future<JsonRpcResponse> listFiles([String? dirPath]);

  /// Execute a Git command with the given [args].
  /// The first argument is the subcommand (e.g. 'init', 'status', 'commit').
  Future<JsonRpcResponse> runGitCommand(List<String> args);

  /// Change the active workspace subfolder.
  Future<JsonRpcResponse> changeWorkspace(String subFolder);

  /// Delete a file or directory.
  Future<JsonRpcResponse> deleteFile(String path);

  /// Rename a file or directory.
  Future<JsonRpcResponse> renameFile(String oldPath, String newPath);

  /// Run a script file.
  Future<JsonRpcResponse> runScript(String path);

  /// Execute a Claude chat message.
  Future<JsonRpcResponse> claudeChat(String message);

  /// Update LLM provider configuration.
  Future<JsonRpcResponse> updateLLMConfig(Map<String, dynamic> config);

  /// Open a URL in the device browser.
  Future<JsonRpcResponse> openUrl(String url);

  /// Deployment RPC passthrough (deployStatus, deployInstall).
  Future<JsonRpcResponse> deployRpc(String method, Map<String, dynamic> params);

  /// One-time initialization. Called once after the engine is constructed.
  ///
  /// [MockEngine] creates its temp directory here.
  /// [TermuxEngine] would connect to the Node.js backend.
  Future<void> initialize();

  /// Stream of file change events emitted when files are created, modified,
  /// or deleted.
  Stream<FileChangeEvent> get fileChangeStream;

  /// Release resources (close streams, connections, etc.).
  Future<void> dispose();
}
