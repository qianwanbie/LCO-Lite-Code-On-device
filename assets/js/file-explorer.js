/**
 * LCO File Explorer
 *
 * Renders a tree view in the left sidebar using data from
 * IDEEngine.listFiles() via the existing JSON-RPC bridge.
 *
 * Features:
 *  - Async tree loading (expand to load children)
 *  - Click file → readFile → display in Monaco
 *  - Right-click context menu → Git operations
 *  - Refresh button
 *  - File type icons
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var treeContainer = null;
  var contextMenu = null;
  var expandedPaths = {};
  var fileCache = {};        // path → FileInfo
  var selectedPath = null;

  // ---------------------------------------------------------------------------
  // Icons
  // ---------------------------------------------------------------------------
  var FILE_ICONS = {
    dart:   '',   // custom unicode
    js:     '',
    json:   '',
    yaml:   '',
    yml:    '',
    html:   '',
    css:    '',
    md:     '',
    py:     '',
    java:   '',
    kt:     '',
    xml:    '',
    gradle: '',
  };

  var FOLDER_ICON_OPEN  = '▾'; // ▾
  var FOLDER_ICON_CLOSED = '▸'; // ▸
  var FILE_ICON_DEFAULT  = '●'; // ●

  function getIconClass(name, isDir) {
    if (isDir) return 'folder';
    var ext = name.split('.').pop().toLowerCase();
    return FILE_ICONS[ext] ? ext : 'file';
  }

  function getIconChar(isDir) {
    return isDir ? FOLDER_ICON_CLOSED : '  '; // spacing for alignment
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Load the root directory and render the tree.
   */
  function refresh() {
    if (!window.LCOEditor || !window.LCOEditor.sendRpc) {
      console.warn('[FileExplorer] Bridge not ready, retrying in 500ms...');
      setTimeout(refresh, 500);
      return;
    }
    var root = treeContainer.querySelector('[data-path="/"]');
    if (root) {
      loadChildren(root, '/');
    } else {
      treeContainer.innerHTML = '';
      loadChildren(treeContainer, '/');
    }
  }

  function loadChildren(parentEl, dirPath) {
    // Show loading indicator
    var loadingEl = document.createElement('div');
    loadingEl.className = 'lco-tree-node';
    loadingEl.innerHTML = '<span class="icon"></span><span class="name" style="color:var(--lco-text-muted)">Loading...</span>';
    parentEl.appendChild(loadingEl);

    window.LCOEditor.sendRpc('listFiles', { dirPath: dirPath }).then(function (result) {
      // Remove loading
      parentEl.removeChild(loadingEl);

      var files = (result && result.files) ? result.files : [];
      // Cache files
      files.forEach(function (f) { fileCache[f.path] = f; });

      // Remove old children
      var oldChildren = parentEl.querySelectorAll(':scope > .lco-tree-node, :scope > .lco-tree-children');
      // Keep the root node itself if parentEl IS the root
      if (parentEl !== treeContainer) {
        // Only replace children, not the parent node
        var next = parentEl.nextElementSibling;
        while (next && next.classList.contains('lco-tree-children')) {
          var toRemove = next;
          next = next.nextElementSibling;
          parentEl.parentNode.removeChild(toRemove);
        }
      } else {
        // Root: remove direct tree-node children
        oldChildren.forEach(function (el) { el.remove(); });
      }

      // Sort: dirs first, then files, both alphabetically
      files.sort(function (a, b) {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      // Render
      if (parentEl === treeContainer) {
        // Root level
        files.forEach(function (f) {
          renderNode(parentEl, f, 0);
        });
      } else {
        // Sub-directory
        var wrapper = document.createElement('div');
        wrapper.className = 'lco-tree-children'; // not collapsed
        files.forEach(function (f) {
          renderNode(wrapper, f, 0);
        });
        parentEl.parentNode.insertBefore(wrapper, parentEl.nextElementSibling);
        // Update parent chevron
        var chevron = parentEl.querySelector('.chevron');
        if (chevron) { chevron.textContent = FOLDER_ICON_OPEN; chevron.classList.add('expanded'); }
      }

      expandedPaths[dirPath] = true;
    }).catch(function (err) {
      console.error('[FileExplorer] listFiles failed:', err);
      if (loadingEl.parentNode) loadingEl.parentNode.removeChild(loadingEl);
    });
  }

  function renderNode(parentEl, fileInfo, depth) {
    var isDir = fileInfo.type === 'directory';
    var iconClass = getIconClass(fileInfo.name, isDir);

    var node = document.createElement('div');
    node.className = 'lco-tree-node';
    node.setAttribute('data-path', fileInfo.path);
    node.setAttribute('data-type', fileInfo.type);
    node.style.paddingLeft = (8 + depth * 16) + 'px';

    node.innerHTML =
      (isDir ? '<span class="chevron">' + FOLDER_ICON_CLOSED + '</span>'
             : '<span class="chevron" style="visibility:hidden">' + FOLDER_ICON_CLOSED + '</span>') +
      '<span class="icon ' + iconClass + '">' + getIconChar(isDir) + '</span>' +
      '<span class="name">' + escapeHtml(fileInfo.name) + '</span>';

    // ── Click handler ──
    node.addEventListener('click', function (e) {
      e.stopPropagation();
      selectNode(node);

      if (isDir) {
        toggleDirectory(node, fileInfo.path);
      } else {
        openFile(fileInfo.path, fileInfo.name);
      }
    });

    // ── Right-click handler ──
    node.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      selectNode(node);
      showContextMenu(e.clientX, e.clientY, fileInfo);
    });

    parentEl.appendChild(node);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function toggleDirectory(node, dirPath) {
    var wrapper = node.nextElementSibling;
    var chevron = node.querySelector('.chevron');

    if (expandedPaths[dirPath]) {
      // Collapse
      expandedPaths[dirPath] = false;
      if (chevron) { chevron.textContent = FOLDER_ICON_CLOSED; chevron.classList.remove('expanded'); }
      if (wrapper && wrapper.classList.contains('lco-tree-children')) {
        wrapper.classList.add('collapsed');
      }
    } else {
      // Expand
      expandedPaths[dirPath] = true;
      if (chevron) { chevron.textContent = FOLDER_ICON_OPEN; chevron.classList.add('expanded'); }

      if (wrapper && wrapper.classList.contains('lco-tree-children')) {
        wrapper.classList.remove('collapsed');
      } else {
        // First time expanding: load children
        loadChildren(node, dirPath);
      }
    }
  }

  function openFile(path, name) {
    if (!window.LCOEditor || !window.LCOEditor.openFile) {
      console.warn('[FileExplorer] Editor not ready');
      return;
    }
    var lang = detectLanguage(name);
    window.LCOEditor.openFile(path, lang).then(function () {
      updateStatus('📄 ' + path);
    }).catch(function (err) {
      console.error('[FileExplorer] openFile failed:', err);
      updateStatus('✗ Failed to open: ' + path, 'error');
    });
  }

  function selectNode(node) {
    // Clear previous selection
    var prev = treeContainer.querySelector('.lco-tree-node.active');
    if (prev) prev.classList.remove('active');
    node.classList.add('active');
    selectedPath = node.getAttribute('data-path');
  }

  // ---------------------------------------------------------------------------
  // Context Menu
  // ---------------------------------------------------------------------------

  function showContextMenu(x, y, fileInfo) {
    if (!contextMenu) return;
    var isDir = fileInfo.type === 'directory';

    contextMenu.innerHTML = '';

    addMenuItem('Open', function () {
      if (!isDir) openFile(fileInfo.path, fileInfo.name);
      hideContextMenu();
    });

    addMenuItem('Copy Path', function () {
      copyToClipboard(fileInfo.path);
      hideContextMenu();
    });

    addSeparator();

    addMenuItem('Git Status', function () {
      runGitAndShow(['status']);
      hideContextMenu();
    });

    addMenuItem('Git Log', function () {
      runGitAndShow(['log', '--oneline', '-5']);
      hideContextMenu();
    });

    if (!isDir) {
      addMenuItem('Git Add', function () {
        runGitAndShow(['add', fileInfo.path]);
        hideContextMenu();
      });
      addMenuItem('Run', function () {
        runScriptFile(fileInfo.path, fileInfo.name);
        hideContextMenu();
      });
    }

    addSeparator();

    addMenuItem('Rename', function () {
      renameFilePrompt(fileInfo);
      hideContextMenu();
    });

    addMenuItem('Delete', function () {
      deleteFileConfirm(fileInfo);
      hideContextMenu();
    });

    addSeparator();

    addMenuItem('Refresh', function () {
      refresh();
      hideContextMenu();
    });

    contextMenu.classList.remove('hidden');
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';

    // Ensure menu stays within viewport
    var rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      contextMenu.style.top = (y - rect.height) + 'px';
    }
  }

  function addMenuItem(label, handler) {
    var item = document.createElement('div');
    item.className = 'menu-item';
    item.textContent = label;
    item.addEventListener('click', handler);
    contextMenu.appendChild(item);
  }

  function addSeparator() {
    var sep = document.createElement('div');
    sep.className = 'menu-separator';
    contextMenu.appendChild(sep);
  }

  function hideContextMenu() {
    if (contextMenu) contextMenu.classList.add('hidden');
  }

  function runGitAndShow(args) {
    if (!window.LCOEditor || !window.LCOEditor.sendRpc) return;
    window.LCOEditor.sendRpc('runGitCommand', { args: args }).then(function (result) {
      updateStatus('⎇ ' + result.stdout.split('\n')[0], 'success');
      if (window.LCOTerminal && window.LCOTerminal.write) {
        window.LCOTerminal.write('\r\n\x1b[33m$ git ' + args.join(' ') + '\x1b[0m\r\n');
        window.LCOTerminal.write(result.stdout);
        if (result.stderr) {
          window.LCOTerminal.write('\x1b[31m' + result.stderr + '\x1b[0m');
        }
      }
    }).catch(function (err) {
      updateStatus('✗ Git failed: ' + err.message, 'error');
    });
  }

  function deleteFileConfirm(fileInfo) {
    var name = fileInfo.name;
    if (!confirm('Delete "' + name + '"?' + (fileInfo.type === 'directory' ? ' This will delete all contents.' : ''))) return;
    window.LCOEditor.sendRpc('deleteFile', { path: fileInfo.path }).then(function () {
      updateStatus('🗑 Deleted: ' + name);
      refresh();
    }).catch(function (err) {
      updateStatus('✗ Delete failed: ' + err.message, 'error');
    });
  }

  function renameFilePrompt(fileInfo) {
    var newName = prompt('Rename "' + fileInfo.name + '"', fileInfo.name);
    if (!newName || newName === fileInfo.name) return;
    var parentDir = fileInfo.path.substring(0, fileInfo.path.lastIndexOf('/') + 1);
    var newPath = parentDir + newName;
    window.LCOEditor.sendRpc('renameFile', { oldPath: fileInfo.path, newPath: newPath }).then(function () {
      updateStatus('✎ Renamed: ' + fileInfo.name + ' → ' + newName);
      refresh();
    }).catch(function (err) {
      updateStatus('✗ Rename failed: ' + err.message, 'error');
    });
  }

  function runScriptFile(path, name) {
    var ext = name.split('.').pop().toLowerCase();
    if (['py', 'js', 'sh', 'dart'].indexOf(ext) < 0) {
      updateStatus('⚠ Unsupported type: .' + ext, 'warn');
      return;
    }
    updateStatus('▶ Running: ' + name);
    if (window.LCOTerminal && window.LCOTerminal.write) {
      window.LCOTerminal.write('\r\n\x1b[1;36m▶ Running: ' + path + '\x1b[0m\r\n');
    }
    window.LCOEditor.sendRpc('runScript', { path: path }).then(function (result) {
      updateStatus('✓ Launched: ' + name);
    }).catch(function (err) {
      updateStatus('✗ Run failed: ' + err.message, 'error');
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function detectLanguage(filename) {
    var ext = filename.split('.').pop().toLowerCase();
    var map = {
      dart: 'dart', js: 'javascript', ts: 'typescript',
      json: 'json', yaml: 'yaml', yml: 'yaml',
      html: 'html', css: 'css', xml: 'xml',
      py: 'python', java: 'java', kt: 'kotlin',
      md: 'markdown', sql: 'sql', sh: 'shell',
      gradle: 'groovy', properties: 'ini',
    };
    return map[ext] || 'plaintext';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    updateStatus('📋 Copied: ' + text);
  }

  function updateStatus(msg, type) {
    var bar = document.getElementById('lco-status-bar');
    if (!bar) return;
    bar.textContent = msg;
    bar.className = type || '';
    clearTimeout(bar._timer);
    bar._timer = setTimeout(function () { bar.className = ''; }, 3000);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init() {
    treeContainer = document.getElementById('file-explorer-tree');
    contextMenu = document.getElementById('lco-context-menu');

    if (!treeContainer) {
      console.warn('[FileExplorer] Tree container not found');
      return;
    }

    // Refresh button
    var refreshBtn = document.getElementById('lco-refresh-explorer');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        refresh();
      });
    }

    // ── Workspace management ──
    initWorkspaceBar();

    // Hide context menu on outside click
    document.addEventListener('click', function () {
      hideContextMenu();
    });

    // Initial load
    refresh();
    // Check Claude context on startup
    setTimeout(function () { checkClaudeConfig(currentWorkspace); }, 1000);

    console.log('[FileExplorer] Initialized');
  }

  // ── Workspace Bar Logic ──
  var currentWorkspace = 'lco-workspace';
  var modalMode = 'new'; // 'new' | 'switch'

  function initWorkspaceBar() {
    var btnNew = document.getElementById('lco-btn-new-project');
    var btnSwitch = document.getElementById('lco-btn-switch-project');
    var btnHome = document.getElementById('lco-btn-home');
    var btnClose = document.getElementById('lco-modal-close');
    var btnCancel = document.getElementById('lco-modal-cancel');
    var btnConfirm = document.getElementById('lco-modal-confirm');
    var modal = document.getElementById('lco-workspace-modal');

    if (btnNew) btnNew.addEventListener('click', function () { openModal('new'); });
    if (btnSwitch) btnSwitch.addEventListener('click', function () { openModal('switch'); });
    if (btnHome) btnHome.addEventListener('click', switchToHome);
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    if (btnConfirm) btnConfirm.addEventListener('click', handleModalConfirm);
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

    // Detect new folders after git operations → auto-refresh project list
    window.addEventListener('lco-file-change', function (e) {
      var detail = (typeof e.detail === 'string') ? JSON.parse(e.detail) : e.detail;
      if (detail && detail.params && detail.params.type === 'created') {
        // New file/folder created — could be a git clone result
        setTimeout(refreshWorkspaceName, 2000);
      }
    });
  }

  function openModal(mode) {
    modalMode = mode;
    var modal = document.getElementById('lco-workspace-modal');
    var title = document.getElementById('lco-modal-title');
    var body = document.getElementById('lco-modal-body');
    var confirmBtn = document.getElementById('lco-modal-confirm');

    if (!modal || !title || !body) return;

    if (mode === 'new') {
      title.textContent = 'New Project';
      body.innerHTML = '<input id="lco-new-project-name" type="text" placeholder="my-project" autofocus>';
      confirmBtn.textContent = 'Create';
    } else {
      title.textContent = 'Switch Project';
      confirmBtn.textContent = 'Switch';
      body.innerHTML = '<div class="project-list" id="lco-project-list">Loading…</div>';
      loadProjectList();
    }

    modal.classList.remove('hidden');
    // Focus input if new project
    setTimeout(function () {
      var input = document.getElementById('lco-new-project-name');
      if (input) input.focus();
    }, 100);
  }

  function closeModal() {
    var modal = document.getElementById('lco-workspace-modal');
    if (modal) modal.classList.add('hidden');
  }

  function loadProjectList() {
    // List root folders to choose from
    window.LCOEditor.sendRpc('listFiles', { dirPath: '/' }).then(function (result) {
      var list = document.getElementById('lco-project-list');
      if (!list) return;
      var files = (result && result.files) ? result.files : [];
      var folders = files.filter(function (f) { return f.type === 'directory'; });
      if (folders.length === 0) {
        list.innerHTML = '<div style="color:var(--lco-text-muted);padding:16px;text-align:center">No projects yet.<br>Create one with the + button.</div>';
        return;
      }
      list.innerHTML = '';
      folders.forEach(function (f) {
        var item = document.createElement('div');
        item.className = 'project-item';
        if (f.name === currentWorkspace) item.classList.add('active');
        item.innerHTML = '<span>' + escapeHtml(f.name) + '</span>' +
          (f.name === currentWorkspace ? '<span class="switch-hint">active</span>' : '<span class="switch-hint">click to switch</span>');
        item.addEventListener('click', function () {
          switchWorkspace(f.name);
          closeModal();
        });
        list.appendChild(item);
      });
    });
  }

  function handleModalConfirm() {
    if (modalMode === 'new') {
      var input = document.getElementById('lco-new-project-name');
      var name = (input && input.value.trim()) || '';
      if (!name) return;
      // Create directory via mkdir (use git command as workaround or add mkdir RPC)
      // For now, create a placeholder file to trigger folder creation
      window.LCOEditor.sendRpc('saveFile', { path: '/' + name + '/.lco', content: '' }).then(function () {
        updateStatus('✓ Project created: ' + name);
        refresh();
        refreshWorkspaceName();
        closeModal();
      }).catch(function (err) {
        updateStatus('✗ Failed: ' + err.message, 'error');
      });
    } else {
      // Switch mode — handled by clicking project items
      closeModal();
    }
  }

  function switchWorkspace(folderName) {
    currentWorkspace = folderName;
    document.getElementById('lco-workspace-name').textContent = folderName;
    window.LCOEditor.sendRpc('switchWorkspace', { subFolder: folderName }).then(function (result) {
      updateStatus('⇄ Switched to: ' + folderName);
      checkClaudeConfig(result.path || folderName);
      refresh();
    }).catch(function (err) {
      updateStatus('✗ Switch failed: ' + err.message, 'error');
    });
  }

  function switchToHome() {
    currentWorkspace = 'home';
    document.getElementById('lco-workspace-name').textContent = 'home';
    window.LCOEditor.sendRpc('switchWorkspace', { path: '' }).then(function () {
      updateStatus('⌂ Back to home');
      checkClaudeConfig('');
      refresh();
    }).catch(function (err) {
      updateStatus('✗ ' + err.message, 'error');
    });
  }

  function checkClaudeConfig(wsPath) {
    var badge = document.getElementById('lco-claude-badge');
    if (!badge) return;
    // Check if .claude directory exists in current workspace
    window.LCOEditor.sendRpc('listFiles', { dirPath: '/' }).then(function (result) {
      var files = (result && result.files) ? result.files : [];
      var hasClaude = files.some(function (f) { return f.name === '.claude'; });
      if (hasClaude) {
        badge.classList.remove('hidden');
        badge.title = 'Claude context: ' + (wsPath || currentWorkspace);
      } else {
        badge.classList.add('hidden');
      }
    }).catch(function () {
      badge.classList.add('hidden');
    });
  }

  function refreshWorkspaceName() {
    document.getElementById('lco-workspace-name').textContent = currentWorkspace;
    checkClaudeConfig(currentWorkspace);
  }

  // ── End Workspace Bar ──

  // Wait for editor to be ready, then init.
  function waitAndInit() {
    if (window.LCOEditor && window.LCOEditor.isReady && window.LCOEditor.isReady()) {
      init();
    } else {
      setTimeout(waitAndInit, 200);
    }
  }

  // Start after DOM is interactive.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInit);
  } else {
    waitAndInit();
  }

  // ── Public API ──
  window.LCOFileExplorer = {
    refresh: refresh,
    openFile: openFile,
    getSelectedPath: function () { return selectedPath; },
  };

})();
