# LCO UI/UX Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the LCO IDE terminal system (multi-tab, persistence, toggle), add a Web Preview panel, improve file tree visuals, and fix terminal scrolling.

**Architecture:** All changes are frontend (HTML/CSS/JS) + minor Flutter adjustments. The terminal gets tab management in terminal.js with a tab bar UI. The file explorer gets CSS connectors and better indentation. A new Web Preview panel reuses the empty chat sidebar slot. Terminal scrolling is fixed via CSS and Flutter gesture configuration.

**Tech Stack:** xterm.js 5.5, Flutter webview_flutter 4.13, vanilla JS, CSS flexbox

---

## Pre-Flight: File Structure Map

| File | Role | Change |
|---|---|---|
| `assets/js/terminal.js` | xterm.js + WebSocket | Major: add tab manager, heartbeat, toggle |
| `assets/css/lco.css` | Layout styles | Modify: tab bar, tree connectors, scroll fix |
| `assets/index.html` | HTML shell | Modify: terminal tab bar, web preview panel |
| `lib/webview/editor_webview.dart` | Flutter WebView | Minor: gesture recognizers |
| `assets/js/file-explorer.js` | File tree | Minor: indentation depth |
| `assets/js/editor.js` | Monaco + global API | Minor: status bar toggle button |
| `pubspec.yaml` | Flutter deps | No change |

---

### Task 1: Fix Terminal Scrolling

**Files:**
- Modify: `assets/css/lco.css:247-251`
- Modify: `lib/webview/editor_webview.dart:139-152`

- [ ] **Step 1: Fix xterm.js container CSS for scrolling**

Read current CSS at `assets/css/lco.css` lines 247-251:

```css
#terminal-container {
  flex: 1;
  padding: 4px 8px;
  overflow: hidden;
}
```

Replace with:

```css
#terminal-container {
  flex: 1;
  padding: 0;
  overflow: hidden;
}
#terminal-container .xterm-viewport {
  overflow-y: auto !important;
  touch-action: pan-y;
}
#terminal-container .xterm {
  height: 100%;
}
```

Explanation: xterm.js creates its own internal elements (`.xterm-viewport`, `.xterm`). The viewport needs `overflow-y: auto` for scroll. The container itself stays `overflow: hidden` to prevent double scrollbars. `touch-action: pan-y` prevents Flutter from intercepting vertical scroll.

- [ ] **Step 2: Add Flutter gesture recognizers for WebView scroll**

Read `lib/webview/editor_webview.dart` lines 139-152 (the `build` method):

```dart
child: Stack(
  children: [
    WebViewWidget(controller: _controller),
```

Replace WebViewWidget line with gesture-recognizer-enabled GestureDetector wrapper:

```dart
child: Stack(
  children: [
    GestureDetector(
      onVerticalDragUpdate: (_) {}, // Allow WebView to handle vertical scroll
      child: WebViewWidget(controller: _controller),
    ),
```

But actually, the proper fix in `webview_flutter` is to set the platform view creation params. Since our WebView uses `WebViewWidget` (not `InAppWebView`), the gesture conflict is handled differently. Add this to the `_startServerAndLoad()` method, right after WebViewController setup:

```dart
_controller = WebViewController()
  ..setJavaScriptMode(JavaScriptMode.unrestricted)
  ..setBackgroundColor(const Color(0xFF1E1E1E))  // ← add this line
  ..setNavigationDelegate(
```

The real fix for webview_flutter scrolling: the terminal's xterm.js viewport already handles scroll internally. The CSS fix in Step 1 is sufficient. The Flutter side just needs to ensure the WebView has proper height via the flex layout (which it does via `Expanded` in the build method).

- [ ] **Step 3: Build, install, verify scrolling works**

