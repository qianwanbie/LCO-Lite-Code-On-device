/**
 * LCO Web Preview Panel — loads URL in embedded iframe.
 */
(function () {
  'use strict';
  var panel, urlInput, iframe, placeholder, isVisible = false;

  function init() {
    panel = document.getElementById('lco-preview-panel');
    urlInput = document.getElementById('lco-preview-url');
    iframe = document.getElementById('lco-preview-iframe');
    placeholder = document.getElementById('lco-preview-placeholder');
    if (!panel) { setTimeout(init, 300); return; }

    document.getElementById('lco-btn-preview')?.addEventListener('click', toggle);
    document.getElementById('lco-btn-toggle-preview-ws')?.addEventListener('click', toggle);
    document.getElementById('lco-preview-close')?.addEventListener('click', hide);
    document.getElementById('lco-preview-go')?.addEventListener('click', loadUrl);
    if (urlInput) urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') loadUrl();
    });
    console.log('[Preview] Initialized');
  }

  function toggle() { isVisible ? hide() : show(); }
  function show() { if (panel) panel.classList.remove('hidden'); isVisible = true; }
  function hide() { if (panel) panel.classList.add('hidden'); isVisible = false; }

  function loadUrl() {
    var url = (urlInput && urlInput.value.trim()) || 'http://127.0.0.1:8080';
    if (!/^https?:\/\//.test(url)) url = 'http://' + url;
    if (iframe) {
      iframe.style.display = '';
      iframe.src = url;
    }
    if (placeholder) placeholder.style.display = 'none';
  }

  function waitAndInit() { if (document.getElementById('lco-preview-panel')) init(); else setTimeout(waitAndInit, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitAndInit);
  else waitAndInit();
})();
