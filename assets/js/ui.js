/**
 * LCO UI — Top Bar, Settings, Virtual Keyboard, Tutorial, Theme, Locale
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Theme Toggle (Dark/Light)
  // ---------------------------------------------------------------------------
  var isDark = true;
  var themeBtn = document.getElementById('lco-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      isDark = !isDark;
      document.body.classList.toggle('light-mode', !isDark);
      themeBtn.textContent = isDark ? '☀️' : '🌙';
      var ed = window.LCOEditor && window.LCOEditor.getEditor && window.LCOEditor.getEditor();
      if (ed) {
        monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Locale Toggle (EN/ZH)
  // ---------------------------------------------------------------------------
  var localeBtn = document.getElementById('lco-btn-locale');
  if (localeBtn && window.LCO_i18n) {
    localeBtn.addEventListener('click', function () {
      window.LCO_i18n.setLocale(window.LCO_i18n.getLocale() === 'zh' ? 'en' : 'zh');
      localeBtn.textContent = window.LCO_i18n.getLocale().toUpperCase();
    });
    localeBtn.textContent = window.LCO_i18n.getLocale().toUpperCase();
  }

  // ---------------------------------------------------------------------------
  // Settings Modal
  // ---------------------------------------------------------------------------
  var settingsModal = document.getElementById('lco-settings-modal');
  var settingsBtn = document.getElementById('lco-settings-btn');
  var settingsClose = document.getElementById('lco-settings-close');
  var kbBtn = document.getElementById('lco-keyboard-toggle');
  var kbBar = document.getElementById('lco-keyboard-bar');
  var fontSel = document.getElementById('lco-font-size');

  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', function () { settingsModal.classList.remove('hidden'); });
    settingsClose.addEventListener('click', function () { settingsModal.classList.add('hidden'); });
    settingsModal.addEventListener('click', function (e) { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });
  }
  if (kbBtn && kbBar) {
    var kbVisible = false;
    kbBtn.addEventListener('click', function () {
      kbVisible = !kbVisible;
      kbBar.classList.toggle('hidden', !kbVisible);
      kbBtn.textContent = kbVisible ? 'Hide' : 'Show';
    });
  }
  if (fontSel) {
    fontSel.addEventListener('change', function () {
      var sz = parseInt(fontSel.value);
      var ed = window.LCOEditor && window.LCOEditor.getEditor && window.LCOEditor.getEditor();
      if (ed) ed.updateOptions({ fontSize: sz });
      var term = window.LCOTerminal && window.LCOTerminal.getTerminal && window.LCOTerminal.getTerminal();
      if (term) term.setOption('fontSize', sz);
    });
  }

  // ---------------------------------------------------------------------------
  // Tutorial Modal
  // ---------------------------------------------------------------------------
  var tutorialModal = document.getElementById('lco-tutorial-modal');
  var tutorialBtn = document.getElementById('lco-tutorial-btn');
  var tutorialClose = document.getElementById('lco-tutorial-close');
  if (tutorialBtn && tutorialModal) {
    tutorialBtn.addEventListener('click', function () { tutorialModal.classList.remove('hidden'); });
    tutorialClose.addEventListener('click', function () { tutorialModal.classList.add('hidden'); });
    tutorialModal.addEventListener('click', function (e) { if (e.target === tutorialModal) tutorialModal.classList.add('hidden'); });
  }

  // ---------------------------------------------------------------------------
  // Virtual Keyboard
  // ---------------------------------------------------------------------------
  var KEY_MAP = {
    ctrl: '\x1b[1;5', alt: '\x1b[1;3', esc: '\x1b', tab: '\t',
    up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C',
    slash: '/', dash: '-', pipe: '|',
  };
  var kButtons = document.querySelectorAll('#lco-keyboard-bar button');
  kButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-key');
      var seq = KEY_MAP[key] || key;
      var term = window.LCOTerminal && window.LCOTerminal.getTerminal && window.LCOTerminal.getTerminal();
      if (term) term.write(seq);
    });
  });

  console.log('[UI] Initialized');
})();