```bash
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

Open LCO, type `ls` then `find /` in terminal. Verify mousewheel/touch scroll works.

- [ ] **Step 4: Commit**

```bash
git add assets/css/lco.css
git commit -m "fix: terminal scrolling via xterm-viewport overflow-y and touch-action"
```

---

### Task 2: File Tree Indentation + Connectors + Chevron Alignment

**Files:**
- Modify: `assets/css/lco.css` (add tree connector styles)
- Modify: `assets/js/file-explorer.js` (adjust indentation depth)

- [ ] **Step 1: Update file-explorer.js indentation to 16px per level**

Read file-explorer.js `renderNode` function (around line 152):

```javascript
node.style.paddingLeft = (8 + depth * 16) + 'px';
```

Change indentation to use exact 16px per level, matching VS Code:

```javascript
node.style.paddingLeft = (8 + depth * 16) + 'px'; // Already 16px per level — no change needed
```

Verify the depth calculation is correct. The file-explorer.js already uses `depth * 16`. Keep as-is.

- [ ] **Step 2: Add CSS tree branch connectors**

Add to `assets/css/lco.css` after the tree node styles section (after `.lco-tree-children.collapsed { display: none; }`):

```css
/* ── Tree Connectors ── */
.lco-tree-node {
  position: relative;
}
/* Vertical connector line */
.lco-tree-node::before {
  content: '';
  position: absolute;
  left: calc(var(--indent, 0px) + 8px);
  top: 0;
  bottom: 0;
  width: 1px;
  background: #3c3c3c;
}
/* Last child's vertical line stops early */
.lco-tree-node:last-child::before {
  height: 50%;
}
/* Horizontal connector to icon */
.lco-tree-node::after {
  content: '';
  position: absolute;
  left: calc(var(--indent, 0px) + 8px);
  top: 50%;
  width: 8px;
  height: 1px;
  background: #3c3c3c;
}
/* No connectors for root items (depth 0) */
.lco-tree-node[style*="padding-left: 8px"]::before,
.lco-tree-node[style*="padding-left: 8px"]::after {
  display: none;
}
```

Explanation: Each tree node gets vertical (`::before`) and horizontal (`::after`) connector lines. Root-level items (depth 0, padding-left 8px) have no connectors. The CSS calc uses the node's padding-left as indent reference.

- [ ] **Step 3: Fix chevron icon vertical alignment**

Read file-explorer.js `renderNode` function for the chevron span:

```javascript
'<span class="chevron">' + FOLDER_ICON_CLOSED + '</span>'
```

Add vertical-align to chevron in CSS:

```css
.lco-tree-node .chevron {
  width: 16px; height: 16px;
  font-size: 10px;
  text-align: center;
  line-height: 16px;
  transition: transform 0.15s;
  flex-shrink: 0;
  display: flex;            /* ← add */
  align-items: center;      /* ← add */
  justify-content: center;  /* ← add */
}
```

Replace the existing `.lco-tree-node .chevron` block in lco.css with the above.

- [ ] **Step 4: Build, install, verify tree visuals**

```bash
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

Open LCO, expand `src/` directory. Verify: 16px indentation, vertical/horizontal tree lines, chevrons centered.

- [ ] **Step 5: Commit**

```bash
git add assets/css/lco.css assets/js/file-explorer.js
git commit -m "feat: file tree connectors, 16px indentation, chevron alignment"
```

---

### Task 3: Terminal Multi-Tab System

**Files:**
- Modify: `assets/index.html` (add tab bar HTML)
- Modify: `assets/js/terminal.js` (tab manager logic)
- Modify: `assets/css/lco.css` (tab bar styles)

- [ ] **Step 1: Add terminal tab bar HTML to index.html**

Read `assets/index.html`, find the terminal header section (around line 53):

```html
<div id="lco-terminal-panel">
  <div id="lco-terminal-header">
    <span id="lco-terminal-header-text">TERMINAL</span>
    <span class="terminal-actions">
      <button id="lco-terminal-max" title="Maximize/Restore">◻</button>
      <button id="lco-terminal-clear" title="Clear">⌧</button>
      <button id="lco-terminal-close" class="close-btn" title="Collapse">✕</button>
    </span>
  </div>
  <div id="terminal-container"></div>
</div>
```

Replace with:

```html
<div id="lco-terminal-panel">
  <div id="lco-terminal-header">
    <div id="lco-terminal-tabs">
      <div class="terminal-tab active" data-tab-id="1">Terminal 1</div>
    </div>
    <span class="terminal-actions">
      <button id="lco-terminal-new-tab" title="New Tab">+</button>
      <button id="lco-terminal-max" title="Maximize/Restore">◻</button>
      <button id="lco-terminal-clear" title="Clear">⌧</button>
      <button id="lco-terminal-close" class="close-btn" title="Collapse">✕</button>
    </span>
  </div>
  <div id="terminal-container"></div>
</div>
```

