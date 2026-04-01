# browser-mcp-lite

[繁體中文](README.zh-TW.md) | English

**Give your AI assistant eyes into your real browser — in ~500 lines of code.**

A minimal, auth-secured [MCP](https://modelcontextprotocol.io/) server that lets AI assistants read pages, take screenshots, and run scripts in your actual Chrome browser — with your existing login sessions intact.

```
AI Assistant ──HTTP POST──▶ MCP Server (:12307) ──WebSocket──▶ Chrome Extension ──▶ DOM
                            (token auth)           (ws://)       (minimal permissions)
```

## Why build your own?

Existing browser MCP solutions are either:

- **Too heavy** — [mcp-chrome](https://github.com/nicholasoxford/mcp-chrome) requires `debugger`, `history`, `<all_urls>` permissions, ships minified code you can't audit
- **Headless only** — [Playwright MCP](https://github.com/nicousm/playwright-mcp-server) launches a new browser, can't see your logged-in sessions
- **Cloud-dependent** — Browserbase, etc. route your pages through third-party servers

browser-mcp-lite takes a different approach:

| | mcp-chrome | Playwright MCP | **browser-mcp-lite** |
|---|---|---|---|
| Reads your real browser | Yes | No (headless) | **Yes** |
| Auth on MCP endpoint | No | No | **Token auth** |
| Extension permissions | 8+ | N/A | **5 (minimal)** |
| Code you can audit | Minified | Yes | **~500 lines** |
| Login sessions | Yes | No | **Yes** |

## What it does

Four tools, exposed via standard MCP protocol:

| Tool | Description | Returns |
|------|-------------|---------|
| `list_tabs` | List all open tabs | `[{id, url, title, active}]` |
| `read_page` | Read page as accessibility tree | Structured text (token-efficient) |
| `screenshot` | Capture visible area | Base64 PNG image |
| `inject_script` | Run custom JS in a tab | Script return value |

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/notoriouslab/browser-mcp-lite.git
cd browser-mcp-lite/server
npm install
```

### 2. Generate auth token

```bash
node setup.js
```

This creates `~/.browser-mcp-secrets.json` with a random 64-char hex token. File permissions are set to `600` (owner-only).

### 3. Load the Chrome Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Click the Browser MCP Lite icon in your toolbar
5. Paste the token from `~/.browser-mcp-secrets.json` into the **Auth Token** field
6. Click **Connect**

### 4. Start the server

```bash
node index.js
```

```
[browser-mcp-lite] MCP server: http://127.0.0.1:12307/mcp
[browser-mcp-lite] WebSocket:  ws://127.0.0.1:12307/ws
[browser-mcp-lite] Token: a1b2c3d4...
[browser-mcp-lite] Waiting for Chrome Extension...
```

The extension auto-connects. Click the toolbar icon to verify the green dot.

### 5. Connect your AI assistant

<details>
<summary><strong>Claude Code</strong></summary>

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://127.0.0.1:12307/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Replace `YOUR_TOKEN_HERE` with the token from `~/.browser-mcp-secrets.json`.

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://127.0.0.1:12307/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor / VS Code</strong></summary>

In Cursor: Settings → MCP → Add Server:
- Name: `browser`
- Type: `http`  
- URL: `http://127.0.0.1:12307/mcp`
- Headers: `Authorization: Bearer YOUR_TOKEN_HERE`

</details>

## Architecture

### Three components

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   AI Assistant   │     │    MCP Server    │     │ Chrome Extension │
│ (any MCP client) │────▶│   (Fastify)      │────▶│   (Manifest V3)  │
│                  │HTTP │ :12307/mcp       │ WS  │                  │
│                  │POST │ Token auth       │     │ tabs, scripting,  │
│                  │◀────│                  │◀────│ activeTab, alarms │
└─────────────────┘     └──────────────────┘     └──────────────────┘
```

**MCP Server** (`server/index.js`, ~150 lines)
- Fastify HTTP server with `@modelcontextprotocol/sdk` Streamable HTTP transport
- Token auth on every request (Bearer token from `~/.browser-mcp-secrets.json`)
- WebSocket endpoint for Chrome Extension communication
- Per-session MCP transport management

**Chrome Extension** (`extension/background.js`, ~215 lines)
- Manifest V3 Service Worker
- WebSocket client with keepalive alarm (survives MV3 Service Worker termination)
- Implements the four tools directly via Chrome APIs
- Auto-reconnects when server restarts

**Accessibility Tree Builder** (`extension/inject/accessibility-tree.js`, ~195 lines)
- Injected into target pages to build a structured DOM representation
- Outputs `ref_*` IDs for each interactive/structural element
- Much more token-efficient than raw HTML — AI can reason about page structure without burning context

### Why accessibility tree instead of raw HTML?

A typical web page has 50-200KB of HTML. An accessibility tree of the same page is 2-10KB — **10-50x smaller**. It strips away styling, scripts, and decorative elements, keeping only what matters: headings, links, buttons, inputs, and their labels.

```
# Raw HTML: ~150KB
<div class="css-1dbjc4n r-1awozwy r-18u37iz r-1h0z5md" data-testid="...">
  <div class="css-901oao r-1fmj7o5 r-37j5jr r-a023e6 r-b88u0q ...">
    <span class="css-901oao ...">Settings</span>
  </div>
</div>

# Accessibility tree: ~50 bytes
[ref_42 link "Settings" href=/settings]
```

### Security design

- **Token auth (both layers)**: MCP endpoint requires `Authorization: Bearer <token>`. WebSocket endpoint requires token handshake on connect. Both use the same token from `~/.browser-mcp-secrets.json`.
- **Minimal permissions**: Only `tabs`, `activeTab`, `scripting`, `alarms`, `storage`. No `debugger`, no `history`, no `cookies`, no `webRequest`.
- **Localhost only**: Server binds to `127.0.0.1`. Not exposed to the network.
- **No network proxying**: The extension never makes HTTP requests using your browser cookies. It only reads DOM and takes screenshots.
- **On-demand**: Start the server when you need it, Ctrl+C when you're done. No daemon, no auto-start.
- **Auditable**: ~500 lines total. Read it all in 10 minutes.

### Privacy considerations

> **Be aware of what you're exposing to your AI assistant.**

- **`list_tabs`** sends all open tab URLs and titles to the AI assistant. If you have sensitive pages open (email, medical, private messages), their URLs and titles will be visible.
- **`screenshot`** captures whatever is on screen, including passwords, personal data, or private content.
- **`screenshot` switches tabs**: Chrome's `captureVisibleTab` API can only capture the active tab. If you screenshot a background tab, it will be briefly switched to the foreground.

**Prompt injection risk**: A malicious web page could contain hidden text that tricks your AI assistant into calling `inject_script` with harmful code on other tabs. Always review tool calls before approving them. Do not auto-approve `inject_script` calls.

**Mitigations**: Only run the server when you need it. Close sensitive tabs before use. Review what your AI assistant can see via `list_tabs` before calling other tools. Never auto-approve tool calls in your MCP client.

### MV3 Service Worker survival

Chrome's Manifest V3 terminates Service Workers after ~30 seconds of inactivity. The extension uses `chrome.alarms` with a 24-second interval to stay alive and reconnect the WebSocket if needed.

## Customization

**Change the port:**

```bash
MCP_PORT=9999 node index.js
```

Update the WebSocket URL in `extension/background.js` line 5 and `extension/popup.html` accordingly.

**Add new tools:**

Edit `server/tools.js` to register new MCP tools, and add the corresponding handler in `extension/background.js`'s `handleToolRequest` switch.

## How it works (for the blog post curious)

1. You start the MCP server (`node index.js`). It listens on `:12307` for HTTP (MCP) and WebSocket (extension).
2. The Chrome Extension's Service Worker connects to `ws://127.0.0.1:12307/ws`.
3. Your AI assistant sends an MCP request (e.g., `read_page`) to `http://127.0.0.1:12307/mcp` with a Bearer token.
4. The server validates the token, translates the MCP call into a WebSocket message, and sends it to the extension.
5. The extension executes the corresponding Chrome API call (e.g., `chrome.scripting.executeScript` to inject the accessibility tree builder).
6. The result flows back: Extension → WebSocket → Server → HTTP response → AI assistant.

The whole round trip takes 100-500ms depending on page complexity.

## Real-world example

See [`examples/web-architectures.md`](examples/web-architectures.md) for a detailed walkthrough of reading data from different web architectures — iframe-based legacy portals, React/Angular SPAs, Vue.js dynamic sites, AJAX-heavy dashboards, and CSP-strict pages.

## Running tests

```bash
node --test tests/server.test.js
```

Tests cover: health check, token auth (missing/wrong/valid), MCP protocol handshake, and session management.

## File structure

```
browser-mcp-lite/
├── server/
│   ├── index.js          # Fastify MCP Server + WebSocket hub
│   ├── tools.js          # Tool schemas + handlers (4 tools)
│   ├── setup.js          # One-time token generator
│   └── package.json
├── extension/
│   ├── manifest.json     # Manifest V3, minimal permissions
│   ├── background.js     # Service Worker: WS client + tool implementations
│   ├── popup.html        # Connection status UI
│   ├── popup.js
│   ├── inject/
│   │   └── accessibility-tree.js  # DOM → structured text
│   └── icons/
├── examples/
│   └── web-architectures.md    # Handling different web architectures
├── tests/
│   └── server.test.js    # Server auth + protocol tests
├── LICENSE
├── README.md             # English
└── README.zh-TW.md       # 繁體中文
```

## Requirements

- Node.js 18+
- Chrome or Chromium-based browser
- Any MCP-compatible AI client

## License

MIT

## Credits

Accessibility tree approach inspired by [anthropics/anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts).
