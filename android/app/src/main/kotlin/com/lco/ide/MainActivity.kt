package com.lco.ide

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract

class MainActivity : FlutterActivity() {

    companion object {
        const val SAF_REQUEST_CODE = 1001
        const val CHANNEL = "com.lco.ide/saf"
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // SAF directory picker channel will be set up here in Phase 2.
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Request MANAGE_EXTERNAL_STORAGE on Android 11+ at startup.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            if (!android.os.Environment.isExternalStorageManager()) {
                val intent = Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                intent.data = Uri.parse("package:${packageName}")
                startActivity(intent)
            }
        }
    }
}
