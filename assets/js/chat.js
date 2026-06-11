/**
 * LCO Claude Chat — uses LLM adapter (DeepSeek/Anthropic/OpenAI via RPC).
 * Claude also works interactively in the terminal (type 'claude' there).
 */
(function () {
  'use strict';
  var sidebar, messagesEl, inputEl, sendBtn, isVisible = false, isStreaming = false;

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
  function show() { if (!sidebar) return; sidebar.classList.remove('hidden'); isVisible = true; setTimeout(function () { inputEl.focus(); }, 200); }
  function hide() { if (sidebar) sidebar.classList.add('hidden'); isVisible = false; }
  window.LCOChat = { toggle: toggle, show: show, hide: hide };

  function sendMessage() {
    if (isStreaming || !inputEl) return;
    var text = inputEl.value.trim(); if (!text) return;
    addMsg(text, 'user'); inputEl.value = ''; isStreaming = true;
    if (sendBtn) sendBtn.disabled = true;
    var bubble = addMsg('', 'claude');
    window.LCOEditor.sendRpc('claudeChat', { message: text }).then(function (r) {
      updateBubble(bubble, (r.response || '(empty)').replace(/\x1b\[[0-9;]*m/g, ''));
      isStreaming = false; if (sendBtn) sendBtn.disabled = false;
    }).catch(function (e) {
      updateBubble(bubble, 'Error: ' + (e.message || 'unknown'));
      isStreaming = false; if (sendBtn) sendBtn.disabled = false;
    });
  }

  function updateBubble(el, text) { el.textContent = text; scrollDown(); }
  function addMsg(text, role) { var el = document.createElement('div'); el.className = 'chat-bubble ' + role; el.textContent = text; messagesEl.appendChild(el); scrollDown(); return el; }
  function scrollDown() { if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight; }

  function waitAndInit() { if (document.getElementById('lco-chat-sidebar')) init(); else setTimeout(waitAndInit, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitAndInit); else waitAndInit();
})();
