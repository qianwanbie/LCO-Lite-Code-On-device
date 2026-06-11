/// TermuxEngine — proxies all IDEEngine RPC calls to the
/// Node.js backend running in Termux via HTTP POST.
///
/// This replaces MockEngine for real file operations on the
/// PROJECT_ROOT workspace (/data/user/0/com.termux/lco-workspace/).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:lco/engine/ide_engine.dart';
import 'package:lco/protocol/json_rpc.dart';

class TermuxEngine implements IDEEngine {
  final String _baseUrl;
  final HttpClient _http = HttpClient();
  final StreamController<FileChangeEvent> _fileChangeController =
      StreamController<FileChangeEvent>.broadcast();
  int _requestId = 0;

  TermuxEngine({String host = '127.0.0.1', int port = 9876})
      : _baseUrl = 'http://$host:$port/api/rpc';

  @override
  Future<void> initialize() async {
    // Verify backend is reachable
    try {
      final resp = await _sendRpc('listFiles', {'dirPath': '/'});
      if (resp.isError) {
        throw Exception('Backend error: ${resp.error?.message}');
      }
    } catch (e) {
      // Backend may not be running — file operations will fail gracefully
    }
  }

  @override
  Future<JsonRpcResponse> saveFile(String path, String content) =>
      _sendRpc('saveFile', {'path': path, 'content': content});

  @override
  Future<JsonRpcResponse> readFile(String path) =>
      _sendRpc('readFile', {'path': path});

  @override
  Future<JsonRpcResponse> listFiles([String? dirPath]) =>
      _sendRpc('listFiles', {'dirPath': dirPath ?? '/'});

  @override
  Future<JsonRpcResponse> runGitCommand(List<String> args) =>
      _sendRpc('runGitCommand', {'args': args});

  @override
  Future<JsonRpcResponse> changeWorkspace(String subFolder) =>
      _sendRpc('switchWorkspace',
          subFolder.startsWith('/') ? {'path': subFolder} : {'subFolder': subFolder});

  @override
  Future<JsonRpcResponse> deleteFile(String path) =>
      _sendRpc('deleteFile', {'path': path});

  @override
  Future<JsonRpcResponse> renameFile(String oldPath, String newPath) =>
      _sendRpc('renameFile', {'oldPath': oldPath, 'newPath': newPath});

  @override
  Future<JsonRpcResponse> runScript(String path) =>
      _sendRpc('runScript', {'path': path});

  @override
  Future<JsonRpcResponse> claudeChat(String message) =>
      _sendRpc('claudeChat', {'message': message});

  @override
  Stream<FileChangeEvent> get fileChangeStream => _fileChangeController.stream;

  @override
  Future<void> dispose() async {
    await _fileChangeController.close();
    _http.close();
  }

  // ── HTTP JSON-RPC proxy ──

  Future<JsonRpcResponse> _sendRpc(String method, Map<String, dynamic> params) async {
    final id = ++_requestId;
    final body = jsonEncode({
      'jsonrpc': '2.0',
      'id': id,
      'method': method,
      'params': params,
    });

    try {
      final request = await _http.postUrl(Uri.parse(_baseUrl));
      request.headers.set('Content-Type', 'application/json');
      request.write(body);
      final response = await request.close();
      final raw = await response.transform(utf8.decoder).join();
      final json = jsonDecode(raw) as Map<String, dynamic>;
      final rpc = JsonRpcResponse.fromJson(json);

      // Emit file change events for mutations
      if (rpc.isSuccess) {
        if (method == 'saveFile') {
          _fileChangeController.add(FileChangeEvent(path: params['path'] as String? ?? '', type: 'modified'));
        } else if (method == 'deleteFile') {
          _fileChangeController.add(FileChangeEvent(path: params['path'] as String? ?? '', type: 'deleted'));
        }
      }

      return rpc;
    } catch (e) {
      return JsonRpcResponse.error(
        id: id,
        code: JsonRpcErrors.internalError,
        message: 'Backend unreachable: $e',
      );
    }
  }
}
