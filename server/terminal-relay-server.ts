import { serve } from "bun";

const clients = new Map();
let clientId = 0;

const server = serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(getWebUI(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    idleTimeout: 120,
    open(ws) {
      const id = clientId++;
      const client = { ws, id, type: null };
      clients.set(ws, client);
      console.log(`Client ${id} connected`);
    },

    message(ws, message) {
      const client = clients.get(ws);
      if (!client) return;

      try {
        const data = JSON.parse(message.toString());

        if (data.type === "register") {
          client.type = data.clientType;
          console.log(`Client ${client.id} registered as ${client.type}`);
          return;
        }

        if (data.type === "ping") {
          return;
        }

        if ((data.type === "command" || data.type === "key" || data.type === "resize" || data.type === "tab") && client.type === "phone") {
          const laptopClient = Array.from(clients.values()).find(
            (c) => c.type === "laptop"
          );
          if (laptopClient) {
            laptopClient.ws.send(JSON.stringify(data));
          }
          return;
        }

        if ((data.type === "output" || data.type === "tabState" || data.type === "tabError") && client.type === "laptop") {
          for (const c of clients.values()) {
            if (c.type === "phone") {
              c.ws.send(JSON.stringify(data));
            }
          }
          return;
        }
      } catch (e) {
        console.error("Message parse error:", e);
      }
    },

    close(ws) {
      const client = clients.get(ws);
      if (client) {
        console.log(`Client ${client.id} (${client.type}) disconnected`);
        clients.delete(ws);
      }
    },
  },
});

