/**
 * LCO Integrated Terminal
 *
 * Renders an xterm.js terminal in the bottom panel. Connects to the
 * Node.js backend via WebSocket at /ws/terminal for bidirectional
 * data transfer.
 *
 * Phase 1 (MockEngine): Terminal UI renders; shows offline notice.
 *                        Ready for Phase 2 when Node.js backend is running.
 *
 * Data flow:
 *   xterm.onData → ws.send(JSON: {type:"input", data:"..."})
 *   ws.onmessage ← JSON: {type:"output", data:"..."} → xterm.write
 *   ws.onmessage ← JSON: {type:"resize", cols, rows} → xterm.resize
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var terminal = null;
  var fitAddon = null;
  var webLinksAddon = null;
  var ws = null;
  var terminalContainer = null;
  var isConnected = false;
  var reconnectTimer = null;
  var RECONNECT_DELAY = 3000;
  var MAX_RECONNECT_ATTEMPTS = 5;
  var reconnectAttempts = 0;

  var WS_URL = 'ws://127.0.0.1:9876/ws/terminal';

  // ---------------------------------------------------------------------------
  // Banner
  // ---------------------------------------------------------------------------
  var MOCK_BANNER = [
    '\x1b[1;36m╔══════════════════════════════════════════════╗\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;33mLCO Integrated Terminal\x1b[0m                      \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;37mLite Code On-device\x1b[0m                          \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m                                              \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[31m● Backend offline\x1b[0m — Start Node.js server     \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m    in Termux to connect.                    \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m                                              \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  Run in Termux:                             \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[32m$ node node_backend.js --port=9876\x1b[0m         \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m╚══════════════════════════════════════════════╝\x1b[0m',
    '\r\n',
  ].join('\r\n');

  // ---------------------------------------------------------------------------
  // Terminal initialization
  // ---------------------------------------------------------------------------

  function init() {
    terminalContainer = document.getElementById('terminal-container');
    if (!terminalContainer) {
      console.warn('[Terminal] Container not found');
      return;
    }

    // Check if xterm.js is loaded (loaded via CDN script tag in index.html).
    if (typeof Terminal === 'undefined') {
      console.warn('[Terminal] xterm.js not loaded yet, retrying...');
      setTimeout(init, 500);
      return;
    }

    // Create xterm instance.
    terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
        black:  '#000000',
        red:    '#cd3131',
        green:  '#0dbc79',
        yellow: '#e5e510',
        blue:   '#2472c8',
        magenta: '#bc3fbc',
        cyan:   '#11a8cd',
        white:  '#e5e5e5',
        brightBlack:  '#666666',
        brightRed:    '#f14c4c',
        brightGreen:  '#23d18b',
        brightYellow: '#f5f543',
        brightBlue:   '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan:   '#29b8db',
        brightWhite:  '#ffffff',
      },
      allowProposedApi: true,
      scrollback: 5000,
      tabStopWidth: 2,
    });

    // Fit addon.
    if (typeof FitAddon !== 'undefined') {
      fitAddon = new FitAddon.FitAddon();
      terminal.loadAddon(fitAddon);
    }

    // Web links addon.
    if (typeof WebLinksAddon !== 'undefined') {
      webLinksAddon = new WebLinksAddon.WebLinksAddon();
      terminal.loadAddon(webLinksAddon);
    }

    // Open terminal in container.
    terminal.open(terminalContainer);

    // Fit to container.
    if (fitAddon) {
      try { fitAddon.fit(); } catch (e) { /* ignore */ }
    }

    // Write mock/offline banner.
    terminal.write(MOCK_BANNER);

    // ── Terminal → Backend (input) ──
    var inputBuffer = '';
    terminal.onData(function (data) {
      if (ws && isConnected) {
        ws.send(JSON.stringify({ type: 'input', data: data }));
        // Detect 'cd <path>' that looks like a file (has extension)
        if (data === '\r' || data === '\n') {
          var match = inputBuffer.match(/^\s*cd\s+(.+)/);
          if (match) {
            var target = match[1].trim();
            var ext = target.split('/').pop().split('.').pop();
            var knownExts = ['dart','js','ts','json','yaml','yml','html','css',
                           'py','java','kt','md','txt','xml','gradle','lock'];
            if (target.includes('.') && knownExts.indexOf(ext) >= 0) {
              terminal.write('\r\n\x1b[33m⚠ ' + target +
                ' looks like a file, not a directory.\x1b[0m\r\n');
            }
          }
          inputBuffer = '';
        } else if (data === '\x7f') { // backspace
          inputBuffer = inputBuffer.slice(0, -1);
        } else if (data.length === 1) {
          inputBuffer += data;
        }
      }
      // In mock mode, input is displayed locally (echo).
      if (!isConnected) {
        terminal.write(data);
      }
    });

    // ── Terminal resize → Backend ──
    terminal.onResize(function (size) {
      if (ws && isConnected) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: size.cols,
          rows: size.rows
        }));
      }
    });

    // ── Title change ──
    terminal.onTitleChange(function (title) {
      var header = document.getElementById('lco-terminal-header-text');
      if (header) header.textContent = title || 'TERMINAL';
    });

    // ── Attach terminal actions ──
    attachActions();

    // ── Attempt WebSocket connection ──
    connect();

    // ── Observe container size changes ──
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (fitAddon && terminal) {
          try { fitAddon.fit(); } catch (e) { /* debounce */ }
        }
      });
      ro.observe(terminalContainer);
    }

    // ── Handle panel toggle/resize ──
    window.addEventListener('lco-terminal-resized', function () {
      if (fitAddon && terminal) {
        setTimeout(function () { try { fitAddon.fit(); } catch (e) {} }, 50);
      }
    });

    console.log('[Terminal] Initialized');
  }

  // ---------------------------------------------------------------------------
  // WebSocket connection
  // ---------------------------------------------------------------------------

  function connect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      terminal.write('\r\n\x1b[33m[Terminal] Max reconnect attempts reached.\x1b[0m\r\n');
      return;
    }

    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      isConnected = true;
      reconnectAttempts = 0;
      terminal.write('\r\n\x1b[32m● Connected to backend\x1b[0m\r\n');
      // Send current terminal size.
      if (terminal) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: terminal.cols,
          rows: terminal.rows
        }));
      }
      updateStatusBar('● Terminal connected', 'success');
    };

    ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          terminal.write(msg.data);
        } else if (msg.type === 'error') {
          terminal.write('\x1b[31m' + msg.data + '\x1b[0m');
        } else if (msg.type === 'cd') {
          // Server requests terminal to cd — send as input to PTY
          if (msg.path) {
            ws.send(JSON.stringify({ type: 'input', data: 'cd "' + msg.path + '"\r' }));
            ws.send(JSON.stringify({ type: 'input', data: 'clear\r' }));
          }
        } else if (msg.type === 'terminalOutput') {
          // Output from runScript — display with a header
          terminal.write('\r\n\x1b[90m── Output of ' + (msg.path || 'script') + ' ──\x1b[0m\r\n');
          terminal.write(msg.data || '');
          terminal.write('\x1b[90m── End of output ──\x1b[0m\r\n');
        }
      } catch (e) {
        terminal.write(event.data);
      }
    };

    ws.onerror = function () {
      // Expected in Phase 1 (no backend running).
    };

    ws.onclose = function () {
      isConnected = false;
      updateStatusBar('● Terminal disconnected', 'warn');
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectAttempts++;
    reconnectTimer = setTimeout(function () {
      terminal.write('\r\n\x1b[90m[Terminal] Reconnecting... (' + reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')\x1b[0m\r\n');
      connect();
    }, RECONNECT_DELAY);
  }

  // ---------------------------------------------------------------------------
  // Actions (toolbar buttons in terminal header)
  // ---------------------------------------------------------------------------

  function attachActions() {
    var btnClear = document.getElementById('lco-terminal-clear');
    var btnClose = document.getElementById('lco-terminal-close');
    var btnMax   = document.getElementById('lco-terminal-max');

    if (btnClear) {
      btnClear.addEventListener('click', function () {
        if (terminal) terminal.clear();
      });
    }

    if (btnClose) {
      btnClose.addEventListener('click', function () {
        var panel = document.getElementById('lco-terminal-panel');
        if (panel) panel.classList.toggle('collapsed');
        window.dispatchEvent(new CustomEvent('lco-terminal-resized'));
      });
    }

    if (btnMax) {
      btnMax.addEventListener('click', function () {
        var panel = document.getElementById('lco-terminal-panel');
        if (!panel) return;
        if (panel.style.height === '60%') {
          panel.style.height = '';
        } else {
          panel.style.height = '60%';
        }
        window.dispatchEvent(new CustomEvent('lco-terminal-resized'));
      });
    }

    // Terminal header drag to resize
    var header = document.getElementById('lco-terminal-header');
    if (header) {
      header.addEventListener('mousedown', function (e) {
        // handled by main resize logic in editor.js
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function updateStatusBar(msg, type) {
    var bar = document.getElementById('lco-status-bar');
    if (!bar) return;
    bar.textContent = msg;
    bar.className = type || '';
    clearTimeout(bar._timer);
    bar._timer = setTimeout(function () { bar.className = ''; }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Resize handlers
  // ---------------------------------------------------------------------------

  /**
   * Called externally when the terminal panel is resized by dragging.
   */
  function handleResize() {
    if (fitAddon && terminal) {
      try { fitAddon.fit(); } catch (e) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  window.LCOTerminal = {
    /** Write text to the terminal (used by other components). */
    write: function (text) {
      if (terminal) terminal.write(text);
    },

    /** Clear the terminal. */
    clear: function () {
      if (terminal) terminal.clear();
    },

    /** Check if WebSocket is connected. */
    isConnected: function () {
      return isConnected;
    },

    /** Manually connect/reconnect. */
    connect: connect,

    /** Focus the terminal. */
    focus: function () {
      if (terminal) terminal.focus();
    },

    /** Handle resize (called by external resize logic). */
    handleResize: handleResize,

    /** Get the xterm Terminal instance (for advanced usage). */
    getTerminal: function () {
      return terminal;
    },

    /** Set the WebSocket URL. */
    setWsUrl: function (url) {
      WS_URL = url;
    },
  };

  // ---------------------------------------------------------------------------
  // Init (wait for xterm.js and DOM)
  // ---------------------------------------------------------------------------

  function waitAndInit() {
    if (typeof Terminal !== 'undefined' && document.getElementById('terminal-container')) {
      init();
    } else {
      setTimeout(waitAndInit, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInit);
  } else {
    waitAndInit();
  }

})();
