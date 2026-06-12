/**
 * LCO Navigation — Bottom nav bar + FAB + mobile UX
 */
(function () {
  'use strict';

  var navBar, fabBar;
  var ACTIVE_TAB = 'editor';

  function init() {
    navBar = document.getElementById('lco-navbar');
    fabBar = document.getElementById('lco-fab');
    if (!navBar) { setTimeout(init, 300); return; }

    // Tab switching
    navBar.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    // FAB buttons
    var fabSave = document.getElementById('lco-fab-save');
    var fabRun = document.getElementById('lco-fab-run');
    if (fabSave) fabSave.addEventListener('click', function () {
      if (window.LCOEditor && window.LCOEditor.save) window.LCOEditor.save();
    });
    if (fabRun) fabRun.addEventListener('click', function () {
      var ed = window.LCOEditor && window.LCOEditor.getEditor && window.LCOEditor.getEditor();
      if (!ed) return;
      var path = ed.getModel() ? ed.getModel().uri.path : '';
      if (window.LCOFileExplorer && window.LCOFileExplorer.openFile) {
        // Save then re-run
        window.LCOEditor.save();
      }
    });

    // Soft keyboard handling
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () {
        var h = window.visualViewport.height;
        var container = document.getElementById('editor-container');
        if (container) container.style.height = h + 'px';
      });
    }

    // Detect narrow screen → add is-mobile class
    if (window.innerWidth < 600) {
      document.body.classList.add('is-mobile');
      switchTab('editor');
    }

    // Watch for resize
    window.addEventListener('resize', function () {
      document.body.classList.toggle('is-mobile', window.innerWidth < 600);
    });

    console.log('[Nav] Initialized');
  }

  function switchTab(tab) {
    ACTIVE_TAB = tab;
    // Update nav bar highlights
    navBar.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });

    // Show/hide panels for narrow screen
    var sidebar = document.getElementById('lco-sidebar');
    var mainArea = document.getElementById('lco-main-area');
    var preview = document.getElementById('lco-preview-panel');

    if (window.innerWidth < 600) {
      sidebar.classList.toggle('show', tab === 'explorer');
      mainArea.classList.toggle('show', tab === 'editor');
      preview.classList.toggle('show', tab === 'preview');
      if (tab === 'terminal') mainArea.classList.add('show');
      if (tab === 'settings') {
        var sm = document.getElementById('lco-settings-modal');
        if (sm) sm.classList.remove('hidden');
      }
      // Show FAB in editor mode
      fabBar.classList.toggle('hidden', tab !== 'editor');
      // Show keyboard bar in terminal mode
      var kb = document.getElementById('lco-keyboard-bar');
      if (kb) kb.classList.toggle('hidden', tab !== 'terminal');

      // Refit terminal if switching to editor/terminal
      if (tab === 'terminal' && window.LCOTerminal && window.LCOTerminal.handleResize) {
        setTimeout(function () { window.LCOTerminal.handleResize(); }, 200);
      }
    }
  }

  window.LCONav = { switchTab: switchTab, getActiveTab: function () { return ACTIVE_TAB; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
