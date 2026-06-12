/// EditorWebView — wraps `webview_flutter` with the Monaco Editor frontend
/// and JSON-RPC bidirectional communication via [JSBridge].
library;

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:lco/protocol/json_rpc.dart';
import 'package:lco/webview/js_bridge.dart';
import 'package:lco/webview/asset_server.dart';
import 'package:lco/engine/ide_engine.dart';

class EditorWebView extends StatefulWidget {
  final IDEEngine engine;

  const EditorWebView({super.key, required this.engine});

  @override
  State<EditorWebView> createState() => _EditorWebViewState();
}

class _EditorWebViewState extends State<EditorWebView> {
  late final JSBridge _bridge;
  late final WebViewController _controller;
  StreamSubscription<FileChangeEvent>? _fileChangeSub;
  final AssetServer _assetServer = AssetServer();

  bool _isEditorReady = false;

  @override
  void initState() {
    super.initState();
    _bridge = JSBridge(widget.engine);
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) => _onPageLoaded(),
        ),
      )
      ..addJavaScriptChannel(
        'LCOBridge',
        onMessageReceived: _onJsMessage,
      )
      ..setOnConsoleMessage(_onConsoleMessage);

    // Start local HTTP asset server → avoids file:/// CORS/Worker issues
    _startServerAndLoad();

    // Listen for file change events from the engine and push to JS.
    _fileChangeSub = _bridge.fileChangeStream.listen((event) {
      final notification = _bridge.handleFileChangeEvent(event);
      if (notification.isNotEmpty) {
        _controller.runJavaScript(
          "window.dispatchEvent(new CustomEvent('lco-file-change', "
          "{detail: ${jsonEncode(notification)}}))",
        );
      }
    });
  }

  @override
  void dispose() {
    _fileChangeSub?.cancel();
    _bridge.disposePending();
    _assetServer.stop();
    super.dispose();
  }

  Future<void> _startServerAndLoad() async {
    final port = await _assetServer.start();
    final url = 'http://127.0.0.1:$port/index.html';
    _controller.loadRequest(Uri.parse(url));
  }

  // ---------------------------------------------------------------------------
  // JavaScript → Flutter
  // ---------------------------------------------------------------------------

  Future<void> _onJsMessage(JavaScriptMessage message) async {
    // Check for editorReady notification from JS (hides Flutter loading overlay)
    try {
      final json = jsonDecode(message.message) as Map<String, dynamic>;
      if (json['method'] == 'editorReady') {
        if (!_isEditorReady) {
          setState(() => _isEditorReady = true);
        }
        return;
      }
    } catch (_) { /* not JSON, handle as raw message */ }

    final response = await _bridge.handleMessage(message.message);
    if (response.isNotEmpty) {
      // jsonEncode escapes quotes/newlines so LLM output doesn't break JS syntax
      _controller.runJavaScript(
        "window.dispatchEvent(new CustomEvent('lco-response', "
        "{detail: ${jsonEncode(response)}}))",
      );
    }
  }

  /// Forward WebView console messages to Flutter logs for debugging.
  void _onConsoleMessage(JavaScriptConsoleMessage msg) {
    debugPrint('[WebView] [${msg.level}] ${msg.message}');
  }

  // ---------------------------------------------------------------------------
  // Flutter → JavaScript
  // ---------------------------------------------------------------------------

  /// Send a JSON-RPC request to the WebView and wait for the response.
  Future<JsonRpcResponse> sendRequest(
    String method,
    Map<String, dynamic> params,
  ) async {
    // Use handleMessage to process and get the raw response.
    // The JS side is expected to send back a JSON-RPC response through
    // the LCOBridge channel; _onJsMessage completes the pending completer.
    return _bridge.call(method, params);
  }

  /// Notify the WebView that a file has changed (push from Flutter).
  Future<void> notifyFileChange(String path, String type) async {
    final event = FileChangeEvent(path: path, type: type);
    final notification = _bridge.handleFileChangeEvent(event);
    _controller.runJavaScript(
      "window.dispatchEvent(new CustomEvent('lco-file-change', "
      "{detail: $notification}))",
    );
  }

  // ---------------------------------------------------------------------------
  // Page load
  // ---------------------------------------------------------------------------

  Future<void> _onPageLoaded() async {
    // Wait a short frame for Monaco to initialize, then send a ready check.
    await Future.delayed(const Duration(milliseconds: 500));
    final isReady = await _controller.runJavaScriptReturningResult(
      "typeof monaco !== 'undefined' && typeof monaco.editor !== 'undefined'",
    );
    // runJavaScriptReturningResult returns a String.
    if (isReady is String && isReady == 'true') {
      setState(() => _isEditorReady = true);
    }
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
          children: [
            WebViewWidget(controller: _controller),
            if (!_isEditorReady)
              const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: 12),
                    Text('Loading Monaco Editor…'),
                  ],
                ),
              ),
          ],
        ),
    );
  }
}