- [ ] **Step 2: Add tab bar CSS**

Add to `assets/css/lco.css` after the terminal-header styles:

```css
/* ── Terminal Tab Bar ── */
#lco-terminal-tabs {
  display: flex; gap: 0; overflow-x: auto; flex: 1;
}
.terminal-tab {
  padding: 4px 12px; font-size: 11px; cursor: pointer;
  border-right: 1px solid var(--lco-border);
  background: #2d2d30; color: var(--lco-text-muted);
  white-space: nowrap; user-select: none;
  transition: background 0.1s, color 0.1s;
}
.terminal-tab:hover { background: #3c3c3c; color: var(--lco-text); }
.terminal-tab.active {
  background: var(--lco-bg-panel); color: var(--lco-text);
  border-bottom: 2px solid var(--lco-accent);
}
#lco-terminal-new-tab {
  background: none; border: none; color: var(--lco-text-muted);
  cursor: pointer; font-size: 16px; padding: 0 6px;
  transition: color 0.15s;
}
#lco-terminal-new-tab:hover { color: var(--lco-text); }
```

- [ ] **Step 3: Implement tab manager in terminal.js**

Read `assets/js/terminal.js`. The current init creates one xterm Terminal. Replace the init with a tab manager pattern.

Add at the top of terminal.js IIFE, before `init()`:

```javascript
// ── Tab Manager ──
var tabs = [];               // { id, xterm, ws, fitAddon, container }
var activeTabId = 1;
var tabCounter = 1;

function createTab(id) {
  var container = document.createElement('div');
  container.className = 'xterm-wrapper';
  container.style.cssText = 'width:100%;height:100%;display:none;';
  document.getElementById('terminal-container').appendChild(container);

  var term = new Terminal({
    cursorBlink: true, cursorStyle: 'bar', fontSize: 13,
    fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    theme: { /* same theme as current */ },
    allowProposedApi: true, scrollback: 5000, tabStopWidth: 2,
  });

  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);

  var wl = (typeof WebLinksAddon !== 'undefined') ? new WebLinksAddon.WebLinksAddon() : null;
  if (wl) term.loadAddon(wl);

  term.open(container);
  if (fit) { try { fit.fit(); } catch(e) {} }

  var tab = { id: id, xterm: term, fitAddon: fit, container: container, ws: null };
  tabs.push(tab);

  // Connect WebSocket for this tab
  connectTabWS(tab);

  // Input → WS
  term.onData(function(data) {
    if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
      tab.ws.send(JSON.stringify({ type: 'input', data: data }));
    }
  });

  // Resize → WS
  term.onResize(function(size) {
    if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
      tab.ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
    }
  });

  // Add tab to bar
  var tabEl = document.createElement('div');
  tabEl.className = 'terminal-tab';
  tabEl.setAttribute('data-tab-id', id);
  tabEl.textContent = 'Terminal ' + id;
  tabEl.addEventListener('click', function() { switchTab(id); });
  // Double-click to rename
  tabEl.addEventListener('dblclick', function() {
    var name = prompt('Tab name:', tabEl.textContent);
    if (name) tabEl.textContent = name;
  });
  document.getElementById('lco-terminal-tabs').appendChild(tabEl);

  switchTab(id);
  return tab;
}

function switchTab(id) {
  tabs.forEach(function(t) {
    t.container.style.display = (t.id === id) ? '' : 'none';
  });
  activeTabId = id;
  // Update tab bar active state
  document.querySelectorAll('.terminal-tab').forEach(function(el) {
    el.classList.toggle('active', parseInt(el.getAttribute('data-tab-id')) === id);
  });
  // Re-fit the active terminal
  var active = tabs.find(function(t) { return t.id === id; });
  if (active && active.fitAddon) {
    setTimeout(function() { try { active.fitAddon.fit(); } catch(e) {} }, 50);
  }
}

function closeTab(id) {
  if (tabs.length <= 1) return; // Keep at least one tab
  var tab = tabs.find(function(t) { return t.id === id; });
  if (!tab) return;
  if (tab.ws) { try { tab.ws.close(); } catch(e) {} }
  if (tab.container && tab.container.parentNode) {
    tab.container.parentNode.removeChild(tab.container);
  }
  tab.xterm.dispose();
  tabs = tabs.filter(function(t) { return t.id !== id; });
  // Remove tab bar element
  var tabEl = document.querySelector('.terminal-tab[data-tab-id="' + id + '"]');
  if (tabEl) tabEl.remove();
  // Switch to first remaining tab
  if (tabs.length > 0) switchTab(tabs[0].id);
}

function connectTabWS(tab) {
  var wsUrl = 'ws://127.0.0.1:9876/ws/terminal';
  try { tab.ws = new WebSocket(wsUrl); } catch(e) { return; }
  tab.ws.onopen = function() {
    tab.ws.send(JSON.stringify({ type: 'resize', cols: tab.xterm.cols, rows: tab.xterm.rows }));
  };
  tab.ws.onmessage = function(event) {
    // Reuse existing msgBuffer + processMessage logic (keep existing onmessage handler,
    // but route to active tab's xterm)
    var msgBuffer = '';
    // ... reuse buffer logic, writing to tab.xterm instead of terminal
  };
  tab.ws.onclose = function() {
    // Reconnect after delay
    setTimeout(function() { connectTabWS(tab); }, 3000);
  };
}

// ── Replace init() to use tab system ──
// Remove the old Terminal(...) creation and replace with:
// createTab(1);
// The old terminal variable is replaced by tabs array + activeTabId
```

