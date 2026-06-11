/// Minimal HTTP server that serves Flutter assets from the app bundle.
///
/// Needed because Android WebView blocks CORS and Web Workers when the
/// page is loaded from `file:///` (origin=`null`). By serving via HTTP
/// on localhost, we get a proper `http://127.0.0.1` origin.
///
/// Singleton — only one server instance per app.
library;

import 'dart:async';
import 'dart:io';
import 'package:flutter/services.dart';

class AssetServer {
  static final AssetServer _instance = AssetServer._();
  factory AssetServer() => _instance;
  AssetServer._();

  HttpServer? _server;
  int _port = 0;
  bool _started = false;

  int get port => _port;

  Future<int> start() async {
    if (_started) return _port;
    _started = true;
    _server = await HttpServer.bind('127.0.0.1', 0);
    _port = _server!.port;

    _server!.listen((request) {
      _handleRequest(request);
    });

    return _port;
  }

  Future<void> _handleRequest(HttpRequest request) async {
    // Map URL path to asset key
    var path = request.uri.path;
    if (path == '/' || path.isEmpty) {
      path = '/index.html';
    }

    // Remove leading slash for asset lookup
    final assetKey = 'assets${path}';
    final contentType = _mimeType(path);

    try {
      // Load as string for text-based assets (HTML, JS, CSS, JSON, SVG)
      if (_isTextAsset(path)) {
        final data = await rootBundle.loadString(assetKey);
        request.response.statusCode = 200;
        request.response.headers.set('Content-Type', '$contentType; charset=utf-8');
        request.response.headers.set('Access-Control-Allow-Origin', '*');
        request.response.headers.set('Cache-Control', 'no-cache');
        request.response.write(data);
        await request.response.close();
      } else {
        final data = await rootBundle.load(assetKey);
        request.response.statusCode = 200;
        request.response.headers.set('Content-Type', contentType);
        request.response.headers.set('Access-Control-Allow-Origin', '*');
        request.response.headers.set('Cache-Control', 'no-cache');
        request.response.add(data.buffer.asUint8List());
        await request.response.close();
      }
    } catch (_) {
      request.response.statusCode = 404;
      request.response.headers.set('Access-Control-Allow-Origin', '*');
      request.response.write('Not found: $assetKey');
      await request.response.close();
    }
  }

  bool _isTextAsset(String path) {
    final textExts = ['.html', '.js', '.css', '.json', '.svg', '.xml', '.yaml', '.yml', '.md', '.txt', '.dart'];
    return textExts.any((ext) => path.endsWith(ext));
  }

  String _mimeType(String path) {
    if (path.endsWith('.html')) return 'text/html; charset=utf-8';
    if (path.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (path.endsWith('.css')) return 'text/css; charset=utf-8';
    if (path.endsWith('.json')) return 'application/json; charset=utf-8';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    if (path.endsWith('.woff2')) return 'font/woff2';
    return 'application/octet-stream';
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
  }
}