function getWebUI() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Terminal Remote</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
  <style>
    :root {
      --cyan: #29e9ff; --magenta: #ff2e9a; --lime: #00ff9c; --amber: #ffb020;
      --bg: #05070f; --panel: #0a0f1e; --line: #1b2b45;
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
    }
    * {
      margin: 0; padding: 0; box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }
    body {
      background: var(--bg);
      color: var(--lime);
      display: flex;
      flex-direction: column;
      height: 100dvh;
      font-family: 'Monaco', 'Courier New', monospace;
      padding-top: var(--safe-top);
      padding-bottom: var(--safe-bottom);
      background-image:
        linear-gradient(rgba(41,233,255,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(41,233,255,.035) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    /* --- terminal fills nearly all vertical space --- */
    #terminal-container {
      position: relative;
      flex: 1;
      overflow: hidden;
      margin: 8px;
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 10px;
      cursor: text;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      background:
        radial-gradient(120% 80% at 50% 0%, rgba(41,233,255,.05), transparent 60%),
        var(--bg);
    }
    #terminal-container::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(0deg, rgba(0,0,0,0) 0 2px, rgba(0,0,0,.10) 2px 3px);
    }
    #terminal-container .xterm {
      height: 100%;
      position: relative;
      z-index: 1;
    }
    #terminal-container .xterm-viewport {
      overflow-y: scroll !important;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-y: contain;
      touch-action: pan-y;
    }
    #terminal-container .xterm * {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    #selection-capture {
      display: none;
      position: absolute;
      inset: 0;
      z-index: 10;
      touch-action: none;
    }
    #tap-hint {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2;
      background: rgba(5,7,15,0.85);
      border: 1px solid var(--line);
      color: #5f7597;
      font-size: 11px;
      letter-spacing: .5px;
      padding: 5px 12px;
      border-radius: 999px;
      pointer-events: none;
      transition: opacity 0.5s;
    }
    .sel-handle {
      display: none;
      position: absolute;
      width: 22px;
      height: 22px;
      margin-left: -11px;
      z-index: 20;
      touch-action: none;
    }
    .sel-handle::before {
      content: '';
      position: absolute;
      top: 0;
      left: 9px;
      width: 4px;
      height: 14px;
      background: var(--cyan);
      border-radius: 2px;
      box-shadow: 0 0 6px var(--cyan);
    }
    .sel-handle::after {
      content: '';
      position: absolute;
      top: 12px;
      left: 5px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--cyan);
      box-shadow: 0 0 8px var(--cyan);
    }
    /* --- floating selection toolbar --- */
    #sel-toolbar {
      display: none;
      position: absolute;
      z-index: 21;
      gap: 6px;
      padding: 5px;
      border-radius: 10px;
      background: rgba(10,15,30,0.95);
      border: 1px solid rgba(41,233,255,.4);
      box-shadow: 0 4px 18px rgba(0,0,0,0.6), 0 0 14px rgba(41,233,255,.25);
      touch-action: none;
    }
    .sel-toolbar-btn {
      min-height: 36px;
      background: linear-gradient(180deg, rgba(0,255,156,.18), rgba(0,255,156,.04));
      color: var(--lime);
      border: 1px solid rgba(0,255,156,.5);
      padding: 8px 14px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 700;
      font-family: 'Monaco', 'Courier New', monospace;
      white-space: nowrap;
      box-shadow: 0 0 10px rgba(0,255,156,.25);
    }
    .sel-toolbar-btn.success { color: var(--lime); border-color: var(--lime); background: rgba(0,255,156,.22); }
    .sel-toolbar-btn.warn { color: var(--amber); border-color: rgba(255,176,32,.6); background: rgba(255,176,32,.12); }
    #sel-cancel-btn {
      color: var(--magenta);
      border-color: rgba(255,46,154,.5);
      background: linear-gradient(180deg, rgba(255,46,154,.16), rgba(255,46,154,.03));
      box-shadow: 0 0 10px rgba(255,46,154,.25);
    }
    /* --- neon key rows --- */
    #keys-row, #keys-row2 {
      display: flex;
      gap: 7px;
      flex-shrink: 0;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    #keys-row::-webkit-scrollbar, #keys-row2::-webkit-scrollbar { display: none; }
    #keys-row { padding: 7px 8px 0; }
    .key-btn {
      flex: 1 0 auto;
      min-width: 38px;
      min-height: 46px;
      padding: 0 6px;
      white-space: nowrap;
      color: var(--cyan);
      border: 1px solid rgba(41,233,255,.32);
      background: linear-gradient(180deg, rgba(41,233,255,.10), rgba(41,233,255,.02));
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
      font-family: 'Monaco', 'Courier New', monospace;
      user-select: none;
      box-shadow: inset 0 0 12px rgba(41,233,255,.06);
      clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
      transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
    }
    .key-btn:active {
      background: linear-gradient(180deg, rgba(41,233,255,.35), rgba(41,233,255,.12));
      box-shadow: 0 0 14px rgba(41,233,255,.55), inset 0 0 12px rgba(41,233,255,.2);
      transform: translateY(1px);
    }
    .key-btn.select-active { color: var(--amber); border-color: rgba(255,176,32,.5); background: linear-gradient(180deg, rgba(255,176,32,.2), rgba(255,176,32,.05)); box-shadow: 0 0 14px rgba(255,176,32,.4); }
    #keys-row2 { padding: 7px 8px 8px; }
    .key-btn2 {
      flex: 1 0 auto;
      min-width: 40px;
      min-height: 40px;
      padding: 0 6px;
      white-space: nowrap;
      color: var(--lime);
      border: 1px solid rgba(0,255,156,.3);
      background: linear-gradient(180deg, rgba(0,255,156,.10), rgba(0,255,156,.02));
      border-radius: 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
      font-family: 'Monaco', 'Courier New', monospace;
      user-select: none;
      box-shadow: inset 0 0 10px rgba(0,255,156,.05);
      clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
      transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
    }
    .key-btn2:active {
      background: linear-gradient(180deg, rgba(0,255,156,.3), rgba(0,255,156,.1));
      box-shadow: 0 0 12px rgba(0,255,156,.45), inset 0 0 10px rgba(0,255,156,.18);
      transform: translateY(1px);
    }
    /* --- collapse handle for the Fn (nano) key row --- */
    #keys-toggle {
      flex-shrink: 0;
      align-self: center;
      margin: 8px auto 0;
      padding: 4px 20px;
      border-radius: 999px;
      border: 1px solid rgba(41,233,255,.28);
      background: rgba(10,15,30,.9);
      color: var(--cyan);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      font-family: 'Monaco', 'Courier New', monospace;
      cursor: pointer;
      box-shadow: inset 0 0 10px rgba(41,233,255,.06);
    }
    #keys-toggle:active {
      background: rgba(41,233,255,.18);
      box-shadow: 0 0 12px rgba(41,233,255,.4);
    }
  </style>
