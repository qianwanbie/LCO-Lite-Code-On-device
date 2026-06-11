/**
 * LCO Node.js Backend — Phase 2 (TermuxEngine)
 *
 * Provides:
 *   HTTP API (JSON-RPC 2.0):
 *     POST /api/rpc   — Unified RPC endpoint (saveFile, readFile, listFiles, runGitCommand)
 *
 *   WebSocket:
 *     /ws/terminal     — Interactive shell via node-pty (Termux bash)
 *     /ws/file-events  — File change push notifications
 *
 * Usage (inside Termux):
 *   # Prerequisites (in Termux):
 *   $ pkg install clang make python nodejs
 *   $ npm install ws node-pty
 *
 *   # Run:
 *   $ node node_backend.js --port=9876 --root=$HOME/lco-workspace
 *
 * ARM64 / Termux notes:
 *   - node-pty requires native compilation (clang + make must be installed).
 *   - If node-pty fails to compile, the terminal endpoint falls back to a
 *     mock shell (no-pty mode), logging a warning.
 *   - Terminal spawns bash from Termux's $PREFIX/bin/bash with TERMUX_
 *     environment variables inherited.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, exec, spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '9876');
// PROJECT_ROOT — the single canonical workspace directory.
// Every file operation (readFile, saveFile, listFiles, runGitCommand),
// terminal cwd, and file watcher is anchored to this path.
// Path traversal is prevented by resolvePath().
const PROJECT_ROOT = '/data/data/com.termux/files/home/lco-workspace';
const ROOT = process.argv.find(a => a.startsWith('--root='))?.split('=')[1] || PROJECT_ROOT;

// Ensure workspace root exists
if (!fs.existsSync(ROOT)) {
  fs.mkdirSync(ROOT, { recursive: true });
}

// ---------------------------------------------------------------------------
// node-pty (optional — graceful fallback on ARM64 / compile failure)
// ---------------------------------------------------------------------------
let ptySpawn = null;
let PTY_AVAILABLE = false;
try {
  const pty = require('node-pty');
  ptySpawn = pty.spawn.bind(pty);
  PTY_AVAILABLE = true;
  console.log('[LCO Backend] node-pty loaded OK');
} catch (e) {
  console.warn('[LCO Backend] node-pty not available — terminal will use mock mode.');
  console.warn('[LCO Backend] Install in Termux: pkg install clang make && npm install node-pty');
  console.warn('[LCO Backend] Error detail:', e.message);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const WebSocket = require('ws');
const wss = new WebSocket.Server({ noServer: true });

// ---------------------------------------------------------------------------
// File system watcher
// ---------------------------------------------------------------------------
let watcher = null;
try {
  watcher = fs.watch(ROOT, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const payload = JSON.stringify({
      type: 'fileChange',
      path: '/' + filename.replace(/\\/g, '/'),
      eventType: eventType,
      timestamp: Date.now()
    });
    // Broadcast to all file-events clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client._channel === 'file-events') {
        client.send(payload);
      }
    });
  });
  console.log('[LCO Backend] File watcher active on:', ROOT);
} catch (e) {
  console.warn('[LCO Backend] File watcher not available:', e.message);
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

/** Broadcast a file-tree-refresh notification to all file-events clients. */
function broadcastFileTreeRefresh() {
  const payload = JSON.stringify({ type: 'fileTreeRefresh', timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client._channel === 'file-events') {
      client.send(payload);
    }
  });
  console.log('[LCO Backend] File tree refresh broadcast');
}
function jsonResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id: id, result: result });
}
function jsonError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
}

// ---------------------------------------------------------------------------
// Path resolution (prevent traversal)
// ---------------------------------------------------------------------------
function resolvePath(relativePath) {
  const normalized = relativePath.replace(/^[/\\]+/, '');
  const resolved = path.resolve(ROOT, normalized);
  if (!resolved.startsWith(ROOT)) {
    throw new Error('Path traversal denied: ' + relativePath);
  }
  return resolved;
}

