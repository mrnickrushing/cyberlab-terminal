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

        if ((data.type === "command" || data.type === "key" || data.type === "resize") && client.type === "phone") {
          const laptopClient = Array.from(clients.values()).find(
            (c) => c.type === "laptop"
          );
          if (laptopClient) {
            laptopClient.ws.send(JSON.stringify(data));
          }
          return;
        }

        if (data.type === "output" && client.type === "laptop") {
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Terminal Remote</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0d0d0d;
      color: #00ff00;
      display: flex;
      flex-direction: column;
      height: 100dvh;
      font-family: 'Monaco', 'Courier New', monospace;
    }
    #status {
      padding: 6px 12px;
      font-size: 12px;
      background: #3a1a1a;
      color: #ff6b6b;
      flex-shrink: 0;
    }
    #status.connected { background: #1a3a1a; color: #00ff00; }
    #terminal-container {
      position: relative;
      flex: 1;
      overflow: hidden;
      padding: 4px;
      cursor: text;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    #terminal-container .xterm {
      height: 100%;
    }
    #terminal-container .xterm * {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    #tap-hint {
      position: absolute;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.7);
      color: #666;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 10px;
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
      background: #29e9ff;
      border-radius: 2px;
    }
    .sel-handle::after {
      content: '';
      position: absolute;
      top: 12px;
      left: 5px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #29e9ff;
    }
    #sel-toolbar {
      display: none;
      position: absolute;
      z-index: 21;
      gap: 4px;
      padding: 4px;
      border-radius: 8px;
      background: #14202c;
      border: 1px solid #29e9ff55;
      box-shadow: 0 4px 10px rgba(0,0,0,0.5);
      touch-action: none;
    }
    .sel-toolbar-btn {
      background: #1a2a3a;
      color: #6ee9ff;
      border: 1px solid #29e9ff33;
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-family: 'Monaco', 'Courier New', monospace;
      white-space: nowrap;
    }
    .sel-toolbar-btn.success { color: #00ff00; border-color: #00aa00; background: #0a2a0a; }
    .sel-toolbar-btn.warn { color: #ffaa00; border-color: #aa6600; }
    #sel-cancel-btn { color: #ff8b7c; border-color: #ff8b7c33; }
    #keys-row {
      display: flex;
      gap: 5px;
      padding: 6px 8px;
      background: #1a1a1a;
      border-top: 1px solid #333;
      flex-shrink: 0;
    }
    .key-btn {
      flex: 1;
      background: #2a2a2a;
      color: #00ff00;
      border: 1px solid #444;
      padding: 10px 4px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-family: 'Monaco', 'Courier New', monospace;
      user-select: none;
    }
    .key-btn:active { background: #3a3a3a; }
    .key-btn.select-active { background: #2a1a4a; color: #aa66ff; border-color: #664499; }
    #keys-row2 {
      display: flex;
      gap: 5px;
      padding: 0 8px 6px;
      background: #1a1a1a;
      flex-shrink: 0;
    }
    .key-btn2 {
      flex: 1;
      background: #1a2a1a;
      color: #00cc00;
      border: 1px solid #2a4a2a;
      padding: 7px 2px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      font-family: 'Monaco', 'Courier New', monospace;
      user-select: none;
    }
    .key-btn2:active { background: #2a3a2a; }
  </style>
</head>
<body>
  <div id="status">✗ Disconnected</div>
  <div id="terminal-container">
    <div id="tap-hint">Tap to type · long-press text to select</div>
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
    <button class="key-btn" onclick="sendKey('\\t')">Tab</button>
    <button class="key-btn" onclick="sendKey('\\x03')">Ctrl+C</button>
    <button class="key-btn" onclick="pasteClipboard()">Paste</button>
  </div>
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
        background: '#0d0d0d',
        foreground: '#00ff00',
        cursor: '#00ff00',
      },
      fontSize: 13,
      fontFamily: 'Monaco, Courier New, monospace',
      convertEol: true,
      scrollback: 2000,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));
    fitAddon.fit();

    // --- Touch-based text selection -------------------------------------
    // xterm's DOM renderer produces real, natively-selectable <span> text.
    // Without disabling that (see CSS above) a long-press on mobile is
    // captured by the WebView's own text-selection/context-menu instead of
    // reaching this code, which is why selection previously did nothing.
    // Selection here is driven entirely through term.select() + two
    // draggable handles + a floating copy toolbar, mirroring native
    // long-press-to-select-word, drag-to-extend mobile text selection.
    (function setupSelection() {
      const container = document.getElementById('terminal-container');
      const handleA = document.getElementById('sel-handle-start');
      const handleB = document.getElementById('sel-handle-end');
      const toolbar = document.getElementById('sel-toolbar');
      const copyBtn = document.getElementById('sel-copy-btn');
      const cancelBtn = document.getElementById('sel-cancel-btn');

      const LONG_PRESS_MS = 380;
      const MOVE_THRESHOLD = 10;

      let anchorA = null; // raw cell tied to handleA / the selection's lower bound
      let anchorB = null; // raw cell tied to handleB / the selection's upper bound
      let mode = 'idle'; // idle | maybeClear | dragLegacy | extending
      let longPressTimer = null;
      let touchStartPos = null;
      let touchMoved = false;

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

      container.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        touchMoved = false;
        const cell = getCell(touch);

        if (selectMode) {
          e.preventDefault();
          mode = 'dragLegacy';
          anchorA = cell;
          anchorB = cell;
          setSelection(anchorA, anchorB);
          return;
        }

        mode = isSelecting ? 'maybeClear' : 'idle';

        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          if (touchMoved) return;
          if (isSelecting) endSelectionSession();
          beginWordSelection(cell);
          mode = 'extending';
        }, LONG_PRESS_MS);
      }, { passive: false });

      container.addEventListener('touchmove', (e) => {
        const touch = e.touches[0];
        if (!touchMoved && touchStartPos) {
          const dist = Math.hypot(touch.clientX - touchStartPos.x, touch.clientY - touchStartPos.y);
          if (dist > MOVE_THRESHOLD) {
            touchMoved = true;
            clearTimeout(longPressTimer);
          }
        }
        if (mode === 'dragLegacy' || mode === 'extending') {
          e.preventDefault();
          anchorB = getCell(touch);
          setSelection(anchorA, anchorB);
        }
      }, { passive: false });

      container.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer);
        if (mode === 'dragLegacy' || mode === 'extending') {
          mode = 'idle';
          return;
        }
        if (!touchMoved) {
          if (mode === 'maybeClear') {
            endSelectionSession();
          } else if (!isSelecting) {
            term.focus();
            tapHint.style.opacity = '0';
          }
        }
        mode = 'idle';
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

    let ws = null;
    let selectMode = false;
    let isSelecting = false;
    let heartbeat = null;
    const statusEl = document.getElementById('status');
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
      if (selectMode) {
        selBtn.textContent = '✗ Select';
        selBtn.classList.add('select-active');
        statusEl.textContent = '✓ Select mode — drag to highlight, then tap Copy';
      } else {
        selBtn.textContent = 'Select';
        selBtn.classList.remove('select-active');
        if (typeof endSelectionSession === 'function') endSelectionSession();
        term.focus();
        statusEl.textContent = '✓ Connected — tap terminal to type';
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
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'copy', text }));
        flash('✓ Copied!', 'success');
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

    function connect() {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(\`\${protocol}//\${window.location.host}/ws\`);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'register', clientType: 'phone' }));
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        statusEl.className = 'connected';
        statusEl.textContent = '✓ Connected — tap terminal to type';
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
        }
      };

      ws.onclose = () => {
        clearInterval(heartbeat);
        statusEl.className = '';
        statusEl.textContent = '✗ Disconnected';
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