</head>
<body>
  <div id="terminal-container">
    <div id="selection-capture" aria-hidden="true"></div>
    <div id="tap-hint">Tap to type · use Select button to copy text</div>
    <div id="sel-handle-start" class="sel-handle"></div>
    <div id="sel-handle-end" class="sel-handle"></div>
    <div id="sel-toolbar">
      <button id="sel-copy-btn" class="sel-toolbar-btn">Copy</button>
      <button id="sel-cancel-btn" class="sel-toolbar-btn">✕</button>
    </div>
  </div>
  <div id="keys-row">
    <button class="key-btn" onclick="sendKey('\\x1b[A')">▲</button>
    <button class="key-btn" onclick="sendKey('\\x1b[B')">▼</button>
    <button class="key-btn" onclick="sendKey('\\x1b[D')">◀</button>
    <button class="key-btn" onclick="sendKey('\\x1b[C')">▶</button>
    <button class="key-btn" onclick="sendKey('\\x1b')">Esc</button>
    <button class="key-btn" onclick="sendKey('\\t')">Tab</button>
    <button class="key-btn" onclick="sendKey('\\x03')">^C</button>
    <button class="key-btn" onclick="pasteClipboard()">Paste</button>
  </div>
  <button id="keys-toggle" onclick="toggleKeysRow()" aria-label="Toggle Fn keys">▾ Fn keys</button>
  <div id="keys-row2">
    <button class="key-btn2" onclick="sendKey('\\x18')">^X Exit</button>
    <button class="key-btn2" onclick="sendKey('\\x0f')">^O Save</button>
    <button class="key-btn2" onclick="sendKey('\\x17')">^W Find</button>
    <button class="key-btn2" onclick="sendKey('\\x0b')">^K Cut</button>
    <button class="key-btn2" onclick="sendKey('\\x15')">^U Paste</button>
    <button class="key-btn2" id="sel-btn" onclick="toggleSelectMode()">Select</button>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
  <script>
    const term = new Terminal({
      theme: {
        background: '#05070f',
        foreground: '#00ff9c',
        cursor: '#29e9ff',
        cursorAccent: '#05070f',
        selectionBackground: 'rgba(41,233,255,0.35)',
      },
      fontSize: 14,
      fontFamily: 'Monaco, Courier New, monospace',
      convertEol: true,
      scrollback: 2000,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));
    fitAddon.fit();

    // --- Touch-based text selection -------------------------------------
    // Selection is triggered only via the Select button (toggleSelectMode).
    // Once in select mode any drag on the terminal extends the selection via
    // two draggable handles + a floating copy toolbar. Normal taps are
    // always forwarded to the terminal for typing/focus, and never
    // accidentally open the selection UI.
    (function setupSelection() {
      const container = document.getElementById('terminal-container');
      const selectionCapture = document.getElementById('selection-capture');
      const handleA = document.getElementById('sel-handle-start');
      const handleB = document.getElementById('sel-handle-end');
      const toolbar = document.getElementById('sel-toolbar');
      const copyBtn = document.getElementById('sel-copy-btn');
      const cancelBtn = document.getElementById('sel-cancel-btn');

      let anchorA = null; // raw cell tied to handleA / the selection's lower bound
      let anchorB = null; // raw cell tied to handleB / the selection's upper bound
      let mode = 'idle'; // idle | dragLegacy

      function getCell(touch) {
        const rect = container.getBoundingClientRect();
        const x = touch.clientX - rect.left - 4; // 4px padding
        const y = touch.clientY - rect.top - 4;
        const cellW = (rect.width - 8) / term.cols;
        const cellH = (rect.height - 8) / term.rows;
        const col = Math.max(0, Math.min(term.cols - 1, Math.floor(x / cellW)));
        const row = Math.max(0, Math.min(term.rows - 1, Math.floor(y / cellH)));
        return { col, row };
      }

      function cellRect(cell) {
        const rect = container.getBoundingClientRect();
        const cellW = (rect.width - 8) / term.cols;
        const cellH = (rect.height - 8) / term.rows;
        return {
          x: 4 + cell.col * cellW,
          y: 4 + cell.row * cellH,
          w: cellW,
          h: cellH,
          containerW: rect.width,
          containerH: rect.height,
        };
      }

      function setSelection(a, b) {
        let { col: c1, row: r1 } = a;
        let { col: c2, row: r2 } = b;
        if (r1 > r2 || (r1 === r2 && c1 > c2)) {
          [c1, c2] = [c2, c1];
          [r1, r2] = [r2, r1];
        }
        window.selStart = { col: c1, row: r1 };
        window.selEnd = { col: c2, row: r2 };
        const length = r1 === r2
          ? Math.max(1, c2 - c1 + 1)
          : (term.cols - c1) + (r2 - r1 - 1) * term.cols + (c2 + 1);
        term.select(c1, term.buffer.active.viewportY + r1, length);
        isSelecting = true;
        renderHandles();
      }

      function endSelectionSession() {
        isSelecting = false;
        window.selStart = null;
        window.selEnd = null;
        anchorA = null;
        anchorB = null;
        term.clearSelection();
        renderHandles();
      }

      function findWordBounds(cell) {
        const absRow = term.buffer.active.viewportY + cell.row;
        const line = term.buffer.active.getLine(absRow);
        let startCol = cell.col;
        let endCol = cell.col;
        if (line) {
          const text = line.translateToString(false);
          if (text[cell.col] && /\\S/.test(text[cell.col])) {
            while (startCol > 0 && /\\S/.test(text[startCol - 1])) startCol--;
            while (endCol < text.length - 1 && /\\S/.test(text[endCol + 1])) endCol++;
          }
        }
        return { startCol, endCol };
      }

      function beginWordSelection(cell) {
        const { startCol, endCol } = findWordBounds(cell);
        anchorA = { col: startCol, row: cell.row };
        anchorB = { col: endCol, row: cell.row };
        setSelection(anchorA, anchorB);
      }

      function renderHandles() {
        if (!isSelecting || !window.selStart || !window.selEnd) {
          handleA.style.display = 'none';
          handleB.style.display = 'none';
          toolbar.style.display = 'none';
          return;
        }
        const a = cellRect(window.selStart);
        const b = cellRect(window.selEnd);
        handleA.style.display = 'block';
        handleA.style.left = a.x + 'px';
        handleA.style.top = (a.y + a.h) + 'px';
        handleB.style.display = 'block';
        handleB.style.left = (b.x + b.w) + 'px';
        handleB.style.top = (b.y + b.h) + 'px';

        toolbar.style.display = 'flex';
        const toolbarTop = a.y - 38 >= 2 ? a.y - 38 : b.y + b.h + 28;
        let toolbarLeft = a.x;
        toolbarLeft = Math.max(4, Math.min(toolbarLeft, a.containerW - 96));
        toolbar.style.top = toolbarTop + 'px';
        toolbar.style.left = toolbarLeft + 'px';
      }

      function bindHandle(el, which) {
        el.addEventListener('touchstart', (e) => {
          e.preventDefault();
          e.stopPropagation();
        }, { passive: false });
        el.addEventListener('touchmove', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cell = getCell(e.touches[0]);
          if (which === 'A') anchorA = cell; else anchorB = cell;
          setSelection(anchorA, anchorB);
        }, { passive: false });
        el.addEventListener('touchend', (e) => {
          e.preventDefault();
          e.stopPropagation();
        }, { passive: false });
      }
      bindHandle(handleA, 'A');
      bindHandle(handleB, 'B');

      function bindToolbarButton(el, action) {
        el.addEventListener('touchstart', (e) => {
          e.preventDefault();
          e.stopPropagation();
        }, { passive: false });
        el.addEventListener('touchend', (e) => {
          e.preventDefault();
          e.stopPropagation();
          action();
        }, { passive: false });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          action();
        });
      }
      bindToolbarButton(cancelBtn, endSelectionSession);
      bindToolbarButton(copyBtn, copySelectionText);

      // Keep selection gestures on an opt-in overlay. In normal mode xterm's
      // viewport receives the touch stream directly, which preserves native
      // vertical and momentum scrolling inside iOS/Android WebViews.
      selectionCapture.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const cell = getCell(touch);
        mode = 'dragLegacy';
        anchorA = cell;
        anchorB = cell;
        setSelection(anchorA, anchorB);
      }, { passive: false });

      selectionCapture.addEventListener('touchmove', (e) => {
        if (mode === 'dragLegacy') {
          e.preventDefault();
          anchorB = getCell(e.touches[0]);
          setSelection(anchorA, anchorB);
        }
      }, { passive: false });

      selectionCapture.addEventListener('touchend', (e) => {
        if (mode === 'dragLegacy') {
          e.preventDefault();
          mode = 'idle';
        }
      }, { passive: false });

      window.endSelectionSession = endSelectionSession;
      window.renderHandles = renderHandles;
    })();

    function sendResize() {
      fitAddon.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
      if (typeof renderHandles === 'function') renderHandles();
    }

    window.addEventListener('resize', sendResize);

    // --- collapsible Fn (nano) key row ---------------------------------
    // The second key row eats vertical space; collapsing it hands that
    // height back to the terminal. Preference is remembered per device.
    function applyKeysRow(show) {
      const row2 = document.getElementById('keys-row2');
      const btn = document.getElementById('keys-toggle');
      if (!row2 || !btn) return;
      row2.style.display = show ? 'flex' : 'none';
      btn.textContent = (show ? '\u25be' : '\u25b4') + ' Fn keys';
      try { localStorage.setItem('cyberlab_fnrow', show ? '1' : '0'); } catch (e) {}
    }
    function toggleKeysRow() {
      const row2 = document.getElementById('keys-row2');
      const show = row2.style.display === 'none';
      applyKeysRow(show);
      // let layout settle, then refit the terminal into the reclaimed space
      setTimeout(sendResize, 60);
    }
    (function initKeysRow() {
      let show = true;
      try { if (localStorage.getItem('cyberlab_fnrow') === '0') show = false; } catch (e) {}
      applyKeysRow(show);
    })();

    let ws = null;
    let selectMode = false;
    let isSelecting = false;
    let heartbeat = null;
    const tapHint = document.getElementById('tap-hint');

    term.onData((data) => {
      if (selectMode || isSelecting) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'key', sequence: data }));
      }
    });

    function sendKey(sequence) {
      if (selectMode || isSelecting) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'key', sequence }));
      term.focus();
    }

    function toggleSelectMode() {
      selectMode = !selectMode;
      const selBtn = document.getElementById('sel-btn');
      const selectionCapture = document.getElementById('selection-capture');
      selectionCapture.style.display = selectMode ? 'block' : 'none';
      if (selectMode) {
        selBtn.textContent = '✗ Select';
        selBtn.classList.add('select-active');
      } else {
        selBtn.textContent = 'Select';
        selBtn.classList.remove('select-active');
        if (typeof endSelectionSession === 'function') endSelectionSession();
        term.focus();
      }
    }

    async function copySelectionText() {
      const copyBtn = document.getElementById('sel-copy-btn');
      const text = term.getSelection();
      if (!text) {
        endSelectionSession();
        return;
      }

      function flash(label, cls) {
        copyBtn.textContent = label;
        if (cls) copyBtn.classList.add(cls);
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('success', 'warn');
          endSelectionSession();
          if (selectMode) toggleSelectMode();
        }, 900);
      }

      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        let settled = false;
        window.__onCopyAck = function (success) {
          if (settled) return;
          settled = true;
          window.__onCopyAck = null;
          flash(success ? '✓ Copied!' : 'Copy failed', success ? 'success' : 'warn');
        };
        setTimeout(() => {
          if (settled) return;
          settled = true;
          window.__onCopyAck = null;
          flash('No response', 'warn');
        }, 2000);
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'copy', text }));
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        flash('✓ Copied!', 'success');
      } catch (e) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          flash('✓ Copied!', 'success');
        } catch (e2) {
          flash('Copy failed', 'warn');
        }
      }
    }

    async function pasteClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        if (text && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'key', sequence: '\\x1b[200~' + text + '\\x1b[201~' }));
          term.focus();
        }
      } catch (e) {
        term.write('\\r\\n[Clipboard access denied]\\r\\n');
      }
    }

    function postNative(message) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }
    }

    function terminalTabAction(action, tabId) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        postNative({ type: 'terminalTabError', message: 'The terminal relay is reconnecting.' });
        return;
      }
      ws.send(JSON.stringify({ type: 'tab', action, tabId: tabId || null }));
    }

    function terminalTabCommand(tabId, command) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        postNative({ type: 'terminalTabError', message: 'The terminal relay is reconnecting.' });
        return;
      }
      ws.send(JSON.stringify({ type: 'tab', action: 'command', tabId, command }));
    }

    window.terminalTabAction = terminalTabAction;
    window.terminalTabCommand = terminalTabCommand;

    function connect() {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(\`\${protocol}//\${window.location.host}/ws\`);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', clientType: 'phone' }));
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        ws.send(JSON.stringify({ type: 'tab', action: 'list' }));
        postNative({ type: 'terminalConnection', connected: true });
        term.focus();
        // Heartbeat every 30s keeps Railway's proxy from closing idle connections
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'output') {
          term.write(data.output);
        } else if (data.type === 'tabState') {
          postNative({ type: 'terminalTabs', tabs: data.tabs });
        } else if (data.type === 'tabError') {
          postNative({ type: 'terminalTabError', message: data.message });
        }
      };

      ws.onclose = () => {
        clearInterval(heartbeat);
        postNative({ type: 'terminalConnection', connected: false });
        term.write('\\r\\n[Disconnected. Reconnecting...]\\r\\n');
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {};
    }

    // Reconnect immediately when switching back to this tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          term.write('\\r\\n[Reconnecting...]\\r\\n');
          connect();
        }
      }
    });

    connect();
  </script>
</body>
</html>
`;
}

console.log("Terminal relay server running on port 3000");
