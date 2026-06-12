/// LCO — Lite Code On-device
///
/// A lightweight Android IDE powered by Monaco Editor, Flutter WebView,
/// and a pluggable backend engine architecture.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lco/engine/bootstrap.dart';
import 'package:lco/engine/ide_engine.dart';
import 'package:lco/engine/termux_engine.dart';
import 'package:lco/webview/editor_webview.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Hide system status bar + nav bar for fullscreen IDE experience
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

  // Auto-start Node.js backend if Termux is installed
  final booted = await LCOBootstrap.startIfPossible();
  debugPrint(booted ? '[LCO] Backend auto-started' : '[LCO] Backend not auto-started');

  // Use TermuxEngine to connect to the Node.js backend.
  final engine = TermuxEngine();
  await engine.initialize();

  runApp(LCOApp(engine: engine));
}

class LCOApp extends StatelessWidget {
  final IDEEngine engine;

  const LCOApp({super.key, required this.engine});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LCO — Lite Code On-device',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1E1E1E),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: EditorWebView(engine: engine),
    );
  }
}
