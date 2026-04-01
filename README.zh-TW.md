# browser-mcp-lite

繁體中文 | [English](README.md)

**讓你的 AI 助手看見你的真實瀏覽器 — 只要 ~500 行程式碼。**

一個精簡、有認證的 [MCP](https://modelcontextprotocol.io/) 伺服器，讓 AI 助手讀取頁面、截圖、在你的 Chrome 瀏覽器中執行腳本 — 保留你現有的登入狀態。

```
AI 助手 ──HTTP POST──▶ MCP Server (:12307) ──WebSocket──▶ Chrome Extension ──▶ DOM
                        (token 認證)          (ws://)       (最小權限)
```

## 為什麼要自建？

現有的瀏覽器 MCP 方案不是太肥就是不夠用：

- **太重** — [mcp-chrome](https://github.com/nicholasoxford/mcp-chrome) 要求 `debugger`、`history`、`<all_urls>` 權限，程式碼 minified 無法審計
- **只有 Headless** — [Playwright MCP](https://github.com/nicousm/playwright-mcp-server) 開新瀏覽器，看不到你已登入的頁面
- **依賴雲端** — Browserbase 等把你的頁面送到第三方伺服器

browser-mcp-lite 走不同的路：

| | mcp-chrome | Playwright MCP | **browser-mcp-lite** |
|---|---|---|---|
| 讀真實瀏覽器 | Yes | No（headless） | **Yes** |
| MCP 端點認證 | No | No | **Token auth** |
| Extension 權限 | 8+ | N/A | **5（最小）** |
| 可審計的程式碼 | Minified | Yes | **~500 行** |
| 登入狀態 | Yes | No | **Yes** |

## 四個工具

| Tool | 說明 | 回傳 |
|------|------|------|
| `list_tabs` | 列出所有開啟的分頁 | `[{id, url, title, active}]` |
| `read_page` | 讀取頁面的 accessibility tree | 結構化文字（省 token） |
| `screenshot` | 截取可見區域 | Base64 PNG 圖片 |
| `inject_script` | 在指定分頁執行自訂 JS | 腳本回傳值 |

## 快速開始

### 1. Clone 並安裝

```bash
git clone https://github.com/notoriouslab/browser-mcp-lite.git
cd browser-mcp-lite/server
npm install
```

### 2. 產生認證 token

```bash
node setup.js
```

會建立 `~/.browser-mcp-secrets.json`，內含隨機 64 字元 hex token。檔案權限設為 `600`（僅擁有者可讀寫）。

### 3. 載入 Chrome Extension

1. 開啟 `chrome://extensions/`
2. 啟用右上角的**開發人員模式**
3. 點**載入未封裝項目** → 選擇 `extension/` 資料夾
4. 點工具列的 Browser MCP Lite 圖示
5. 在 **Auth Token** 欄位貼上 `~/.browser-mcp-secrets.json` 裡的 token
6. 點 **Connect**

### 4. 啟動伺服器

```bash
node index.js
```

```
[browser-mcp-lite] MCP server: http://127.0.0.1:12307/mcp
[browser-mcp-lite] WebSocket:  ws://127.0.0.1:12307/ws
[browser-mcp-lite] Token: a1b2c3d4...
[browser-mcp-lite] Waiting for Chrome Extension...
```

Extension 會自動連線。點工具列圖示確認綠燈亮起。

### 5. 連接你的 AI 助手

<details>
<summary><strong>Claude Code</strong></summary>

在專案目錄新增 `.mcp.json`：

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://127.0.0.1:12307/mcp",
      "headers": {
        "Authorization": "Bearer 你的TOKEN"
      }
    }
  }
}
```

把 `你的TOKEN` 換成 `~/.browser-mcp-secrets.json` 裡的 token。

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

加到 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "browser": {
      "type": "http",
      "url": "http://127.0.0.1:12307/mcp",
      "headers": {
        "Authorization": "Bearer 你的TOKEN"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor / VS Code</strong></summary>

Cursor：Settings → MCP → Add Server：
- Name: `browser`
- Type: `http`
- URL: `http://127.0.0.1:12307/mcp`
- Headers: `Authorization: Bearer 你的TOKEN`

</details>

## 架構

### 三個組件

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│    AI 助手       │     │    MCP Server    │     │ Chrome Extension │
│（任何 MCP 客戶端）│────▶│   (Fastify)      │────▶│  (Manifest V3)   │
│                  │HTTP │ :12307/mcp       │ WS  │                  │
│                  │POST │ Token 認證        │     │ tabs, scripting, │
│                  │◀────│                  │◀────│ activeTab, alarms│
└─────────────────┘     └──────────────────┘     └──────────────────┘
```

**MCP Server**（`server/index.js`，~150 行）
- Fastify HTTP 伺服器 + `@modelcontextprotocol/sdk` Streamable HTTP transport
- 每個請求都驗證 Bearer token
- WebSocket 端點與 Chrome Extension 通訊
- 每個 session 獨立管理 MCP transport

**Chrome Extension**（`extension/background.js`，~215 行）
- Manifest V3 Service Worker
- WebSocket client + keepalive alarm（對抗 MV3 Service Worker 30 秒超時）
- 直接用 Chrome API 實作四個工具
- Server 重啟時自動重連

**Accessibility Tree Builder**（`extension/inject/accessibility-tree.js`，~195 行）
- 注入目標頁面，建構結構化的 DOM 表示
- 每個可互動/結構性元素標記 `ref_*` ID
- 比原始 HTML 省 10-50 倍 token — AI 能更有效率地理解頁面

### 為什麼用 Accessibility Tree 而不是原始 HTML？

一般網頁有 50-200KB 的 HTML。同一頁面的 accessibility tree 只有 2-10KB — **小 10-50 倍**。它去掉了樣式、腳本和裝飾性元素，只保留重要的東西：標題、連結、按鈕、輸入框和它們的標籤。

```
# 原始 HTML: ~150KB
<div class="css-1dbjc4n r-1awozwy r-18u37iz r-1h0z5md" data-testid="...">
  <div class="css-901oao r-1fmj7o5 r-37j5jr r-a023e6 r-b88u0q ...">
    <span class="css-901oao ...">Settings</span>
  </div>