function checksum(content) {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// JSON-RPC method dispatch
// ---------------------------------------------------------------------------
function dispatchRpc(id, method, params) {
  try {
    switch (method) {

      // ── saveFile ──
      case 'saveFile': {
        const filePath = resolvePath(params.path || '');
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Atomic write: temp file → rename
        const tmpPath = filePath + '.tmp.' + Date.now();
        fs.writeFileSync(tmpPath, params.content || '', 'utf-8');
        fs.renameSync(tmpPath, filePath);
        return jsonResult(id, { ok: true, checksum: checksum(params.content || '') });
      }

      // ── readFile ──
      case 'readFile': {
        const filePath = resolvePath(params.path || '');
        if (!fs.existsSync(filePath)) {
          return jsonError(id, -32002, 'File not found: ' + params.path);
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return jsonResult(id, { content: content, encoding: 'utf-8' });
      }

      // ── listFiles ──
      case 'listFiles': {
        const dirPath = params.dirPath ? resolvePath(params.dirPath) : ROOT;
        if (!fs.existsSync(dirPath)) {
          return jsonResult(id, { files: [] });
        }
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const files = entries.map(entry => {
          // Skip hidden files unless explicitly in a hidden dir
          if (entry.name.startsWith('.') && params.dirPath !== entry.name) return null;
          const fullPath = path.join(dirPath, entry.name);
          let stat;
          try { stat = fs.statSync(fullPath); } catch (e) { return null; }
          return {
            name: entry.name,
            path: '/' + path.relative(ROOT, fullPath).replace(/\\/g, '/'),
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modified: stat.mtime.toISOString()
          };
        }).filter(Boolean);
        return jsonResult(id, { files: files });
      }

      // ── runGitCommand ──
      case 'runGitCommand': {
        const args = params.args || [];
        try {
          const stdout = execSync('git ' + args.join(' '), {
            cwd: ROOT,
            encoding: 'utf-8',
            timeout: 30000,
            stdio: ['ignore', 'pipe', 'pipe']
          });
          // After git clone/init/pull → notify frontend to refresh file tree
          if (args[0] === 'clone' || args[0] === 'init' || args[0] === 'pull') {
            broadcastFileTreeRefresh();
          }
          return jsonResult(id, { stdout: stdout, stderr: '', exitCode: 0 });
        } catch (e) {
          return jsonResult(id, {
            stdout: e.stdout || '',
            stderr: e.stderr || e.message,
            exitCode: e.status || 1
          });
        }
      }

      // ── deleteFile ──
      case 'deleteFile': {
        const filePath = resolvePath(params.path || '');
        if (!fs.existsSync(filePath)) {
          return jsonError(id, -32002, 'File not found: ' + params.path);
        }
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          fs.rmSync(filePath, { recursive: true });
        } else {
          fs.unlinkSync(filePath);
        }
        return jsonResult(id, { ok: true, path: params.path });
      }

      // ── renameFile ──
      case 'renameFile': {
        const oldPath = resolvePath(params.oldPath || '');
        const newPath = resolvePath(params.newPath || '');
        if (!fs.existsSync(oldPath)) {
          return jsonError(id, -32002, 'File not found: ' + params.oldPath);
        }
        if (fs.existsSync(newPath)) {
          return jsonError(id, -32602, 'Target already exists: ' + params.newPath);
        }
        fs.renameSync(oldPath, newPath);
        return jsonResult(id, { ok: true, oldPath: params.oldPath, newPath: params.newPath });
      }

      // ── runScript ──
      case 'runScript': {
        const scriptPath = resolvePath(params.path || '');
        if (!fs.existsSync(scriptPath)) {
          return jsonError(id, -32002, 'File not found: ' + params.path);
        }
        const ext = path.extname(scriptPath).toLowerCase();
        let cmd;
        if (ext === '.js') cmd = 'node ' + JSON.stringify(scriptPath);
        else if (ext === '.py') cmd = 'python ' + JSON.stringify(scriptPath);
        else if (ext === '.sh') cmd = 'bash ' + JSON.stringify(scriptPath);
        else if (ext === '.dart') cmd = 'dart ' + JSON.stringify(scriptPath);
        else return jsonError(id, -32602, 'Unsupported file type: ' + ext);

        // Execute and stream output to terminal clients
        exec(cmd, { cwd: ROOT, timeout: 30000 }, (err, stdout, stderr) => {
          const output = (stdout || '') + (stderr || '');
          const payload = JSON.stringify({ type: 'terminalOutput', data: output, path: params.path });
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client._channel === 'terminal') {
              client.send(payload);
            }
          });
        });
        return jsonResult(id, { ok: true, path: params.path, running: true });
      }

      // ── changeWorkspace ──
      case 'changeWorkspace': {
        const subFolder = (params.subFolder || '').replace(/^[/\\]+/, '').replace(/\.\./g, '');
        if (!subFolder) return jsonError(id, -32602, 'Missing subFolder');
        const newRoot = path.join(PROJECT_ROOT, subFolder);
        if (!fs.existsSync(newRoot)) {
          return jsonError(id, -32002, 'Project not found: ' + subFolder);
        }
        // Update global ROOT (affects terminal cwd on next connect)
        // Note: requires server restart or dynamic ROOT update for full effect
        // For now, broadcast refresh so frontend re-lists from new path
        broadcastFileTreeRefresh();
        return jsonResult(id, { ok: true, workspace: subFolder, path: newRoot });
      }

      // ── Unknown ──
      default:
        return jsonError(id, -32601, 'Method not found: ' + method);
    }
  } catch (e) {
    return jsonError(id, -32603, 'Internal error: ' + e.message);
  }
}