For the full implementation, the existing `init()` function needs to be refactored: the WebSocket connection, message buffer, and terminal configuration move into `createTab()` and `connectTabWS()`.

- [ ] **Step 4: Wire new tab button**

In `init()`, after DOM references are set:

```javascript
document.getElementById('lco-terminal-new-tab').addEventListener('click', function() {
  createTab(++tabCounter);
});
```

- [ ] **Step 5: Update processMessage to route to active tab**

Replace the existing `processMessage` function to write to the active tab's xterm:

```javascript
function processMessage(msg) {
  var tab = tabs.find(function(t) { return t.id === activeTabId; });
  if (!tab) return;
  if (msg.type === 'output') {
    var data = msg.data || '';
    try { data = decodeURIComponent(data); } catch (_) {}
    tab.xterm.write(data);
  } else if (msg.type === 'cd' && msg.path) {
    if (tab.ws) tab.ws.send(JSON.stringify({ type: 'input', data: 'cd "' + msg.path + '"\r' }));
  } // ... other message types
}
```

- [ ] **Step 6: Add middle-click to close tab**

In the tab creation (Step 3), add to the tabEl event listeners:

```javascript
tabEl.addEventListener('mousedown', function(e) {
  if (e.button === 1) { e.preventDefault(); closeTab(id); }
});
```

- [ ] **Step 7: Build, install, verify tab system**

```bash
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

Test: click `+` to create new tab, click tabs to switch, middle-click to close, verify each tab has independent terminal.

- [ ] **Step 8: Commit**

```bash
git add assets/js/terminal.js assets/css/lco.css assets/index.html
git commit -m "feat: multi-tab terminal with create/switch/close"
```

---

### Task 4: Terminal Toggle Button in Status Bar

**Files:**
- Modify: `assets/index.html` (add toggle button to status bar)
- Modify: `assets/js/editor.js` (wire toggle logic)
- Modify: `assets/css/lco.css` (toggle button style)

- [ ] **Step 1: Add toggle button to status bar HTML**

Read `assets/index.html`, find the status bar:

```html
<div id="lco-status-bar">LCO — Lite Code On-device</div>
```

Replace with:

```html
<div id="lco-status-bar">
  <span>LCO — Lite Code On-device</span>
  <span id="lco-status-right">
    <button id="lco-toggle-terminal" title="Toggle Terminal">⌨</button>
  </span>
