/**
 * LCO Claude Chat Sidebar
 *
 * Connects to the Node.js backend via WebSocket /ws/claude for
 * interactive Claude Code sessions. Input is sent directly to
 * the Claude PTY process; output is streamed into chat bubbles.
 */
(function () {
  'use strict';

  var sidebar = null;
  var messagesEl = null;
  var inputEl = null;
  var sendBtn = null;
  var isVisible = false;
  var ws = null;
  var claudeBubble = null;
  var isConnected = false;

  var WS_URL = 'ws://127.0.0.1:9876/ws/claude';

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init() {
    sidebar = document.getElementById('lco-chat-sidebar');
    messagesEl = document.getElementById('lco-chat-messages');
    inputEl = document.getElementById('lco-chat-input');
    sendBtn = document.getElementById('lco-chat-send');

    if (!sidebar || !messagesEl || !inputEl) {
      setTimeout(init, 300);
      return;
    }

    // Toggle buttons
    var btnChat = document.getElementById('lco-btn-chat');
    var btnChatWs = document.getElementById('lco-btn-chat-ws');
    if (btnChat) btnChat.addEventListener('click', toggle);
    if (btnChatWs) btnChatWs.addEventListener('click', toggle);

    // Close button
    var btnClose = document.getElementById('lco-chat-close');
    if (btnClose) btnClose.addEventListener('click', hide);

    // Send button
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    // Enter to send
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    console.log('[Chat] Initialized');
  }

  // ---------------------------------------------------------------------------
  // Show / Hide
  // ---------------------------------------------------------------------------

  function toggle() {
    if (isVisible) hide();
    else show();
  }

  function show() {
    if (!sidebar) return;
    sidebar.classList.remove('hidden');
    isVisible = true;
    if (!isConnected) connect();
    if (inputEl) inputEl.focus();
  }

  function hide() {
    if (!sidebar) return;
    sidebar.classList.add('hidden');
    isVisible = false;
  }

  window.LCOChat = {
    toggle: toggle, show: show, hide: hide, isVisible: function () { return isVisible; }
  };

  // ---------------------------------------------------------------------------
  // WebSocket connection to /ws/claude
  // ---------------------------------------------------------------------------

  function connect() {
    if (ws) { try { ws.close(); } catch (_) {} }
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      addSystemMessage('WebSocket error: ' + e.message);
      return;
    }
    ws.onopen = function () {
      isConnected = true;
      addSystemMessage('⌬ Claude Code session started');
      if (sendBtn) sendBtn.disabled = false;
    };
    ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg.type === 'claude-output') {
          appendClaudeOutput(msg.data);
        } else if (msg.type === 'claude-error') {
          addSystemMessage('Error: ' + msg.data);
        } else if (msg.type === 'claude-ready') {
          addSystemMessage('Claude is ready. Type your message below.');
        } else if (msg.type === 'claude-exit') {
          addSystemMessage('Claude session ended (exit ' + msg.exitCode + '). Click ⌬ to restart.');
          isConnected = false;
        }
      } catch (_) { /* non-JSON chunk */ }
    };
    ws.onerror = function () {
      addSystemMessage('Connection error. Is the backend running?');
    };
    ws.onclose = function () {
      isConnected = false;
      if (isVisible) addSystemMessage('Session closed. Toggle chat to reconnect.');
    };
  }

  // ---------------------------------------------------------------------------
  // Send message to Claude
  // ---------------------------------------------------------------------------

  function sendMessage() {
    if (!inputEl) return;
    var text = inputEl.value;
    if (!text && !isConnected) return;
    inputEl.value = '';

    if (text) {
      addBubble(text, 'user');
    }

    if (!isConnected) {
      addSystemMessage('Reconnecting...');
      connect();
      return;
    }

    // Start new Claude bubble for streaming output
    claudeBubble = addBubble('', 'claude');
    try {
      ws.send(JSON.stringify({ type: 'claude-input', data: text + '\n' }));
    } catch (e) {
      addSystemMessage('Send error: ' + e.message);
    }
  }

  function appendClaudeOutput(data) {
    // Decode URI-encoded data
    try { data = decodeURIComponent(data); } catch (_) {}
    // Strip ANSI escape codes for chat display
    var clean = data.replace(/\x1b\[[0-9;]*m/g, '');
    // If there's an active bubble, append; otherwise create new
    if (claudeBubble) {
      claudeBubble.textContent += clean;
    } else {
      claudeBubble = addBubble(clean, 'claude');
    }
    scrollToBottom();
  }

  function addBubble(text, role) {
    var el = document.createElement('div');
    el.className = 'chat-bubble ' + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addSystemMessage(text) {
    addBubble(text, 'system');
  }

  function scrollToBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // Wait for DOM + editor, then init
  // ---------------------------------------------------------------------------

  function waitAndInit() {
    if (document.getElementById('lco-chat-sidebar')) {
      init();
    } else {
      setTimeout(waitAndInit, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInit);
  } else {
    waitAndInit();
  }

})();
