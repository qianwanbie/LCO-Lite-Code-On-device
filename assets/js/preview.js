/**
 * LCO Web Preview Panel
 * Opens URLs from the preview panel in an external browser.
 */
(function () {
  'use strict';
  var panel, urlInput, isVisible = false;

  function init() {
    panel = document.getElementById('lco-preview-panel');
    urlInput = document.getElementById('lco-preview-url');
    if (!panel) { setTimeout(init, 300); return; }

    document.getElementById('lco-btn-preview')?.addEventListener('click', toggle);
    document.getElementById('lco-preview-close')?.addEventListener('click', hide);
    document.getElementById('lco-preview-go')?.addEventListener('click', openUrl);
    if (urlInput) urlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') openUrl();
    });
    console.log('[Preview] Initialized');
  }

  function toggle() { isVisible ? hide() : show(); }
  function show() { if (panel) panel.classList.remove('hidden'); isVisible = true; }
  function hide() { if (panel) panel.classList.add('hidden'); isVisible = false; }

  function openUrl() {
    var url = (urlInput && urlInput.value.trim()) || 'http://127.0.0.1:8080';
    try { window.open(url, '_blank'); } catch (e) {}
  }

  function waitAndInit() { if (document.getElementById('lco-preview-panel')) init(); else setTimeout(waitAndInit, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitAndInit);
  else waitAndInit();
})();
