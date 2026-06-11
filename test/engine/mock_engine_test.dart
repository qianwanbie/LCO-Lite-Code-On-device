import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lco/engine/mock_engine.dart';
import 'package:lco/protocol/json_rpc.dart';

void main() {
  late MockEngine engine;
  late Directory tempDir;

  setUp(() async {
    // Create a unique temp directory for each test.
    tempDir = Directory.systemTemp.createTempSync('lco_test_');
    engine = MockEngine(rootDirectory: tempDir);
    await engine.initialize();
  });

  tearDown(() async {
    await engine.dispose();
    if (tempDir.existsSync()) {
      tempDir.deleteSync(recursive: true);
    }
  });

  group('MockEngine', () {
    test('saveFile creates file and returns checksum', () async {
      final response = await engine.saveFile('/test.dart', 'void main() {}');
      expect(response.isSuccess, isTrue);
      expect(response.result['ok'], isTrue);
      expect(response.result['checksum'], isA<String>());
      expect(response.result['checksum'], startsWith('sha256:'));
    });

    test('readFile returns saved content', () async {
      await engine.saveFile('/hello.dart', 'print("hello");');
      final response = await engine.readFile('/hello.dart');
      expect(response.isSuccess, isTrue);
      expect(response.result['content'], 'print("hello");');
      expect(response.result['encoding'], 'utf-8');
    });

    test('readFile returns error for missing file', () async {
      final response = await engine.readFile('/nonexistent.dart');
      expect(response.isError, isTrue);
      expect(response.error!.code, JsonRpcErrors.fileNotFound);
    });

    test('saveFile emits pushFileChange notification', () async {
      final events = <FileChangeEvent>[];
      final sub = engine.fileChangeStream.listen(events.add);

      await engine.saveFile('/new_file.dart', 'content');
      // Allow microtask to flush.
      await Future.delayed(Duration.zero);

      expect(events.length, 1);
      expect(events.first.path, '/new_file.dart');
      expect(events.first.type, 'modified');

      await sub.cancel();
    });

    test('listFiles returns file entries', () async {
      await engine.saveFile('/src/a.dart', 'a');
      await engine.saveFile('/src/b.dart', 'b');

      final response = await engine.listFiles('/src');
      expect(response.isSuccess, isTrue);
      final files = response.result['files'] as List;
      expect(files.length, greaterThanOrEqualTo(2)); // seed files + test files
    });

    test('runGitCommand simulates git init', () async {
      final response = await engine.runGitCommand(['init']);
      expect(response.isSuccess, isTrue);
      expect(response.result['stdout'], contains('Initialized empty Git'));
      expect(response.result['exitCode'], 0);
    });
  });
}
