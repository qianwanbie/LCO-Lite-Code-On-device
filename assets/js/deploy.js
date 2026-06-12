/**
 * LCO Deployment Center — auto-install Termux tools
 */
(function () {
  'use strict';

  var TOOLS = [
    { id: 'git',     name: 'Git',       desc: 'Version control' },
    { id: 'python',  name: 'Python',    desc: 'Script runtime' },
    { id: 'node',    name: 'Node.js',   desc: 'JS runtime (already installed)' },
    { id: 'clang',   name: 'Clang/Make', desc: 'C compiler (for node-pty)' },
    { id: 'claude',  name: 'Claude CLI', desc: 'AI assistant in terminal' },
    { id: 'php',     name: 'PHP',       desc: 'Script runtime' },
    { id: 'ruby',    name: 'Ruby',      desc: 'Script runtime' },
    { id: 'vim',     name: 'Vim',       desc: 'Text editor' },
    { id: 'openssh', name: 'SSH',       desc: 'Remote access' },
    { id: 'jq',      name: 'jq',        desc: 'JSON processor' },
  ];

  var modal, listEl, outputEl, allBtn;

  function init() {
    modal = document.getElementById('lco-deploy-modal');
    listEl = document.getElementById('lco-deploy-list');
    outputEl = document.getElementById('lco-deploy-output');
    allBtn = document.getElementById('lco-deploy-all');
    if (!modal) { setTimeout(init, 500); return; }

    document.getElementById('lco-deploy-close')?.addEventListener('click', hide);
    modal.addEventListener('click', function (e) { if (e.target === modal) hide(); });

    // Render tool checklist
    TOOLS.forEach(function (t) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;padding:6px 0;border-bottom:1px solid var(--lco-border)';
      row.innerHTML = '<input type="checkbox" id="tool-' + t.id + '" ' + (t.id === 'node' ? 'checked disabled' : '') + '> ' +
        '<label for="tool-' + t.id + '" style="flex:1;cursor:pointer"><b>' + t.name + '</b><br><small>' + t.desc + '</small></label>';
      listEl.appendChild(row);
    });

    if (allBtn) allBtn.addEventListener('click', runDeploy);
    console.log('[Deploy] Initialized');
  }

  function show() { if (modal) modal.classList.remove('hidden'); }
  function hide() { if (modal) modal.classList.add('hidden'); }

  function runDeploy() {
    var selected = [];
    TOOLS.forEach(function (t) {
      var cb = document.getElementById('tool-' + t.id);
      if (cb && cb.checked && !cb.disabled) selected.push(t.id);
    });
    if (!selected.length) { alert('Select at least one tool.'); return; }
    if (!window.LCOEditor || !window.LCOEditor.sendRpc) { alert('Backend not connected.'); return; }

    if (allBtn) allBtn.disabled = true;
    if (outputEl) { outputEl.style.display = ''; outputEl.textContent = 'Installing...\n'; }

    window.LCOEditor.sendRpc('deployInstall', { tools: selected }).then(function (r) {
      var out = (r && r.output) ? r.output : 'Done.';
      if (outputEl) outputEl.textContent = out;
      if (allBtn) allBtn.textContent = 'Done!';
      setTimeout(function () { hide(); }, 3000);
    }).catch(function (e) {
      if (outputEl) outputEl.textContent = 'Error: ' + (e.message || 'unknown');
      if (allBtn) allBtn.disabled = false;
    });
  }

  // Auto-show if backend is ready but deployment not done
  function checkAndShow() {
    if (!window.LCOEditor || !window.LCOEditor.sendRpc) { setTimeout(checkAndShow, 1000); return; }
    window.LCOEditor.sendRpc('deployStatus', {}).then(function (r) {
      if (!r || !r.ready) show();
    }).catch(function () { /* backend not running, skip */ });
  }
  setTimeout(checkAndShow, 3000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
