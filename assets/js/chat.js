/**
 * LCO Claude Chat Sidebar
 *
 * Sends messages via JSON-RPC (claudeChat) to the backend LLM adapter.
 * Responses are rendered in chat bubbles. Supports auto-execution of
 * file:/shell:/read: blocks in Claude's responses.
 */
(function () {
  'use strict';

  var sidebar = null;
  var messagesEl = null;
  var inputEl = null;
  var sendBtn = null;
  var isVisible = false;
  var isStreaming = false;

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

    // Enter to send, Shift+Enter newline
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

  function toggle() { isVisible ? hide() : show(); }

  function show() {
    if (!sidebar) return;
    sidebar.classList.remove('hidden');
    isVisible = true;
    setTimeout(function () { inputEl.focus(); }, 200);
  }

  function hide() {
    if (!sidebar) return;
    sidebar.classList.add('hidden');
    isVisible = false;
  }

  window.LCOChat = {
    toggle: toggle, show: show, hide: hide,
    isVisible: function () { return isVisible; }
  };

  // ---------------------------------------------------------------------------
  // Send message via JSON-RPC
  // ---------------------------------------------------------------------------

  function sendMessage() {
    if (isStreaming || !inputEl) return;
    var text = inputEl.value.trim();
    if (!text) return;

    addBubble(text, 'user');
    inputEl.value = '';
    isStreaming = true;
    if (sendBtn) sendBtn.disabled = true;

    var bubble = addBubble('', 'claude');
    var bubbleId = 'claude-' + Date.now();
    bubble.id = bubbleId;

    if (!window.LCOEditor || !window.LCOEditor.sendRpc) {
      updateBubble(bubble, 'Editor bridge not ready.');
      isStreaming = false;
      if (sendBtn) sendBtn.disabled = false;
      return;
    }

    window.LCOEditor.sendRpc('claudeChat', { message: text }).then(function (result) {
      var output = result && result.response ? result.response : '(no response)';
      // Strip ANSI escape codes
      output = output.replace(/\x1b\[[0-9;]*m/g, '');
      updateBubble(bubble, output);
      isStreaming = false;
      if (sendBtn) sendBtn.disabled = false;
    }).catch(function (err) {
      updateBubble(bubble, 'Error: ' + (err.message || 'unknown'));
      isStreaming = false;
      if (sendBtn) sendBtn.disabled = false;
    });
  }

  function updateBubble(el, text) {
    el.textContent = text;
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
  // Wait for DOM + editor bridge, then init
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
