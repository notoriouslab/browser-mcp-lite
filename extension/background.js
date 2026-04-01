// Browser MCP Lite — Service Worker (Background Script)
// WebSocket client + message router
// Uses chrome.alarms to survive MV3 Service Worker termination

const WS_URL = 'ws://127.0.0.1:12307/ws';
const KEEPALIVE_ALARM = 'keepalive';
const KEEPALIVE_INTERVAL = 0.4; // minutes (~24 seconds, under 30s SW timeout)

let ws = null;
let connected = false;
let wsToken = null; // Loaded from chrome.storage.local

// --- Connection State ---
function updateState(isConnected) {
  connected = isConnected;
  chrome.runtime.sendMessage({ type: 'connectionState', connected }).catch(() => {});
}

// --- Load token from storage ---
async function loadToken() {
  const result = await chrome.storage.local.get('token');
  wsToken = result.token || null;
  return wsToken;
}

// --- WebSocket Connection ---
async function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  if (!wsToken) await loadToken();
  if (!wsToken) {
    console.log('[MCP] No token configured — open popup to set one');
    return;
  }

  try {
    ws = new WebSocket(WS_URL);
  } catch {
    return; // alarm will retry
  }

  ws.onopen = () => {
    console.log('[MCP] WebSocket open, authenticating...');
    ws.send(JSON.stringify({ type: 'auth', token: wsToken }));
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'auth_ok') {
      console.log('[MCP] Authenticated');
      updateState(true);
      return;
    }

    handleToolRequest(msg);
  };

  ws.onclose = (event) => {
    console.log('[MCP] Disconnected', event.code, event.reason);
    ws = null;
    updateState(false);
    // alarm will handle reconnection
  };

  ws.onerror = () => {};
}

function disconnect() {
  chrome.alarms.clear(KEEPALIVE_ALARM);
  if (ws) { ws.close(); ws = null; }
  updateState(false);
}

// --- Keepalive Alarm ---
// Fires every ~24 seconds to keep the Service Worker alive
// and reconnect the WebSocket if needed.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[MCP] Alarm: reconnecting...');
      connect();
    }
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }
});

async function startKeepalive() {
  await loadToken();
  if (!wsToken) {
    console.log('[MCP] No token — skipping auto-connect');
    return;
  }
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_INTERVAL });
  connect();
}

// --- Tool Request Handler ---
async function handleToolRequest(msg) {
  const { id, method, params } = msg;
  try {
    let result;
    switch (method) {
      case 'list_tabs':
        result = await toolListTabs();
        break;
      case 'read_page':
        result = await toolReadPage(params);
        break;
      case 'screenshot':
        result = await toolScreenshot(params);
        break;
      case 'inject_script':
        result = await toolInjectScript(params);
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    ws?.send(JSON.stringify({ id, result }));
  } catch (err) {
    ws?.send(JSON.stringify({ id, error: err.message }));
  }
}

// --- Tool Implementations ---

async function toolListTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active }));
}

const RESTRICTED_PREFIXES = ['chrome://', 'chrome-extension://', 'about:', 'file://', 'data:'];

function isRestricted(url) {
  const lower = (url || '').toLowerCase();
  return !url || RESTRICTED_PREFIXES.some(p => lower.startsWith(p));
}

async function getTargetTab(tabId) {
  if (tabId != null) {
    const tab = await chrome.tabs.get(tabId);
    return tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab;
}

async function toolReadPage(params) {
  const tab = await getTargetTab(params?.tabId);
  if (isRestricted(tab.url)) throw new Error('Cannot read this type of page');

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['inject/accessibility-tree.js'],
  });

  if (!results?.[0]?.result) throw new Error('Failed to read page DOM');
  return results[0].result;
}

async function toolScreenshot(params) {
  const tab = await getTargetTab(params?.tabId);
  if (!tab.active) {
    await chrome.tabs.update(tab.id, { active: true });
    await new Promise(r => setTimeout(r, 300));
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return dataUrl;
}

async function toolInjectScript(params) {
  const { code, tabId } = params;
  if (!code) throw new Error('code is required');
  const tab = await getTargetTab(tabId);
  if (isRestricted(tab.url)) throw new Error('Cannot inject into this type of page');

  const resultKey = '__mcp_r_' + Date.now();
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: (userCode, key) => {
      try {
        const script = document.createElement('script');
        script.textContent = `try { window['${key}'] = { ok: true, value: (function(){ ${userCode} })() }; } catch(e) { window['${key}'] = { ok: false, error: e.message + '\\n' + (e.stack||'').slice(0,500) }; }`;
        document.documentElement.appendChild(script);
        script.remove();
        const res = window[key];
        delete window[key];
        if (!res) return { ok: false, error: 'Script produced no result (CSP may block inline scripts on this page)' };
        if (res.ok) {
          try { JSON.stringify(res.value); } catch {
            return { ok: false, error: `Return value is not JSON serializable: ${typeof res.value}` };
          }
        }
        return res;
      } catch (err) {
        return { ok: false, error: `${err.message}\n${(err.stack || '').slice(0, 500)}` };
      }
    },
    args: [code, resultKey],
  });

  const res = results?.[0]?.result;
  if (!res) throw new Error('Script execution returned no result');
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

// --- Message handler for popup ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getState') {
    sendResponse({ connected, hasToken: !!wsToken });
    return;
  }
  if (msg.type === 'setToken') {
    wsToken = msg.token;
    chrome.storage.local.set({ token: msg.token });
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'connect') {
    startKeepalive();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'disconnect') {
    disconnect();
    sendResponse({ ok: true });
    return;
  }
});

// --- Auto-start on install/startup ---
chrome.runtime.onInstalled.addListener(() => startKeepalive());
chrome.runtime.onStartup.addListener(() => startKeepalive());
startKeepalive();