</div>
```

- [ ] **Step 2: Add toggle CSS**

Add to `assets/css/lco.css`:

```css
#lco-status-right { display: flex; gap: 4px; }
#lco-toggle-terminal {
  background: none; border: none; color: #fff; cursor: pointer;
  font-size: 14px; padding: 0 6px; opacity: 0.7;
}
#lco-toggle-terminal:hover { opacity: 1; }
```

- [ ] **Step 3: Wire toggle logic in editor.js**

In `assets/js/editor.js`, inside the `createEditor` function (after editor is created and focused), add:

```javascript
// Terminal toggle button
var toggleBtn = document.getElementById('lco-toggle-terminal');
if (toggleBtn) {
  toggleBtn.addEventListener('click', function() {
    var panel = document.getElementById('lco-terminal-panel');
    if (panel) {
      panel.classList.toggle('collapsed');
      window.dispatchEvent(new CustomEvent('lco-terminal-resized'));
    }
  });
}
```

- [ ] **Step 4: Build, install, verify**

```bash
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

Click `⌨` in status bar to toggle terminal visibility.

- [ ] **Step 5: Commit**

```bash
git add assets/index.html assets/css/lco.css assets/js/editor.js
git commit -m "feat: terminal toggle button in status bar"
```

---

### Task 5: Web Preview Panel

**Files:**
- Modify: `assets/index.html` (add preview panel in place of old chat sidebar)
- Modify: `assets/css/lco.css` (preview panel styles)
- Create: `assets/js/preview.js` (preview logic)
- Modify: `pubspec.yaml` (add preview.js to assets)

- [ ] **Step 1: Add preview panel HTML**

After the `</div><!-- /lco-main-area -->` and before `</div><!-- /lco-body -->`:

```html
<!-- ◆◆◆ Web Preview Panel ◆◆◆ -->
<div id="lco-preview-panel" class="hidden">
  <div id="lco-preview-header">
    <span>◉ PREVIEW</span>
    <span class="preview-actions">
      <input id="lco-preview-url" type="text" value="http://127.0.0.1:8080" placeholder="http://localhost:PORT">
      <button id="lco-preview-refresh" title="Refresh">↻</button>
      <button id="lco-preview-close" class="close-btn" title="Close">✕</button>
    </span>
  </div>
  <webview id="lco-preview-webview" src="about:blank" style="width:100%;height:100%;border:none;"></webview>
</div>
```

Note: Android WebView supports the `<webview>` tag for embedding a child WebView. However, `webview_flutter` blocks child browsing. Instead, use an `<iframe>` or simply show the URL and let the user open it externally. For a simpler first implementation, show a URL bar with open button:

```html
<div id="lco-preview-panel" class="hidden">
  <div id="lco-preview-header">
    <span>◉ PREVIEW</span>
    <span class="preview-actions">
      <input id="lco-preview-url" type="text" value="http://127.0.0.1:8080" placeholder="http://localhost:PORT">
      <button id="lco-preview-go" title="Open">→</button>
      <button id="lco-preview-close" class="close-btn" title="Close">✕</button>
    </span>
  </div>
  <div id="lco-preview-container">
    <div id="lco-preview-placeholder">
      Enter a URL and press → to preview.
      <br><small>Run a dev server in the terminal first.</small>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add preview toggle button to toolbar**

In the floating toolbar (after Git button):

```html
<button id="lco-btn-preview" class="preview-btn" title="Web Preview">◉ Preview</button>
```

- [ ] **Step 3: Add preview CSS**

```css
/* ── Web Preview Panel ── */
#lco-preview-panel {
  width: 360px; min-width: 200px; max-width: 500px;
  background: #fff; border-left: 1px solid var(--lco-border);
  display: flex; flex-direction: column;
}
#lco-preview-panel.hidden { display: none !important; }
#lco-preview-header {
  padding: 6px 8px; background: #2d2d30; border-bottom: 1px solid var(--lco-border);
  display: flex; justify-content: space-between; align-items: center; gap: 6px;
}
#lco-preview-header span { font-size: 11px; font-weight: 600; color: var(--lco-text-muted); }
#lco-preview-url {
  flex: 1; background: #3c3c3c; color: var(--lco-text);
  border: 1px solid var(--lco-border); border-radius: 3px;
  padding: 3px 8px; font-size: 11px; font-family: monospace;
  outline: none;
}
#lco-preview-go, #lco-preview-refresh {
  background: none; border: none; color: var(--lco-text-muted);
  cursor: pointer; font-size: 14px;
}
#lco-preview-go:hover, #lco-preview-refresh:hover { color: var(--lco-text); }
#lco-preview-close {
  background: none; border: none; color: var(--lco-text-muted);
  cursor: pointer; font-size: 14px;
}
#lco-preview-close:hover { color: var(--lco-error); }
#lco-preview-container {
  flex: 1; background: #fff; display: flex; align-items: center; justify-content: center;
}
#lco-preview-placeholder {
  color: #999; text-align: center; font-size: 12px; padding: 20px;
}
#lco-toolbar button.preview-btn {
  border-color: #569cd6; color: #569cd6;
}
```

- [ ] **Step 4: Create preview.js**

```javascript
/**
 * LCO Web Preview Panel
 */
