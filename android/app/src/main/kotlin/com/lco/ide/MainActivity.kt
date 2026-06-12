package com.lco.ide

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.os.Bundle
import android.content.Intent
import android.net.Uri

class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // Termux IPC channel — auto-start backend
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.lco.ide/termux")
            .setMethodCallHandler { call, result ->
                if (call.method == "startBackend") {
                    try {
                        val cmd = call.argument<String>("command") ?: ""
                        val intent = Intent("com.termux.RUN_COMMAND")
                        intent.setClassName("com.termux", "com.termux.app.RunCommandService")
                        intent.putExtra("com.termux.RUN_COMMAND_PATH",
                            "/data/data/com.termux/files/usr/bin/bash")
                        intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arrayOf("-c", cmd))
                        intent.putExtra("com.termux.RUN_COMMAND_WORKDIR",
                            "/data/data/com.termux/files/home")
                        startService(intent)
                        result.success(true)
                    } catch (e: Exception) {
                        result.success(false)
                    }
                } else {
                    result.notImplemented()
                }
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            if (!android.os.Environment.isExternalStorageManager()) {
                val intent = Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                intent.data = Uri.parse("package:${packageName}")
                startActivity(intent)
            }
        }
    }
}
