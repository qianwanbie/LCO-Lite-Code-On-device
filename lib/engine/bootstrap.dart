/// LCO Bootstrap — auto-deploy + start backend via Termux broadcast.
library;

import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class LCOBootstrap {
  static bool _started = false;
  static const _channel = MethodChannel('com.lco.ide/termux');

  /// Extract backend JS + auto-start server via Termux RUN_COMMAND.
  static Future<bool> startIfPossible() async {
    if (_started) return true;

    try {
      // Write node_backend.js to /data/local/tmp (world-readable)
      final jsContent = await rootBundle.loadString('assets/server/node_backend.js');
      await File('/data/local/tmp/node_backend.js').writeAsString(jsContent);

      // Send RUN_COMMAND to Termux: create dir + copy file + start server
      final cmd = 'mkdir -p ~/LCO/assets/server && '
          'cp /data/local/tmp/node_backend.js ~/LCO/assets/server/ && '
          'cd ~/LCO/assets/server && '
          'bash -c "source ~/.bashrc && exec node node_backend.js --port=9876"';

      final result = await _channel.invokeMethod<bool>('startBackend', {
        'command': cmd,
      });
      _started = result ?? false;
      debugPrint(_started ? '[LCO] Backend started via Termux' : '[LCO] Termux start failed');
      return _started;
    } catch (e) {
      debugPrint('[LCO Bootstrap] $e');
      return false;
    }
  }
}
