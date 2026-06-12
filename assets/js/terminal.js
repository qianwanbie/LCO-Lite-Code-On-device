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
    if (!terminalContainer) { console.warn('[Terminal] Container not found'); return; }

    // Guard: wait for xterm.js + addons to fully load
    if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
      setTimeout(init, 200);
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

    // Register terminal as tab 1 (now that terminal is fully created)
    registerExistingTerminal();

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

    // Buffer for reassembling fragmented WebSocket frames
    var msgBuffer = '';
    ws.onmessage = function (event) {
      msgBuffer += event.data;
      while (msgBuffer.length > 0) {
        // Try length|JSON protocol first
        var pipeIdx = msgBuffer.indexOf('|');
        if (pipeIdx > 0 && pipeIdx < 10) {
          var lenStr = msgBuffer.substring(0, pipeIdx);
          var msgLen = parseInt(lenStr, 10);
          if (!isNaN(msgLen) && msgBuffer.length >= pipeIdx + 1 + msgLen) {
            var jsonStr = msgBuffer.substring(pipeIdx + 1, pipeIdx + 1 + msgLen);
            msgBuffer = msgBuffer.substring(pipeIdx + 1 + msgLen);
            try { processMessage(JSON.parse(jsonStr)); } catch(e) {}
            continue;
          } else if (!isNaN(msgLen)) { break; }
        }
        // Fallback: try direct JSON parse
        try {
          var msg = JSON.parse(msgBuffer);
          msgBuffer = '';
          processMessage(msg);
        } catch (e) { break; }
      }
    };

    function processMessage(msg) {
      if (msg.type === 'output') {
        var data = msg.data || '';
        try { data = decodeURIComponent(data); } catch (_) {}
        terminal.write(data);
      } else if (msg.type === 'error') {
        terminal.write('\x1b[31m' + (msg.data || '') + '\x1b[0m');
      } else if (msg.type === 'cd') {
        if (msg.path) {
          ws.send(JSON.stringify({ type: 'input', data: 'cd "' + msg.path + '"\r' }));
          ws.send(JSON.stringify({ type: 'input', data: 'clear\r' }));
        }
      } else if (msg.type === 'terminalOutput') {
        terminal.write('\r\n\x1b[90m── ' + (msg.path || 'script') + ' ──\x1b[0m\r\n');
        terminal.write((msg.data || ''));
        terminal.write('\x1b[90m── End ──\x1b[0m\r\n');
      }
    }

    ws.onerror = function () {
      // Expected when backend is not running.
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
    var btnNew  = document.getElementById('lco-terminal-new-tab');
    var btnMin  = document.getElementById('lco-terminal-minimize');
    var btnClose = document.getElementById('lco-terminal-close-tab');

    // + New terminal tab
    if (btnNew) btnNew.addEventListener('click', function () { createTerminalTab(); });

    // − Minimize (hide panel, keep PTY alive)
    if (btnMin) btnMin.addEventListener('click', function () {
      var panel = document.getElementById('lco-terminal-panel');
      if (panel) { panel.classList.add('collapsed'); window.dispatchEvent(new CustomEvent('lco-terminal-resized')); }
    });

    // ✕ Kill current tab's PTY
    if (btnClose) btnClose.addEventListener('click', function () {
      closeTerminalTab(activeTabId);
    });
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

  // ── Multi-Tab Support ──
  var tabList = [];
  var activeTabId = null;
  var tabCounter = 1;

  function registerExistingTerminal() {
    var tc = document.getElementById('terminal-container');
    if (!tc || !terminal) return;
    var wrapper = document.createElement('div');
    wrapper.className = 'xterm-tab-content';
    wrapper.setAttribute('data-tab-id', '1');
    wrapper.style.cssText = 'width:100%;height:100%;';
    var xtermEl = tc.querySelector('.xterm');
    if (xtermEl) {
      xtermEl.parentNode.insertBefore(wrapper, xtermEl);
      wrapper.appendChild(xtermEl);
    }
    tabList.push({ id: 1, xterm: terminal, wrapper: wrapper, ws: ws, fitAddon: fitAddon });
    activeTabId = 1;
    var t1 = document.querySelector('.terminal-tab[data-tab-id="1"]');
    if (t1) {
      t1.classList.add('active');
      t1.innerHTML = '<span class="tab-name">Terminal 1</span><button class="tab-close" data-tab-id="1">✕</button>';
      t1.querySelector('.tab-name').addEventListener('click', function () { switchToTab(1); });
      t1.querySelector('.tab-close').addEventListener('click', function (e) { e.stopPropagation(); closeTerminalTab(1); });
    }
  }

  function createTerminalTab() {
    tabCounter++;
    var id = tabCounter;
    var tc = document.getElementById('terminal-container');

    // Add tab to bar with its own close button
    var tabEl = document.createElement('div');
    tabEl.className = 'terminal-tab';
    tabEl.setAttribute('data-tab-id', id);
    tabEl.innerHTML = '<span class="tab-name">Terminal ' + id + '</span><button class="tab-close" data-tab-id="' + id + '">✕</button>';
    tabEl.querySelector('.tab-name').addEventListener('click', function () { switchToTab(id); });
    tabEl.querySelector('.tab-close').addEventListener('click', function (e) { e.stopPropagation(); closeTerminalTab(id); });
    document.getElementById('lco-terminal-tabs').appendChild(tabEl);

    // Create wrapper
    var wrapper = document.createElement('div');
    wrapper.className = 'xterm-tab-content';
    wrapper.setAttribute('data-tab-id', id);
    wrapper.style.cssText = 'width:100%;height:100%;display:none;';
    tc.appendChild(wrapper);

    // Create xterm
    var t = new Terminal({
      cursorBlink: true, cursorStyle: 'bar', fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: (terminal ? terminal.options.theme : {}),
      allowProposedApi: true, scrollback: 5000, tabStopWidth: 2,
    });
    if (typeof FitAddon !== 'undefined') {
      var fit = new FitAddon.FitAddon();
      t.loadAddon(fit);
    } else {
      var fit = null;
    }
    t.open(wrapper);
    setTimeout(function () { try { fit.fit(); } catch(e) {} }, 100);

    // WebSocket
    var tabWs = null;
    function connectWs() {
      try { tabWs = new WebSocket(WS_URL); } catch(e) { return; }
      tabWs.onopen = function () {
        // Delay resize until xterm DOM is laid out
        setTimeout(function () {
          var c = t.cols > 0 ? t.cols : 80;
          var r = t.rows > 0 ? t.rows : 24;
          tabWs.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
          console.log('[Terminal] Force resize tab ' + id + ':', c, 'x', r);
        }, 150);
      };
      // Buffer for reassembling fragmented messages (same as main terminal)
      var tabBuf = '';
      tabWs.onmessage = function (event) {
        tabBuf += event.data;
        while (tabBuf.length > 0) {
          var pipeIdx = tabBuf.indexOf('|');
          if (pipeIdx > 0 && pipeIdx < 10) {
            var lenStr = tabBuf.substring(0, pipeIdx);
            var msgLen = parseInt(lenStr, 10);
            if (!isNaN(msgLen) && tabBuf.length >= pipeIdx + 1 + msgLen) {
              var jsonStr = tabBuf.substring(pipeIdx + 1, pipeIdx + 1 + msgLen);
              tabBuf = tabBuf.substring(pipeIdx + 1 + msgLen);
              try { tabProcessMsg(JSON.parse(jsonStr)); } catch(_) {}
              continue;
            } else if (!isNaN(msgLen)) { break; }
          }
          try {
            var msg = JSON.parse(tabBuf);
            tabBuf = '';
            tabProcessMsg(msg);
          } catch (e) { break; }
        }
      };
      function tabProcessMsg(msg) {
        if (msg.type === 'output') {
          var d = msg.data || '';
          try { d = decodeURIComponent(d); } catch(_) {}
          t.write(d);
        }
      }
      tabWs.onclose = function () { setTimeout(connectWs, 3000); };
    }
    connectWs();

    t.onData(function (data) {
      if (tabWs && tabWs.readyState === WebSocket.OPEN) {
        tabWs.send(JSON.stringify({ type: 'input', data: data }));
      }
    });

    var tabObj = { id: id, xterm: t, wrapper: wrapper, ws: tabWs, fitAddon: fit };
    tabList.push(tabObj);
    switchToTab(id);
    // Focus the new terminal so keyboard input works immediately
    setTimeout(function () { try { t.focus(); } catch(e) {} }, 200);
    return id;
  }

  function switchToTab(id) {
    tabList.forEach(function (t) {
      t.wrapper.style.display = (t.id === id) ? '' : 'none';
    });
    activeTabId = id;
    document.querySelectorAll('.terminal-tab').forEach(function (el) {
      el.classList.toggle('active', parseInt(el.getAttribute('data-tab-id')) === id);
    });
    var active = tabList.find(function (t) { return t.id === id; });
    if (!active) return;
    // Force fit + refresh after DOM swap
    setTimeout(function () {
      if (active.fitAddon) {
        try { active.fitAddon.fit(); } catch(e) {}
      }
      try { active.xterm.refresh(0, active.xterm.rows - 1); } catch(e) {}
    }, 60);
    // Send resize to WS to wake up bash PS1
    if (active.ws && active.ws.readyState === WebSocket.OPEN) {
      var c = active.xterm.cols || 80, r = active.xterm.rows || 24;
      active.ws.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
    }
    // Focus the terminal so keyboard input reaches xterm
    setTimeout(function () { try { active.xterm.focus(); } catch(e) {} }, 100);

    // ResizeObserver: if container width is 0, wait for layout then fit
    if (active._resizeObs) active._resizeObs.disconnect();
    active._resizeObs = new ResizeObserver(function () {
      var w = active.wrapper.offsetWidth;
      if (w > 0 && active.fitAddon) {
        try { active.fitAddon.fit(); } catch(e) {}
      }
    });
    active._resizeObs.observe(active.wrapper);
  }

  function closeTerminalTab(id) {
    // Always allow closing — if last tab, reconnect fresh
    var tab = tabList.find(function (t) { return t.id === id; });
    if (!tab) return;
    // Kill WebSocket (backend kills PTY)
    if (tab.ws) { try { tab.ws.close(); } catch(e) {} }
    tab.xterm.dispose();
    if (tab.wrapper.parentNode) tab.wrapper.parentNode.removeChild(tab.wrapper);
    tabList = tabList.filter(function (t) { return t.id !== id; });
    var tabEl = document.querySelector('.terminal-tab[data-tab-id="' + id + '"]');
    if (tabEl) tabEl.remove();
    if (tabList.length > 0) {
      switchToTab(tabList[0].id);
    } else {
      // All tabs closed — auto-create fresh one
      createTerminalTab();
    }
  }

  window.LCOTerminal = {
    write: function (text) {
      var t = tabList.find(function (x) { return x.id === activeTabId; });
      if (t && t.xterm) t.xterm.write(text);
    },
    clear: function () {
      var t = tabList.find(function (x) { return x.id === activeTabId; });
      if (t && t.xterm) t.xterm.clear();
    },
    isConnected: function () {
      var t = tabList.find(function (x) { return x.id === activeTabId; });
      return t && t.ws && t.ws.readyState === WebSocket.OPEN;
    },
    connect: function () { /* reconnect active tab */ },
    focus: function () {
      var t = tabList.find(function (x) { return x.id === activeTabId; });
      if (t && t.xterm) t.xterm.focus();
    },
    handleResize: function () {
      tabList.forEach(function (t) {
        if (t.fitAddon) { try { t.fitAddon.fit(); } catch(e) {} }
      });
    },
    getTerminal: function () {
      var t = tabList.find(function (x) { return x.id === activeTabId; });
      return t ? t.xterm : null;
    },
    setWsUrl: function (url) { WS_URL = url; },
    createTab: createTerminalTab,
    switchTab: switchToTab,
    closeTab: closeTerminalTab,
    getTabCount: function () { return tabList.length; },
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
