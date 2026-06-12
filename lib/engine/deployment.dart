/// LCO Deployment — auto-install tools via Termux backend.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';

class LCODeployment {
  static const _channel = MethodChannel('com.lco.ide/deployment');

  /// Check if Termux is installed on the device.
  static Future<bool> isTermuxInstalled() async {
    try {
      final result = await _channel.invokeMethod<bool>('isTermuxInstalled');
      return result ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Check if the backend is accessible (port 9876).
  static Future<bool> isBackendRunning() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('http://127.0.0.1:9876/health'));
      final response = await request.close().timeout(const Duration(seconds: 3));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Send a deployment RPC to the running backend.
  static Future<Map<String, dynamic>?> _sendRpc(String method, Map<String, dynamic> params) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('http://127.0.0.1:9876/api/rpc'));
      request.headers.set('Content-Type', 'application/json');
      final body = jsonEncode({
        'jsonrpc': '2.0', 'id': 999,
        'method': method, 'params': params,
      });
      final bytes = utf8.encode(body);
      request.headers.set('Content-Length', bytes.length.toString());
      request.add(bytes);
      final response = await request.close().timeout(const Duration(seconds: 120));
      final raw = await response.transform(utf8.decoder).join();
      return jsonDecode(raw) as Map<String, dynamic>?;
    } catch (_) {
      return null;
    }
  }

  /// Check deployment status (reads .lco_ready).
  static Future<bool> isDeploymentReady() async {
    final resp = await _sendRpc('deployStatus', {});
    if (resp == null) return false;
    final result = resp['result'] as Map<String, dynamic>?;
    return result?['ready'] == true;
  }

  /// Run deployment for selected tools.
  static Future<String> runDeployment(List<String> tools) async {
    final resp = await _sendRpc('deployInstall', {'tools': tools});
    if (resp == null) return 'Backend unreachable';
    if (resp['error'] != null) {
      return resp['error']['message'] ?? 'Unknown error';
    }
    final result = resp['result'] as Map<String, dynamic>?;
    return result?['output'] ?? result?['status'] ?? 'Done';
  }
}