// ===========================================================================
// HTTP Server
// ===========================================================================
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // POST /api/rpc — unified JSON-RPC endpoint
  if (req.method === 'POST' && req.url === '/api/rpc') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const { id, method, params } = payload;
        if (!method) throw new Error('Missing method');
        const response = dispatchRpc(id || 0, method, params || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(response);
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(jsonError(0, -32700, 'Parse error: ' + e.message));
      }
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      ptyAvailable: PTY_AVAILABLE,
      root: ROOT,
      watcherActive: !!watcher,
    }));
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

// ===========================================================================
// WebSocket upgrade handler
// ===========================================================================
server.on('upgrade', (request, socket, head) => {
  const url = request.url;

  if (url === '/ws/terminal') {
    wss.handleUpgrade(request, socket, head, ws => {
      ws._channel = 'terminal';
      handleTerminalConnection(ws);
    });
  } else if (url === '/ws/file-events') {
    wss.handleUpgrade(request, socket, head, ws => {
      ws._channel = 'file-events';
      console.log('[LCO Backend] File-events client connected');
      ws.on('close', () => {
        console.log('[LCO Backend] File-events client disconnected');
      });
      // Send initial connection confirmation
      ws.send(JSON.stringify({ type: 'connected', root: ROOT }));
    });
  } else {
    socket.destroy();
  }
});

