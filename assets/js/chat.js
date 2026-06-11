/**
 * LCO Claude Chat Sidebar
 *
 * Provides an embedded chat UI that communicates with Claude via
 * the Node.js backend. Messages are sent as JSON-RPC and responses
 * are streamed into chat bubbles.
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

    // Toggle button (both toolbar and workspace bar)
    var btnChat = document.getElementById('lco-btn-chat');
    var btnChatWs = document.getElementById('lco-btn-chat-ws');
    if (btnChat) btnChat.addEventListener('click', toggle);
    if (btnChatWs) btnChatWs.addEventListener('click', toggle);

    // Close button
    var btnClose = document.getElementById('lco-chat-close');
    if (btnClose) btnClose.addEventListener('click', hide);

    // Send button
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);

    // Enter to send, Shift+Enter for newline
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
    inputEl.focus();
    // Check Claude context
    addSystemMessage('Claude chat active — working directory: ' +
      (window.LCOFileExplorer ? 'current workspace' : 'lco-workspace'));
  }

  function hide() {
    if (!sidebar) return;
    sidebar.classList.add('hidden');
    isVisible = false;
  }

  // Expose toggle globally so the toolbar button works
  window.toggleClaudeChat = toggle;
  window.LCOChat = {
    toggle: toggle, show: show, hide: hide, isVisible: function () { return isVisible; }
  };

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  function sendMessage() {
    if (isStreaming || !inputEl) return;
    var text = inputEl.value.trim();
    if (!text) return;

    // Add user bubble
    addBubble(text, 'user');
    inputEl.value = '';
    isStreaming = true;
    if (sendBtn) sendBtn.disabled = true;

    // Create Claude bubble (will be updated with streamed response)
    var claudeBubble = addBubble('', 'claude');
    claudeBubble.id = 'claude-response-' + Date.now();

    // Send via RPC → backend spawns claude process
    if (!window.LCOEditor || !window.LCOEditor.sendRpc) {
      updateClaudeBubble(claudeBubble, 'Error: Editor bridge not ready.');
      isStreaming = false;
      if (sendBtn) sendBtn.disabled = false;
      return;
    }

    window.LCOEditor.sendRpc('claudeChat', { message: text }).then(function (result) {
      var output = (result && result.response) ? result.response : '(no response)';
      updateClaudeBubble(claudeBubble, output);
      isStreaming = false;
      if (sendBtn) sendBtn.disabled = false;
    }).catch(function (err) {
      updateClaudeBubble(claudeBubble, 'Error: ' + (err.message || 'unknown'));
      isStreaming = false;
      if (sendBtn) sendBtn.disabled = false;
    });
  }

  function updateClaudeBubble(el, text) {
    el.textContent = '';
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
  // Wait for editor, then init
  // ---------------------------------------------------------------------------

  function waitAndInit() {
    if (document.getElementById('lco-chat-sidebar') && window.LCOEditor) {
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