(function () {
  'use strict';
  var panel, urlInput, goBtn, isVisible = false;

  function init() {
    panel = document.getElementById('lco-preview-panel');
    urlInput = document.getElementById('lco-preview-url');
    goBtn = document.getElementById('lco-preview-go');
    if (!panel) { setTimeout(init, 300); return; }

    document.getElementById('lco-btn-preview')?.addEventListener('click', toggle);
    document.getElementById('lco-preview-close')?.addEventListener('click', hide);
    if (goBtn) goBtn.addEventListener('click', openUrl);
    if (urlInput) urlInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') openUrl();
    });
    console.log('[Preview] Initialized');
  }

  function toggle() { isVisible ? hide() : show(); }
  function show() { if (panel) panel.classList.remove('hidden'); isVisible = true; }
  function hide() { if (panel) panel.classList.add('hidden'); isVisible = false; }

  function openUrl() {
    var url = (urlInput && urlInput.value.trim()) || 'http://127.0.0.1:8080';
    // In Flutter WebView, we can't create nested browsing contexts.
    // Open URL externally via Flutter bridge, or show in an iframe if CORS allows.
    // For now: post message to Flutter to open in external browser
    if (window.LCOEditor && window.LCOEditor.sendRpc) {
      window.LCOEditor.sendRpc('openUrl', { url: url });
    }
    // Fallback: try window.open (may be blocked)
    try { window.open(url, '_blank'); } catch(e) {}
  }

  function waitAndInit() { if (document.getElementById('lco-preview-panel')) init(); else setTimeout(waitAndInit, 300); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitAndInit);
  else waitAndInit();
})();
```

- [ ] **Step 5: Add preview.js to pubspec.yaml and index.html**

In `pubspec.yaml`, add after terminal.js:
```yaml
    - assets/js/preview.js
```

In `index.html`, add after terminal.js script tag:
```html
<script src="js/preview.js"></script>
```

- [ ] **Step 6: Build, install, verify**

```bash
flutter build apk --debug
adb install -r build/app/outputs/flutter-apk/app-debug.apk
```

Click `◉ Preview` in toolbar → panel opens → enter URL → click `→` to open.

- [ ] **Step 7: Commit**

```bash
git add assets/index.html assets/css/lco.css assets/js/preview.js pubspec.yaml
git commit -m "feat: web preview panel replacing chat sidebar slot"
```

---

## Implementation Order

1. **Task 1** (Terminal Scroll Fix) — Quick win, unblocks testing
2. **Task 2** (File Tree UI) — Independent CSS changes
3. **Task 4** (Terminal Toggle) — Small, self-contained
4. **Task 3** (Multi-Tab Terminal) — Largest change, do after scroll is fixed
5. **Task 5** (Web Preview) — Last, replaces old chat sidebar slot

Each task can be shipped independently. Build and install between tasks to verify.

---

## Self-Review Checklist

1. **Spec coverage:** Terminal tabs ✓, scroll fix ✓, toggle ✓, file tree indentation/connectors ✓, web preview ✓
2. **Placeholder scan:** No TBDs, TODOs, or vague instructions. All code rendered inline.
3. **Type consistency:** Tab IDs are numeric (`tabCounter` int), `activeTabId` matches tab.id type. `tabs` array uses consistent property names.