// ===========================================================================
// Terminal WebSocket handler
// ===========================================================================
function handleTerminalConnection(ws) {
  console.log('[LCO Backend] Terminal client connected (PTY:', PTY_AVAILABLE, ')');

  let ptyProcess = null;

  // ── PTY mode (node-pty available) ──
  if (PTY_AVAILABLE && ptySpawn) {
    // Determine shell: use bash from Termux prefix if available
    const termuxPrefix = process.env.PREFIX || '/data/data/com.termux/files/usr';
    // Prefer Termux bash over system /bin/sh (which may lack proper env)
    const termuxBash = termuxPrefix + '/bin/bash';
    const shellPath = fs.existsSync(termuxBash) ? termuxBash
      : (process.env.SHELL || '/bin/bash');

    // Build Termux-compatible environment with correct PATH
    const termuxBin = termuxPrefix + '/bin';
    const termuxApplets = termuxPrefix + '/bin/applets';
    const termuxPath = [termuxBin, termuxApplets,
      '/usr/bin', '/bin', '/system/bin', '/system/xbin'].join(':');

    const env = Object.assign({}, process.env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LCO_ROOT: ROOT,
      HOME: process.env.HOME || '/data/data/com.termux/files/home',
      PREFIX: termuxPrefix,
      PATH: termuxPath,
      LD_LIBRARY_PATH: termuxPrefix + '/lib',
      LD_PRELOAD: '',
      PS1: '\\[\\e[32m\\]\\W\\[\\e[0m\\]\\$ ',
    });

    try {
      ptyProcess = ptySpawn(shellPath, ['--login'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: ROOT,
        env: env,
      });

      console.log('[LCO Backend] PTY spawned:', shellPath, 'PID:', ptyProcess.pid);

      // PTY output → WebSocket
      ptyProcess.onData(data => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: data }));
        }
      });

      // PTY exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log('[LCO Backend] PTY exited with code', exitCode, 'signal', signal);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'output',
            data: '\r\n\x1b[33m[Process exited with code ' + exitCode + ']\x1b[0m\r\n'
          }));
          ws.send(JSON.stringify({ type: 'exit', exitCode: exitCode }));
        }
        ptyProcess = null;
      });

      // ── Terminal welcome: show workspace status ──
      try {
        const entries = fs.readdirSync(ROOT).filter(n => !n.startsWith('.'));
        if (entries.length === 0) {
          ws.send(JSON.stringify({
            type: 'output',
            data: '\r\n\x1b[1;36m╔══════════════════════════════════════════╗\x1b[0m\r\n' +
                  '\x1b[1;36m║\x1b[0m  \x1b[1;33mWelcome to LCO!\x1b[0m                           \x1b[1;36m║\x1b[0m\r\n' +
                  '\x1b[1;36m║\x1b[0m  Workspace: ' + ROOT.padEnd(28) + '\x1b[1;36m║\x1b[0m\r\n' +
                  '\x1b[1;36m║\x1b[0m  Status: empty                            \x1b[1;36m║\x1b[0m\r\n' +
                  '\x1b[1;36m║\x1b[0m                                          \x1b[1;36m║\x1b[0m\r\n' +
                  '\x1b[1;36m║\x1b[0m  \x1b[32mgit clone <url>\x1b[0m to start a project.       \x1b[1;36m║\x1b[0m\r\n' +
                  '\x1b[1;36m╚══════════════════════════════════════════╝\x1b[0m\r\n\r\n'
          }));
        } else {
          // Show ls output to confirm workspace contents
          const ls = execSync('ls -la', { cwd: ROOT, encoding: 'utf-8', timeout: 5000 });
          ws.send(JSON.stringify({
            type: 'output',
            data: '\r\n\x1b[90m ── ' + ROOT + ' ──\x1b[0m\r\n' + ls + '\r\n'
          }));
        }
      } catch (_) { /* ignore */ }

    } catch (e) {
      console.error('[LCO Backend] PTY spawn failed:', e.message);
      ws.send(JSON.stringify({
        type: 'output',
        data: '\r\n\x1b[31mFailed to spawn PTY: ' + e.message + '\x1b[0m\r\n'
      }));
    }
  }

  // ── Fallback: spawn bash via child_process when node-pty unavailable ──
  // NOTE: Do NOT use '-i' (interactive) — it requires a real TTY.
  // Instead, use pipe-based I/O with explicit prompt handling.
  let bashProcess = null;
  if (!PTY_AVAILABLE) {
    const shellPath = process.env.SHELL || '/bin/bash';
    try {
      bashProcess = spawn(shellPath, [], {
        cwd: ROOT,
        env: Object.assign({}, process.env, {
          TERM: 'dumb',
          HOME: process.env.HOME || '/data/data/com.termux/files/home',
          LCO_ROOT: ROOT,
          PS1: '\\[\\e[32m\\]\\$ \\[\\e[0m\\]',  // Green "$ " prompt
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      bashProcess.stdout.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
        }
      });
      bashProcess.stderr.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
        }
      });
      bashProcess.on('exit', (code) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[33m[bash exited with code ' + code + ']\x1b[0m\r\n' }));
          ws.send(JSON.stringify({ type: 'exit', exitCode: code }));
        }
        bashProcess = null;
      });
      bashProcess.on('error', (err) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m[bash error: ' + err.message + ']\x1b[0m\r\n' }));
        }
      });
      console.log('[LCO Backend] Spawned bash fallback (PID:', bashProcess.pid, ')');
    } catch (e) {
      console.error('[LCO Backend] bash spawn failed:', e.message);
      ws.send(JSON.stringify({
        type: 'output',
        data: '\x1b[1;33m[Terminal fallback failed: ' + e.message + ']\x1b[0m\r\n' +
              '\x1b[90mInstall in Termux: pkg install clang make && npm install node-pty\x1b[0m\r\n\r\n'
      }));
    }
  }

  // ── WebSocket → Process (input) ──
  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'input') {
        if (ptyProcess) {
          ptyProcess.write(msg.data);
        } else if (bashProcess) {
          bashProcess.stdin.write(msg.data);
        } else {
          handleMockInput(ws, msg.data);
        }
      } else if (msg.type === 'resize') {
        if (ptyProcess && msg.cols && msg.rows) {
          try { ptyProcess.resize(msg.cols, msg.rows); } catch (e) {}
        }
      }
    } catch (e) {
      // Raw data — forward to PTY.
      if (ptyProcess) {
        ptyProcess.write(data.toString());
      }
    }
  });

  ws.on('close', () => {
    console.log('[LCO Backend] Terminal client disconnected');
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch (e) {}
      ptyProcess = null;
    }
    if (bashProcess) {
      try { bashProcess.kill(); } catch (e) {}
      bashProcess = null;
    }
  });

  ws.on('error', err => {
    console.error('[LCO Backend] Terminal WS error:', err.message);
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch (e) {}
      ptyProcess = null;
    }
  });
}

