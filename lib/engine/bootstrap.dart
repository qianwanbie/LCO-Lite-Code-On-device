/// LCO Bootstrap — auto-start backend via Termux broadcast intent.
library;

import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

class LCOBootstrap {
  static bool _started = false;

  /// Try to auto-start the backend via Termux RUN_COMMAND intent.
  static Future<bool> startIfPossible() async {
    if (_started) return true;

    try {
      // Write backend JS + package.json to Termux-accessible location
      final appDir = await getApplicationDocumentsDirectory();
      final serverDir = Directory('${appDir.path}/lco-server');
      if (!await serverDir.exists()) await serverDir.create(recursive: true);

      final jsPath = '${serverDir.path}/node_backend.js';
      await File(jsPath).writeAsString(
        await rootBundle.loadString('assets/server/node_backend.js'));

      // Also write to Termux home via /sdcard
      final tmpPath = '/data/local/tmp/node_backend.js';
      // Copy via Process (if accessible) or just ensure files exist
      final termuxHome = '/data/data/com.termux/files/home';
      final termuxServer = '$termuxHome/LCO/assets/server';

      // Try to use Termux RUN_COMMAND to start the server
      const channel = MethodChannel('com.lco.ide/termux');
      final result = await channel.invokeMethod<bool>('startBackend', {
        'command': 'cd $termuxServer && bash -c "source ~/.bashrc && exec node node_backend.js --port=9876"',
      });
      _started = result ?? false;
      return _started;
    } catch (e) {
      debugPrint('[LCO Bootstrap] Error: $e');
      return false;
    }
  }

  static void stop() {
    _started = false;
  }
}
