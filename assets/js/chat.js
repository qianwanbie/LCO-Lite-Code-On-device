/**
 * LCO Claude Chat Sidebar — WebSocket streaming via /ws/claude
 *
 * Opens a persistent Claude CLI session via backend node-pty.
 * The Claude process survives chat close and reattaches on reopen.
 */
(function () {
  'use strict';

  var sidebar, messagesEl, inputEl, sendBtn;
  var isVisible = false, ws = null, isConnected = false;
  var WS_URL = 'ws://127.0.0.1:9876/ws/claude';

  function init() {
    sidebar = document.getElementById('lco-chat-sidebar');
    messagesEl = document.getElementById('lco-chat-messages');
    inputEl = document.getElementById('lco-chat-input');
    sendBtn = document.getElementById('lco-chat-send');
    if (!sidebar || !messagesEl || !inputEl) { setTimeout(init, 300); return; }

    document.getElementById('lco-btn-chat')?.addEventListener('click', toggle);
    document.getElementById('lco-btn-chat-ws')?.addEventListener('click', toggle);
    document.getElementById('lco-chat-close')?.addEventListener('click', hide);
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    console.log('[Chat] Initialized');
  }

  function toggle() { isVisible ? hide() : show(); }
  function show() {
    if (!sidebar) return;
    sidebar.classList.remove('hidden'); isVisible = true;
    if (!isConnected) connect();
    setTimeout(function () { inputEl.focus(); }, 200);
  }
  function hide() { if (sidebar) sidebar.classList.add('hidden'); isVisible = false; }
  window.LCOChat = { toggle: toggle, show: show, hide: hide };

  // ── WebSocket ──

  function connect() {
    if (ws) { try { ws.close(); } catch (_) {} }
    try { ws = new WebSocket(WS_URL); } catch (e) { addMsg('Connection failed', 'system'); return; }

    ws.onopen = function () {
      isConnected = true;
      addMsg('⌬ Claude CLI starting…', 'system');
    };

    ws.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data);
        if (m.type === 'claude-output') {
          var d = m.data || '';
          try { d = decodeURIComponent(d); } catch (_) {}
          addMsg(d, 'claude');
        } else if (m.type === 'claude-ready') {
          // Session ready
        } else if (m.type === 'claude-error') {
          addMsg('Error: ' + m.data, 'system');
        }
      } catch (_) {}
    };

    ws.onerror = function () { addMsg('Connection error', 'system'); };
    ws.onclose = function () { isConnected = false; };
  }

  function sendMessage() {
    if (!inputEl) return;
    var text = inputEl.value; inputEl.value = '';
    if (!text) return;
    addMsg(text, 'user');
    if (!isConnected) { connect(); return; }
    try { ws.send(JSON.stringify({ type: 'claude-input', data: text + '\n' })); } catch (e) {}
  }

  function addMsg(text, role) {
    var el = document.createElement('div');
    el.className = 'chat-bubble ' + (role === 'claude' ? 'claude' : role === 'system' ? 'system' : 'user');
    if (role === 'claude') {
      // Append to last claude bubble if it exists
      var last = messagesEl.querySelector('.chat-bubble.claude:last-child');
      if (last) { last.textContent += text; scrollDown(); return last; }
    }
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollDown();
    return el;
  }

  function scrollDown() { if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight; }

  function waitAndInit() {
    if (document.getElementById('lco-chat-sidebar')) init(); else setTimeout(waitAndInit, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitAndInit);
  else waitAndInit();
})();
