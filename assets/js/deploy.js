/**
 * LCO Setup Wizard — shows Termux commands on first launch
 */
(function () {
  'use strict';

  function init() {
    var wm = document.getElementById('lco-welcome-modal');
    if (!wm) { setTimeout(init, 500); return; }

    // Copy button 1: install tools
    var copy1Btn = document.getElementById('lco-copy-tools');
    if (copy1Btn) {
      copy1Btn.addEventListener('click', function () {
        var cmd = document.getElementById('lco-cmd-tools');
        if (cmd) { navigator.clipboard.writeText(cmd.textContent).then(function () {
          copy1Btn.textContent = 'Copied!'; setTimeout(function () { copy1Btn.textContent = 'Copy'; }, 2000);
        });}
      });
    }

    // Copy button 2: start backend
    var copy2Btn = document.getElementById('lco-copy-backend');
    if (copy2Btn) {
      copy2Btn.addEventListener('click', function () {
        var cmd = document.getElementById('lco-cmd-backend');
        if (cmd) { navigator.clipboard.writeText(cmd.textContent).then(function () {
          copy2Btn.textContent = 'Copied!'; setTimeout(function () { copy2Btn.textContent = 'Copy'; }, 2000);
        });}
      });
    }

    // Check connection button
    var checkBtn = document.getElementById('lco-welcome-check');
    if (checkBtn) {
      checkBtn.addEventListener('click', function () {
        var statusEl = document.getElementById('lco-welcome-status');
        if (statusEl) statusEl.textContent = 'Checking...';
        function tryCheck() {
          if (!window.LCOEditor || !window.LCOEditor.sendRpc) { setTimeout(tryCheck, 500); return; }
          window.LCOEditor.sendRpc('deployStatus', {}).then(function () {
            if (statusEl) statusEl.textContent = 'Connected!';
            wm.classList.add('hidden');
          }).catch(function () {
            if (statusEl) statusEl.textContent = 'Not connected yet. Run step 2 in Termux.';
          });
        }
        tryCheck();
      });
    }

    // Show on startup if backend not reachable
    function tryAutoCheck() {
      if (!window.LCOEditor || !window.LCOEditor.sendRpc) { setTimeout(tryAutoCheck, 500); return; }
      window.LCOEditor.sendRpc('deployStatus', {}).then(function () {
        wm.classList.add('hidden');
      }).catch(function () {
        wm.classList.remove('hidden');
      });
    }
    setTimeout(tryAutoCheck, 2000);

    console.log('[Setup] Initialized');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
