/**
 * LCO Editor Adapter
 *
 * Initializes Monaco Editor and sets up the bidirectional communication
 * bridge with Flutter via the LCOBridge JavaScriptChannel.
 *
 * Protocol: JSON-RPC 2.0
 *
 *   JS → Flutter (via LCOBridge.postMessage):
 *     { "jsonrpc": "2.0", "id": N, "method": "...", "params": {...} }
 *
 *   Flutter → JS (via window.dispatchEvent with CustomEvent 'lco-response'
 *     or 'lco-file-change'):
 *     { "jsonrpc": "2.0", "id": N, "result": {...} }
 *
 *   File change push (notification, no id):
 *     { "jsonrpc": "2.0", "method": "pushFileChange", "params": {...} }
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Guard
  // ---------------------------------------------------------------------------
  if (!window.monaco) {
    console.error('[LCO] Monaco is not loaded. Aborting editor init.');
    return;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var editor = null;
  var requestId = 0;
  var pendingRequests = {};  // id → { resolve, reject, timer }
  var currentLocale = 'en';
  var isDirty = false;

  // ---------------------------------------------------------------------------
  // Communication helpers
  // ---------------------------------------------------------------------------

  /**
   * Send a JSON-RPC request to Flutter via the LCOBridge channel.
   * Returns a Promise that resolves with the JSON-RPC response.
   */
  function sendRpc(method, params) {
    return new Promise(function (resolve, reject) {
      var id = ++requestId;
      var payload = {
        jsonrpc: '2.0',
        id: id,
        method: method,
        params: params || {}
      };

      var timer = setTimeout(function () {
        delete pendingRequests[id];
        reject(new Error('RPC timeout: ' + method));
      }, 30000);

      pendingRequests[id] = { resolve: resolve, reject: reject, timer: timer };

      try {
        LCOBridge.postMessage(JSON.stringify(payload));
        console.log('[LCO] RPC →', method, payload);
      } catch (e) {
        clearTimeout(timer);
        delete pendingRequests[id];
        reject(e);
      }
    });
  }

  /**
   * Handle a JSON-RPC response from Flutter.
   */
  function handleResponse(response) {
    var id = response.id;
    var pending = pendingRequests[id];
    if (!pending) return;

    clearTimeout(pending.timer);
    delete pendingRequests[id];

    if (response.error) {
      console.error('[LCO] RPC ← error', response.error);
      pending.reject(new Error('RPC error ' + response.error.code + ': ' + response.error.message));
    } else {
      console.log('[LCO] RPC ← result', response.result);
      pending.resolve(response.result);
    }
  }

  /**
   * Handle a file change notification from Flutter.
   */
  function handleFileChange(event) {
    console.log('[LCO] File change:', event.path, event.type);
    if (editor && event.path) {
      var model = monaco.editor.getModels().find(function (m) {
        return m.uri.path === event.path || m.uri.path.endsWith(event.path);
      });
      if (model && event.type === 'modified') {
        sendRpc('readFile', { path: event.path }).then(function (result) {
          if (result && result.content !== undefined && model.getValue() !== result.content) {
            model.setValue(result.content);
          }
        }).catch(function () {
          // File may have been deleted; ignore.
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Status bar
  // ---------------------------------------------------------------------------

  function updateStatusBar(message, type) {
    var bar = document.getElementById('lco-status-bar');
    if (!bar) return;
    bar.textContent = message;
    bar.className = 'lco-status-bar ' + (type || '');
    clearTimeout(bar._timer);
    bar._timer = setTimeout(function () {
      bar.className = 'lco-status-bar';
    }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Save logic
  // ---------------------------------------------------------------------------

  /**
   * Perform an explicit save of the current editor content.
   * Called by Ctrl+S, blur, and toolbar button.
   */
  function explicitSave() {
    if (!editor) return;
    var model = editor.getModel();
    if (!model || !isDirty) return;

    var path = model.uri.path || '/untitled';
    var content = model.getValue();

    sendRpc('saveFile', { path: path, content: content }).then(function (result) {
      isDirty = false;
      console.log('[LCO] Saved:', path, result.checksum);
      updateStatusBar('✓ ' + t('fileSaved'), 'success');
    }).catch(function (err) {
      console.warn('[LCO] Save failed:', err);
      updateStatusBar('✗ ' + t('autosaveFailed'), 'error');
    });
  }

  // ---------------------------------------------------------------------------
  // Monaco Editor initialization
  // ---------------------------------------------------------------------------

  function configureWorkers() {
    // Page is served via local HTTP → proper origin → no CORS issues.
    // Workers use simple relative URLs.
    var baseUrl = './monaco-editor/min/vs/assets';

    window.MonacoEnvironment = window.MonacoEnvironment || {};
    window.MonacoEnvironment.getWorkerUrl = function (moduleId, label) {
      var workerMap = {
        json:       'json.worker.js',
        css:        'css.worker.js',
        html:       'html.worker.js',
        typescript: 'ts.worker.js',
        javascript: 'ts.worker.js',
        editorWorkerService: 'editor.worker.js'
      };
      var workerFile = workerMap[label] || 'editor.worker.js';
      return baseUrl + '/' + workerFile;
    };
  }

  function createEditor() {
    var container = document.getElementById('editor-container');

    editor = monaco.editor.create(container, {
      value: [
        '// Welcome to LCO — Lite Code On-device',
        '//',
        '// Monaco Editor is running inside a Flutter WebView.',
        '// The communication bridge (JSON-RPC 2.0) is active.',
        '//',
        '// Try: LCOEditor.runTest()    — test readFile → display',
        '//      LCOEditor.toggleLocale()— switch zh/en',
        '//      Ctrl+S                — manual save',
        '//',
        'function hello() {',
        '  console.log("Hello from LCO!");',
        '}',
        ''
      ].join('\n'),
      language: 'javascript',
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      renderWhitespace: 'selection',
      tabSize: 2,
    });

    editor.focus();
    console.log('[LCO] Monaco Editor created and focused.');

    // Terminal toggle button in status bar
    var toggleBtn = document.getElementById('lco-toggle-terminal');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        var panel = document.getElementById('lco-terminal-panel');
        if (panel) {
          panel.classList.toggle('collapsed');
          window.dispatchEvent(new CustomEvent('lco-terminal-resized'));
        }
      });
    }

    // Hide loading overlay.
    var overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');

    // Notify Flutter.
    LCOBridge.postMessage(JSON.stringify({
      jsonrpc: '2.0',
      method: 'editorReady',
      params: { timestamp: Date.now() }
    }));

    // ── Ctrl+S / Cmd+S keyboard shortcut ──
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      function () {
        console.log('[LCO] Ctrl+S pressed — explicit save');
        explicitSave();
      }
    );

    // ── Save on blur (editor loses focus) ──
    editor.onDidBlurEditorWidget(function () {
      if (isDirty) {
        console.log('[LCO] Editor blurred — auto-saving');
        explicitSave();
      }
    });

    // ── Auto-save on content change (debounced) ──
    var saveTimer = null;
    editor.onDidChangeModelContent(function () {
      isDirty = true;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        explicitSave();
      }, 1000);
    });
  }

  // ---------------------------------------------------------------------------
  // i18n helper (uses window.LCO_i18n from i18n.js)
  // ---------------------------------------------------------------------------

  function t(key) {
    return (window.LCO_i18n && window.LCO_i18n.t(key, currentLocale)) || key;
  }

  /**
   * Toggle between English and Chinese.
   */
  function toggleLocale() {
    var locales = (window.LCO_i18n && window.LCO_i18n.locales) || ['en', 'zh'];
    var idx = locales.indexOf(currentLocale);
    var next = locales[(idx + 1) % locales.length];
    setLocale(next);
  }

  /**
   * Set the editor locale and update UI elements.
   */
  function setLocale(locale) {
    if (window.LCO_i18n) {
      window.LCO_i18n.setLocale(locale);
    }
    currentLocale = locale;
    console.log('[LCO] Locale set to:', locale);

    // Update toolbar button text.
    var btn = document.getElementById('lco-btn-locale');
    if (btn) btn.textContent = locale.toUpperCase();

    // Update status bar.
    updateStatusBar('🌐 ' + locale.toUpperCase(), 'info');

    // Update loading text if still visible.
    var loadingText = document.getElementById('loading-text');
    if (loadingText && !editor) {
      loadingText.textContent = t('loading');
    }
  }

  // ---------------------------------------------------------------------------
  // Event listeners (Flutter → JS)
  // ---------------------------------------------------------------------------

  window.addEventListener('lco-response', function (e) {
    try {
      var response = e.detail;
      if (typeof response === 'string') {
        response = JSON.parse(response);
      }
      handleResponse(response);
    } catch (err) {
      console.error('[LCO] Failed to parse lco-response:', err);
    }
  });

  window.addEventListener('lco-file-change', function (e) {
    try {
      var event = e.detail;
      if (typeof event === 'string') {
        event = JSON.parse(event);
      }
      if (event.method === 'pushFileChange') {
        handleFileChange(event.params);
      }
    } catch (err) {
      console.error('[LCO] Failed to parse lco-file-change:', err);
    }
  });

  window.addEventListener('lco-locale-changed', function (e) {
    currentLocale = e.detail.locale;
    console.log('[LCO] Locale changed externally to:', currentLocale);
  });

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  window.LCOEditor = {
    sendRpc: sendRpc,
    getEditor: function () { return editor; },
    isReady: function () { return editor !== null; },
    isDirty: function () { return isDirty; },

    // ── Task 1: Test readFile → display in Monaco ──
    /**
     * Run the communication test:
     *  1. Sends readFile for '/test/hello.dart' to MockEngine.
     *  2. MockEngine doesn't have this file yet, so it saves one first.
     *  3. Then reads it back and displays in Monaco via setValue().
     *
     *  Usage: LCOEditor.runTest()
     */
    runTest: function () {
      console.log('[LCO] ===== Communication Test Start =====');

      var testPath = '/test/hello.dart';
      var testContent = "void main() {\n  print('Hello LCO');\n}\n";

      // Step 1: Save a test file to MockEngine.
      console.log('[LCO] Step 1: saveFile →', testPath);
      sendRpc('saveFile', { path: testPath, content: testContent })
        .then(function (saveResult) {
          console.log('[LCO] Step 1 OK — saved, checksum:', saveResult.checksum);

          // Step 2: Read it back.
          console.log('[LCO] Step 2: readFile →', testPath);
          return sendRpc('readFile', { path: testPath });
        })
        .then(function (readResult) {
          console.log('[LCO] Step 2 OK — read back:', readResult.content);

          // Step 3: Display in Monaco Editor.
          var uri = monaco.Uri.parse('file:///test/hello.dart');
          var existingModel = monaco.editor.getModel(uri);
          if (existingModel) {
            existingModel.setValue(readResult.content);
            console.log('[LCO] Step 3: Updated existing model.');
          } else {
            monaco.editor.createModel(readResult.content, 'dart', uri);
            console.log('[LCO] Step 3: Created new model.');
          }
          editor.setModel(monaco.editor.getModel(uri));
          editor.focus();
          isDirty = false;

          updateStatusBar('✓ Communication test PASSED', 'success');
          console.log('[LCO] ===== Communication Test PASSED =====');
          console.log('[LCO] Editor now showing: ' + testPath);
        })
        .catch(function (err) {
          console.error('[LCO] ===== Communication Test FAILED =====');
          console.error('[LCO]', err);
          updateStatusBar('✗ ' + t('rpcTimeout') + ': ' + err.message, 'error');
        });
    },

    // ── Task 2: Save helpers ──
    /** Explicit save (Ctrl+S / blur handler). */
    save: explicitSave,

    /** Save the current editor content to a specific path. */
    saveCurrentFile: function (path) {
      if (!editor) throw new Error('Editor not initialized');
      var model = editor.getModel();
      if (!model) throw new Error('No active model');
      return sendRpc('saveFile', {
        path: path || model.uri.path,
        content: model.getValue()
      });
    },

    // ── Task 3: i18n ──
    /** Toggle between en ↔ zh. */
    toggleLocale: toggleLocale,

    /** Set a specific locale ('en' or 'zh'). */
    setLocale: setLocale,

    /** Get the current locale. */
    getLocale: function () { return currentLocale; },

    // ── File operations ──
    /** Open a file by path (reads via RPC, creates/updates a model). */
    openFile: function (path, language) {
      return sendRpc('readFile', { path: path }).then(function (result) {
        if (!result || result.content === undefined) {
          throw new Error('Failed to read file: ' + path);
        }
        var uri = monaco.Uri.parse('file:///' + path.replace(/^\/+/, ''));
        var existingModel = monaco.editor.getModel(uri);
        if (existingModel) {
          existingModel.setValue(result.content);
        } else {
          monaco.editor.createModel(result.content, language || 'plaintext', uri);
        }
        editor.setModel(monaco.editor.getModel(uri));
        editor.focus();
        isDirty = false;
        return result;
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Toolbar button handlers (attached after DOM ready)
  // ---------------------------------------------------------------------------
  function attachToolbarHandlers() {
    var btnTest = document.getElementById('lco-btn-test');
    if (btnTest) {
      btnTest.addEventListener('click', function () {
        window.LCOEditor.runTest();
      });
    }

    var btnSave = document.getElementById('lco-btn-save');
    if (btnSave) {
      btnSave.addEventListener('click', function () {
        explicitSave();
      });
    }

    var btnLocale = document.getElementById('lco-btn-locale');
    if (btnLocale) {
      btnLocale.addEventListener('click', function () {
        toggleLocale();
      });
    }

    var btnGit = document.getElementById('lco-btn-git');
    if (btnGit) {
      btnGit.addEventListener('click', function () {
        console.log('[LCO] Running git status…');
        updateStatusBar('⎇ Running git status…', 'info');
        sendRpc('runGitCommand', { args: ['status'] }).then(function (result) {
          console.log('[LCO] git status:\n' + result.stdout);
          updateStatusBar('⎇ ' + result.stdout.split('\n')[0], 'success');
          // Display in editor as an overlay message.
          if (editor) {
            var pos = editor.getPosition();
            editor.executeEdits('git-output', [{
              range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, 1),
              text: '// ── Git Status ──\n// ' + result.stdout.replace(/\n/g, '\n// ') + '\n'
            }]);
          }
        }).catch(function (err) {
          console.error('[LCO] git status failed:', err);
          updateStatusBar('✗ Git failed', 'error');
        });
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  configureWorkers();
  createEditor();
  attachToolbarHandlers();

  // Load locale from config if available.
  if (window.LCO_CONFIG && window.LCO_CONFIG.locale) {
    setLocale(window.LCO_CONFIG.locale);
  }

})();