</div>

# Accessibility tree: ~50 bytes
[ref_42 link "Settings" href=/settings]
```

### 安全設計

- **雙層 Token 認證**：MCP 端點要求 `Authorization: Bearer <token>`；WebSocket 端點要求連線時 token 握手。兩者使用同一個 `~/.browser-mcp-secrets.json` 裡的 token
- **最小權限**：只要 `tabs`、`activeTab`、`scripting`、`alarms`、`storage`。不用 `debugger`、`history`、`cookies`、`webRequest`
- **僅限本機**：Server 綁定 `127.0.0.1`，不對外開放
- **不代理網路請求**：Extension 絕不會用你的瀏覽器 cookie 發 HTTP 請求，只讀 DOM 和截圖
- **按需啟動**：需要時 `node index.js`，用完 `Ctrl+C`。沒有 daemon、不開機自啟
- **可審計**：~500 行，10 分鐘讀完

### 隱私注意事項

> **請留意你暴露給 AI 助手的內容。**

- **`list_tabs`** 會把所有開啟分頁的 URL 和標題傳給 AI 助手。如果你開著敏感頁面（email、醫療、私人訊息），它們的 URL 和標題都會被看到。
- **`screenshot`** 會擷取畫面上的一切，包括密碼、個人資料或私人內容。
- **`screenshot` 會切換分頁**：Chrome 的 `captureVisibleTab` API 只能擷取目前顯示的分頁。如果你截圖一個背景分頁，它會短暫切到前景。

**Prompt injection 風險**：惡意網頁可能包含隱藏文字，誘導 AI 助手在其他分頁呼叫 `inject_script` 執行有害程式碼。請務必在核准前檢視工具呼叫內容。不要對 `inject_script` 設定自動核准。

**建議**：只在需要時啟動 server。使用前關閉敏感分頁。先用 `list_tabs` 檢查 AI 助手能看到什麼，再呼叫其他工具。MCP client 裡不要設定自動核准工具呼叫。

### MV3 Service Worker 存活機制

Chrome Manifest V3 會在 ~30 秒無活動後終止 Service Worker。Extension 用 `chrome.alarms`（24 秒間隔）保持存活並在需要時重連 WebSocket。

## 自訂

**換 port：**

```bash
MCP_PORT=9999 node index.js
```

記得同步更新 `extension/background.js` 第 5 行和 `extension/popup.html` 裡的 WebSocket URL。

**新增工具：**

在 `server/tools.js` 註冊新的 MCP tool，然後在 `extension/background.js` 的 `handleToolRequest` switch 裡加對應的 handler。

## 運作流程

1. 啟動 MCP server（`node index.js`）。監聽 `:12307` 的 HTTP（MCP）和 WebSocket（extension）。
2. Chrome Extension 的 Service Worker 連到 `ws://127.0.0.1:12307/ws`。
3. AI 助手送 MCP 請求（例如 `read_page`）到 `http://127.0.0.1:12307/mcp`，帶 Bearer token。
4. Server 驗證 token，把 MCP 呼叫轉成 WebSocket 訊息送給 extension。
5. Extension 執行對應的 Chrome API（例如 `chrome.scripting.executeScript` 注入 accessibility tree builder）。
6. 結果回傳：Extension → WebSocket → Server → HTTP response → AI 助手。

整個來回 100-500ms，取決於頁面複雜度。

## 實戰範例

參見 [`examples/web-architectures.md`](examples/web-architectures.md)，展示如何處理不同的網頁架構 — iframe 老系統、React/Angular SPA、Vue.js 動態渲染、AJAX 儀表板、CSP 嚴格網站。

## 檔案結構

```
browser-mcp-lite/
├── server/
│   ├── index.js          # Fastify MCP Server + WebSocket hub
│   ├── tools.js          # 工具定義 + handler（4 個工具）
│   ├── setup.js          # 一次性 token 產生器
│   └── package.json
├── extension/
│   ├── manifest.json     # Manifest V3，最小權限
│   ├── background.js     # Service Worker: WS client + 工具實作
│   ├── popup.html        # 連線狀態 UI
│   ├── popup.js
│   ├── inject/
│   │   └── accessibility-tree.js  # DOM → 結構化文字
│   └── icons/
├── examples/             # 實戰範例
├── tests/                # 測試
├── LICENSE
├── README.md             # English
└── README.zh-TW.md       # 繁體中文
```

## 需求

- Node.js 18+
- Chrome 或 Chromium 系瀏覽器
- 任何支援 MCP 的 AI 客戶端

## 授權

MIT

## 致謝

Accessibility tree 的做法參考了 [anthropics/anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts)。
