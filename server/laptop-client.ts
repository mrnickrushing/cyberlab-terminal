import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";

const RELAY_URL =
  process.env.CYBERLAB_RELAY_URL || "wss://terminal.vitallity.org/ws";
const TMUX_SESSION = process.env.CYBERLAB_TMUX_SESSION || "cyberlab";
const MAX_TERMINAL_TABS = 6;
const DEFAULT_SHELL = process.env.CYBERLAB_SHELL || "/usr/bin/fish";
const execFileAsync = promisify(execFile);

type RelayMessage = {
  type?: string;
  action?: string;
  tabId?: string | null;
  command?: string;
  sequence?: string;
  cols?: number;
  rows?: number;
  delta?: number;
};

type TerminalTab = {
  id: string;
  index: number;
  title: string;
  command: string;
  active: boolean;
  running: boolean;
};

let socket: WebSocket | null = null;
let ptyProcess: pty.IPty | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let ptyRestartTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let tabStateTimer: ReturnType<typeof setInterval> | null = null;
let lastTabState = "";
let actionQueue = Promise.resolve();
let shuttingDown = false;

async function runTmux(args: string[]) {
  return execFileAsync("tmux", args, {
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
}

async function ensureTmuxSession() {
  try {
    await runTmux(["has-session", "-t", TMUX_SESSION]);
  } catch {
    await runTmux([
      "new-session",
      "-d",
      "-s",
      TMUX_SESSION,
      "-n",
      "Terminal 1",
      DEFAULT_SHELL,
    ]);
  }

  await runTmux(["set-option", "-t", TMUX_SESSION, "base-index", "0"]);
  await runTmux(["set-option", "-t", TMUX_SESSION, "renumber-windows", "on"]);
  // Keep plenty of scrollback so the phone can page back through history.
  await runTmux(["set-option", "-g", "history-limit", "50000"]);
}

async function listTerminalTabs(): Promise<TerminalTab[]> {
  await ensureTmuxSession();
  const format = [
    "#{window_id}",
    "#{window_index}",
    "#{window_name}",
    "#{window_active}",
    "#{pane_current_command}",
    "#{pane_dead}",
  ].join("\t");
  const { stdout } = await runTmux([
    "list-windows",
    "-t",
    TMUX_SESSION,
    "-F",
    format,
  ]);

  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, index, , active, command, dead] = line.split("\t");
      return {
        id,
        index: Number(index) + 1,
        title: `Terminal ${Number(index) + 1}`,
        command: command || "shell",
        active: active === "1",
        running: dead !== "1",
      };
    })
    .sort((left, right) => left.index - right.index);
}

async function normalizeTerminalTitles() {
  const tabs = await listTerminalTabs();
  await Promise.all(
    tabs.flatMap((tab, position) => [
      runTmux(["set-window-option", "-t", tab.id, "automatic-rename", "off"]),
      runTmux(["rename-window", "-t", tab.id, `Terminal ${position + 1}`]),
    ]),
  );
}

function send(message: object) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

async function sendTabState(force = false) {
  try {
    const tabs = await listTerminalTabs();
    const serialized = JSON.stringify(tabs);
    if (!force && serialized === lastTabState) return;
    lastTabState = serialized;
    send({ type: "tabState", tabs });
  } catch (error) {
    sendTabError(error);
  }
}

function sendTabError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Terminal tab error:", error);
  send({ type: "tabError", message });
}

async function requireTerminalTab(tabId: string | null | undefined) {
  if (!tabId) throw new Error("No terminal tab was selected.");
  const tabs = await listTerminalTabs();
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) throw new Error("That terminal tab is no longer available.");
  return tab;
}

