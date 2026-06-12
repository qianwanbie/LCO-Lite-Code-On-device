/// JavaScriptBridge — routes JSON-RPC messages between WebView JS and the
/// [IDEEngine].
///
/// Manages request ID matching so that each `call()` returns the correct
/// response for its request.
library;

import 'dart:async';
import 'dart:convert';

import 'package:lco/engine/ide_engine.dart';
import 'package:lco/protocol/json_rpc.dart';

class JSBridge {
  final IDEEngine _engine;

  /// Tracks pending requests by their JSON-RPC id.
  final Map<int, Completer<JsonRpcResponse>> _pending = {};
  int _nextId = 1;

  JSBridge(this._engine);

  /// Call a JSON-RPC method on the engine and return its response.
  ///
  /// [method] — the JSON-RPC method name (e.g. 'saveFile', 'readFile').
  /// [params] — the named parameters for the method.
  ///
  /// Returns a [Future] that completes when the engine produces a response
  /// matching this request's id.
  Future<JsonRpcResponse> call(String method, Map<String, dynamic> params) {
    final id = _nextId++;
    final completer = Completer<JsonRpcResponse>();
    _pending[id] = completer;

    // Dispatch to the engine asynchronously.
    _dispatch(id, method, params);

    return completer.future;
  }

  /// Handle a raw JSON-RPC message string received from the WebView.
  ///
  /// Parses the message, dispatches to the engine, and returns the encoded
  /// response string to be sent back to JavaScript.
  Future<String> handleMessage(String message) async {
    try {
      final json = _parseJson(message);
      final request = JsonRpcRequest.fromJson(json);

      if (request.isNotification) {
        // Notifications are fire-and-forget.
        return '';
      }

      final response = await _dispatchToEngine(
        request.id!,
        request.method,
        request.params,
      );
      return response.encode();
    } catch (e) {
      // Parse error — return a valid JSON-RPC error.
      final errorResponse = JsonRpcResponse.error(
        id: 0,
        code: JsonRpcErrors.parseError,
        message: 'Parse error: $e',
      );
      return errorResponse.encode();
    }
  }

  /// Handle a notification from the engine's file change stream.
  ///
  /// Encodes the event as a JSON-RPC notification string that can be
  /// injected into the WebView via `evaluateJavascript`.
  String handleFileChangeEvent(FileChangeEvent event) {
    return event.toNotification().encode();
  }

  /// Get the engine's file change stream for external listeners.
  Stream<FileChangeEvent> get fileChangeStream => _engine.fileChangeStream;

  /// Dispose of pending completers (no leak on widget disposal).
  void disposePending() {
    for (final completer in _pending.values) {
      if (!completer.isCompleted) {
        completer.complete(JsonRpcResponse.error(
          id: 0,
          code: JsonRpcErrors.internalError,
          message: 'Bridge disposed before response',
        ));
      }
    }
    _pending.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  Future<void> _dispatch(
    int id,
    String method,
    Map<String, dynamic> params,
  ) async {
    try {
      final response = await _dispatchToEngine(id, method, params);
      final completer = _pending.remove(id);
      completer?.complete(response);
    } catch (e) {
      final completer = _pending.remove(id);
      completer?.complete(JsonRpcResponse.error(
        id: id,
        code: JsonRpcErrors.internalError,
        message: 'Dispatch error: $e',
      ));
    }
  }

  Future<JsonRpcResponse> _dispatchToEngine(
    int id,
    String method,
    Map<String, dynamic> params,
  ) async {
    switch (method) {
      case 'saveFile':
        final path = _normalizePath(params['path'] as String? ?? '');
        final content = params['content'] as String? ?? '';
        return _withId(await _engine.saveFile(path, content), id);

      case 'readFile':
        final path = _normalizePath(params['path'] as String? ?? '');
        return _withId(await _engine.readFile(path), id);

      case 'listFiles':
        final dirPath = params['dirPath'] != null
            ? _normalizePath(params['dirPath'] as String)
            : null;
        return _withId(await _engine.listFiles(dirPath), id);

      case 'runGitCommand':
        final args = (params['args'] as List<dynamic>?)
                ?.map((e) => e.toString())
                .toList() ??
            [];
        return _withId(await _engine.runGitCommand(args), id);

      case 'switchWorkspace':
      case 'changeWorkspace':
        // Support both subFolder (relative) and path (absolute)
        final subFolder = _normalizePath(params['subFolder'] as String? ?? params['path'] as String? ?? '');
        return _withId(await _engine.changeWorkspace(subFolder), id);

      case 'deleteFile':
        final delPath = _normalizePath(params['path'] as String? ?? '');
        return _withId(await _engine.deleteFile(delPath), id);

      case 'renameFile':
        final oldP = _normalizePath(params['oldPath'] as String? ?? '');
        final newP = _normalizePath(params['newPath'] as String? ?? '');
        return _withId(await _engine.renameFile(oldP, newP), id);

      case 'runScript':
        final scriptP = _normalizePath(params['path'] as String? ?? '');
        return _withId(await _engine.runScript(scriptP), id);

      case 'claudeChat':
      case 'chatMessage':
        final msg = params['message'] as String? ?? '';
        return _withId(await _engine.claudeChat(msg), id);

      case 'updateLLMConfig':
        final cfg = params['config'] as Map<String, dynamic>? ?? {};
        return _withId(await _engine.updateLLMConfig(cfg), id);

      case 'openUrl':
        final url = params['url'] as String? ?? '';
        return _withId(await _engine.openUrl(url), id);

      case 'deployStatus':
      case 'deployInstall':
        // Route directly — pass all params
        final deployParams = Map<String, dynamic>.from(params);
        return _withId(await _engine.deployRpc(method, deployParams), id);

      default:
        return JsonRpcResponse.error(
          id: id,
          code: JsonRpcErrors.methodNotFound,
          message: 'Method not found: $method',
        );
    }
  }

  /// Ensure the response carries the correct request id.
  JsonRpcResponse _withId(JsonRpcResponse response, int id) {
    return JsonRpcResponse(
      jsonrpc: response.jsonrpc,
      id: id,
      result: response.result,
      error: response.error,
    );
  }

  /// Normalize a file path from the frontend.
  ///
  /// - Strips leading slashes (paths are relative to project root)
  /// - Prevents path traversal (..)
  /// - Converts backslashes to forward slashes
  /// - Returns empty string for root
  String _normalizePath(String raw) {
    var path = raw.trim();
    // Convert backslashes
    path = path.replaceAll('\\', '/');
    // Strip leading slashes
    path = path.replaceFirst(RegExp(r'^/+'), '');
    // Collapse multiple slashes
    path = path.replaceAll(RegExp(r'/+'), '/');
    // Prevent traversal
    if (path.contains('..')) {
      throw ArgumentError('Path traversal denied: $raw');
    }
    return path;
  }

  Map<String, dynamic> _parseJson(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
      throw FormatException('Expected JSON object, got ${decoded.runtimeType}');
    } catch (_) {
      // Try replacing single quotes with double quotes (JS-style JSON).
      final relaxed = raw.replaceAll("'", '"');
      final decoded = jsonDecode(relaxed);
      if (decoded is Map<String, dynamic>) return decoded;
      throw FormatException('Expected JSON object after normalization');
    }
  }
}