// ---------------------------------------------------------------------------
// Mock terminal input handler (when node-pty is not available)
// ---------------------------------------------------------------------------
function handleMockInput(ws, data) {
  // Echo the input
  ws.send(JSON.stringify({ type: 'output', data: data }));

  // On Enter, simulate command execution
  if (data === '\r' || data === '\n') {
    ws.send(JSON.stringify({ type: 'output', data: '\r\n' }));
    // We'd need to buffer the input line for real mock execution.
    // For now, just show a prompt.
    ws.send(JSON.stringify({ type: 'output', data: '\x1b[32m$ \x1b[0m' }));
  }
}

// ===========================================================================
// Start
// ===========================================================================
server.listen(PORT, '127.0.0.1', () => {
  console.log('WebSocket Server listening on port ' + PORT);
  console.log('═══════════════════════════════════════════════');
  console.log('  LCO Backend v0.2.0');
  console.log('  HTTP API:  http://127.0.0.1:' + PORT + '/api/rpc');
  console.log('  Terminal:  ws://127.0.0.1:' + PORT + '/ws/terminal');
  console.log('  Events:    ws://127.0.0.1:' + PORT + '/ws/file-events');
  console.log('  Workspace: ' + ROOT);
  console.log('  PTY:       ' + (PTY_AVAILABLE ? 'enabled' : 'mock mode'));
  console.log('  Watcher:   ' + (watcher ? 'active' : 'inactive'));
  console.log('═══════════════════════════════════════════════');
});

// Graceful shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  console.log('\n[LCO Backend] Shutting down...');
  if (watcher) { try { watcher.close(); } catch (e) {} }
  wss.clients.forEach(client => {
    if (client._channel === 'terminal') {
      client.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m[Server shutting down]\x1b[0m\r\n' }));
    }
    client.close();
  });
  wss.close();
  server.close();
  process.exit(0);
}