async function handleTabAction(message: RelayMessage) {
  switch (message.action) {
    case "list":
      await sendTabState(true);
      return;
    case "create": {
      const tabs = await listTerminalTabs();
      if (tabs.length >= MAX_TERMINAL_TABS) {
        throw new Error(`No more than ${MAX_TERMINAL_TABS} terminals can be open.`);
      }
      const nextTitle = `Terminal ${tabs.length + 1}`;
      const { stdout } = await runTmux([
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-t",
        `${TMUX_SESSION}:`,
        "-n",
        nextTitle,
        DEFAULT_SHELL,
      ]);
      const windowId = stdout.trim();
      if (!windowId) throw new Error("tmux did not return the new terminal ID.");
      await runTmux(["select-window", "-t", windowId]);
      await normalizeTerminalTitles();
      await sendTabState(true);
      return;
    }
    case "select": {
      const tab = await requireTerminalTab(message.tabId);
      await runTmux(["select-window", "-t", tab.id]);
      await sendTabState(true);
      return;
    }
    case "close": {
      const tabs = await listTerminalTabs();
      if (tabs.length <= 1) throw new Error("The final terminal cannot be closed.");
      const tab = await requireTerminalTab(message.tabId);
      await runTmux(["kill-window", "-t", tab.id]);
      await normalizeTerminalTitles();
      await sendTabState(true);
      return;
    }
    case "command": {
      const tab = await requireTerminalTab(message.tabId);
      if (typeof message.command !== "string" || !message.command) {
        throw new Error("The terminal command was empty.");
      }
      await runTmux(["send-keys", "-t", tab.id, "-l", message.command]);
      await runTmux(["send-keys", "-t", tab.id, "Enter"]);
      return;
    }
    case "scroll": {
      // The phone drags to scroll tmux's history. Positive delta scrolls back
      // into scrollback, negative scrolls toward the live tail. We drive the
      // active pane's copy-mode the same way tmux's own mouse-wheel binding
      // does (send -N<count> -X scroll-up / scroll-down).
      const delta = Math.trunc(Number(message.delta) || 0);
      if (!delta) return;
      const count = String(Math.min(2000, Math.abs(delta)));
      if (delta > 0) {
        // copy-mode -e exits automatically once the user scrolls back to the
        // bottom, so dragging down to the end snaps back to live output.
        await runTmux(["copy-mode", "-e", "-t", TMUX_SESSION]);
        await runTmux(["send-keys", "-t", TMUX_SESSION, "-N", count, "-X", "scroll-up"]);
      } else {
        const { stdout } = await runTmux([
          "display-message", "-p", "-t", TMUX_SESSION, "#{pane_in_mode}",
        ]);
        if (stdout.trim() === "1") {
          await runTmux(["send-keys", "-t", TMUX_SESSION, "-N", count, "-X", "scroll-down"]);
        }
      }
      return;
    }
    case "scrollReset": {
      // Snap back to the live tail by cancelling copy-mode. Harmless if the
      // pane is not currently in copy-mode.
      try {
        await runTmux(["send-keys", "-t", TMUX_SESSION, "-X", "cancel"]);
      } catch {
        // Not in copy-mode; nothing to reset.
      }
      return;
    }
    default:
      throw new Error("Unknown terminal tab action.");
  }
}

function stopPty() {
  if (ptyRestartTimer) {
    clearTimeout(ptyRestartTimer);
    ptyRestartTimer = null;
  }
  const current = ptyProcess;
  ptyProcess = null;
  current?.kill();
}

async function startPty() {
  if (ptyProcess || socket?.readyState !== WebSocket.OPEN || shuttingDown) return;
  await ensureTmuxSession();
  await normalizeTerminalTitles();

  const current = pty.spawn("tmux", ["attach-session", "-t", TMUX_SESSION], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || "/",
    env: process.env as Record<string, string>,
  });
  ptyProcess = current;

  current.onData((output) => {
    send({ type: "output", output });
  });

  current.onExit(() => {
    if (ptyProcess !== current) return;
    ptyProcess = null;
    if (socket?.readyState === WebSocket.OPEN && !shuttingDown) {
      ptyRestartTimer = setTimeout(() => {
        ptyRestartTimer = null;
        void startPty().catch(sendTabError);
      }, 1000);
    }
  });
}

function clearConnectionTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (tabStateTimer) clearInterval(tabStateTimer);
  heartbeatTimer = null;
  tabStateTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer || shuttingDown) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function connect() {
  if (
    shuttingDown ||
    socket?.readyState === WebSocket.OPEN ||
    socket?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }

  const nextSocket = new WebSocket(RELAY_URL);
  socket = nextSocket;

  nextSocket.onopen = () => {
    if (socket !== nextSocket) return;
    send({ type: "register", clientType: "laptop" });
    heartbeatTimer = setInterval(() => send({ type: "ping" }), 30000);
    tabStateTimer = setInterval(() => void sendTabState(), 1500);
    void startPty()
      .then(() => sendTabState(true))
      .catch(sendTabError);
    console.log("Connected to relay server");
  };

  nextSocket.onmessage = (event) => {
    if (socket !== nextSocket) return;
    let message: RelayMessage;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.type === "key" && typeof message.sequence === "string") {
      ptyProcess?.write(message.sequence);
    } else if (message.type === "command" && typeof message.command === "string") {
      ptyProcess?.write(`${message.command}\r`);
    } else if (
      message.type === "resize" &&
      Number.isInteger(message.cols) &&
      Number.isInteger(message.rows)
    ) {
      const cols = Math.max(20, Math.min(300, message.cols as number));
      const rows = Math.max(8, Math.min(120, message.rows as number));
      ptyProcess?.resize(cols, rows);
    } else if (message.type === "tab") {
      actionQueue = actionQueue
        .then(() => handleTabAction(message))
        .catch(async (error) => {
          sendTabError(error);
          await sendTabState(true);
        });
    }
  };

  nextSocket.onclose = () => {
    if (socket !== nextSocket) return;
    socket = null;
    clearConnectionTimers();
    stopPty();
    console.log("Disconnected. Reconnecting in 3s...");
    scheduleReconnect();
  };

  nextSocket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

function shutdown() {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearConnectionTimers();
  stopPty();
  socket?.close();
  socket = null;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

connect();
