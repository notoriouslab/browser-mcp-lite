# Real-World Example: Reading Different Web Architectures

[繁體中文](#繁體中文) | [English](#english)

---

<a id="english"></a>

## English

This example shows how browser-mcp-lite handles the most common web architectures you'll encounter in the wild. Each architecture requires a different extraction strategy.

### The scenario

You have several authenticated web apps open in Chrome — a dashboard, an internal tool, a legacy portal. You want your AI assistant to read data from each. The challenge: every site is built differently.

### Step 1: Find the right tabs

**AI calls `list_tabs`:**

```json
[
  { "id": 1234, "url": "https://app.example.com/dashboard", "title": "Dashboard - Overview", "active": false },
  { "id": 1235, "url": "https://react-app.example.com/data", "title": "React App - Data View", "active": false },
  { "id": 1236, "url": "https://legacy.example.com/portal", "title": "Legacy Portal", "active": true },
  { "id": 1237, "url": "https://spa.example.com/overview", "title": "SPA - Overview", "active": false }
]
```

---

### Architecture 1: Server-Rendered + AJAX

Classic server-rendered pages that load additional data via AJAX calls after the initial page load. Common in enterprise dashboards and older web frameworks (ASP.NET, JSP, PHP).

**Strategy: `read_page` — wait for AJAX to complete first.**

**AI calls `read_page` with `tabId: 1234`:**

```
Page: Dashboard - Overview
URL: https://app.example.com/dashboard

[ref_1 navigation "Main menu"]
  [ref_2 link "Home" href=/]
  [ref_3 link "Reports" href=/reports]
[ref_4 main]
  [ref_5 heading level=2 "Summary"]
  [ref_6 table]
    [ref_7 row]
      [ref_8 columnheader "Item"]
      [ref_9 columnheader "Category"]
      [ref_10 columnheader "Value"]
    [ref_11 row]
      [ref_12 cell "Item A"]
      [ref_13 cell "Type 1"]
      [ref_14 cell "45,678"]
    [ref_15 row]
      [ref_16 cell "Item B"]
      [ref_17 cell "Type 2"]
      [ref_18 cell "12,345"]
  [ref_19 heading level=2 "Details"]
  [ref_20 table]
    [ref_21 row]
      [ref_22 columnheader "Name"]
      [ref_23 columnheader "Status"]
      [ref_24 columnheader "Progress"]
    ...
```

A page that would be 150KB of raw HTML becomes 3-5KB of accessibility tree — **10-50x smaller**. The AI gets clean, structured data without burning context window on CSS classes and nested divs.

**Tip**: Navigate to the page in Chrome and wait a few seconds for AJAX to complete before calling `read_page`.

---

### Architecture 2: React / Angular SPA

Modern single-page apps that render everything client-side. The initial HTML is nearly empty; content is built by JavaScript.

**Strategy: `read_page` works great — the accessibility tree captures the rendered state.**

**AI calls `read_page` with `tabId: 1235`:**

```
Page: React App - Data View
URL: https://react-app.example.com/data

[ref_1 banner]
  [ref_2 link "Logo" href=/]
  [ref_3 navigation "Top nav"]
    [ref_4 link "Data" href=/data]
    [ref_5 link "Settings" href=/settings]
[ref_6 main]
  [ref_7 heading level=1 "Data View"]
  [ref_8 textbox "Search..." value=""]
  [ref_9 button "Filter"]
  [ref_10 table]
    [ref_11 row]
      [ref_12 columnheader "Name"]
      [ref_13 columnheader "Updated"]
      [ref_14 columnheader "Value"]
    [ref_15 row]
      [ref_16 cell "Record Alpha"]
      [ref_17 cell "2026-03-28"]
      [ref_18 cell "1,234"]
    ...
```

React/Angular hydrate the DOM before the accessibility tree is built, so `read_page` sees the fully rendered content — no special handling needed.

---

### Architecture 3: iframe-Based Legacy Sites

Older enterprise portals that render the main content inside an `<iframe>`. The accessibility tree only captures the outer frame.

**Strategy: `inject_script` to reach inside the iframe.**

**AI calls `read_page` first — gets almost nothing:**

```
Page: Legacy Portal
URL: https://legacy.example.com/portal

[ref_1 region]
  [ref_2 region "iframe content"]
```

Only the outer shell is visible. Now use `inject_script`:

**AI calls `inject_script` with `tabId: 1236`:**

```javascript
// Reach inside the iframe to extract table data
const iframe = document.querySelector('iframe#main');
const doc = iframe.contentDocument;
const rows = doc.querySelectorAll('table tr');
return Array.from(rows).map(row => {
  const cells = row.querySelectorAll('td');
  return Array.from(cells).map(c => c.textContent.trim());
}).filter(r => r.length > 0);
```

**Returns:**

```json
[
  ["Record 1", "Category A", "23,456"],
  ["Record 2", "Category B", "78,900"],
  ["Record 3", "Category A", "5,432"]
]
```

**Note**: This only works for same-origin iframes. Cross-origin iframes are blocked by the browser's security model — no workaround.

---

### Architecture 4: Vue.js / Dynamic Rendering

Some sites use Vue, Svelte, or other frameworks where the DOM structure is highly dynamic and may not use semantic HTML elements.

**Strategy: `inject_script` with `innerText` — let the AI parse the raw text.**

**AI calls `inject_script` with `tabId: 1237`:**

```javascript
// Dynamic SPA — grab all visible text for AI parsing
const body = document.body.innerText;
return body;
```

**Returns:**

```
Overview
Total: 156,789
Items: 42

Name          Status    Value
Record Alpha  Active    34,567
Record Beta   Pending   12,345
Record Gamma  Active    89,012
...
```

The AI receives plain text and can parse the tabular structure from the visual layout. Less structured than `read_page`, but works on virtually any site.

---

### Architecture 5: CSP-Strict Sites

Some sites set strict Content Security Policy headers that block inline script execution. `inject_script` will fail on these.

**Strategy: Fall back to `read_page` + `screenshot`.**

**AI calls `inject_script` — gets an error:**

```
Error: Script produced no result (CSP may block inline scripts on this page)
```

**Fallback — AI calls `read_page`:**

If the accessibility tree captures enough data, use it. If not:

**AI calls `screenshot`:**

Returns a PNG image. The AI can read text from the screenshot visually and extract the needed information.

---

### Decision flowchart

```
Start
  │
  ▼
Try read_page
  │
  ├─ Got structured data? ──▶ Done ✓
  │
  ├─ Empty / only outer frame? ──▶ Try inject_script
  │                                    │
  │                                    ├─ Got data? ──▶ Done ✓
  │                                    │
  │                                    └─ CSP blocked? ──▶ Use screenshot
  │                                                            │
  │                                                            └─ Done ✓
  │
  └─ Partial data? ──▶ Supplement with inject_script or screenshot
```

### Common challenges

| Architecture | Challenge | Solution |
|-------------|-----------|----------|
| **Server-rendered + AJAX** | Data loads after initial render | Wait for page load, then `read_page` |
| **React / Angular SPA** | Content rendered client-side | `read_page` works well — captures rendered state |
| **iframe-based** | Main content inside `<iframe>` | `inject_script` to access `iframe.contentDocument` |
| **Vue.js / dynamic** | Non-semantic DOM structure | `inject_script` with `document.body.innerText` |
| **Session timeout** | Page redirects to login | Re-login in browser, then retry |
| **CSP-strict** | `inject_script` blocked | Fall back to `read_page` + `screenshot` |

### Tips

1. **Log in first**: browser-mcp-lite reads your existing sessions. It doesn't automate login — that's intentional (security). You handle authentication, the AI handles data extraction.
2. **Fallback chain**: `read_page` → `inject_script` → `screenshot`. Start with the most structured option, fall back as needed.
3. **Use `screenshot` for verification**: After extracting data, take a screenshot to visually confirm accuracy.
4. **Combine tools**: Use `list_tabs` to find tabs, `read_page` for structure, `inject_script` for tricky extraction, `screenshot` for visual proof.

---

<a id="繁體中文"></a>

## 繁體中文

這個範例展示 browser-mcp-lite 如何處理實務中最常見的幾種網頁架構。每種架構需要不同的擷取策略。

### 情境

你在 Chrome 裡開了幾個已登入的 web app — 儀表板、內部工具、舊版入口網站。你想讓 AI 助手從每個站讀取資料。挑戰在於：每個站的技術架構都不一樣。

### 第一步：找到對的分頁

**AI 呼叫 `list_tabs`：**

```json
[
  { "id": 1234, "url": "https://app.example.com/dashboard", "title": "Dashboard - Overview", "active": false },
  { "id": 1235, "url": "https://react-app.example.com/data", "title": "React App - Data View", "active": false },
  { "id": 1236, "url": "https://legacy.example.com/portal", "title": "Legacy Portal", "active": true },
  { "id": 1237, "url": "https://spa.example.com/overview", "title": "SPA - Overview", "active": false }
]
```

---

### 架構 1：伺服器渲染 + AJAX

經典伺服器渲染頁面，初始載入後再透過 AJAX 載入額外資料。常見於企業儀表板和老一代 web 框架（ASP.NET、JSP、PHP）。

**策略：`read_page` — 先等 AJAX 完成。**

**AI 呼叫 `read_page`，`tabId: 1234`：**

```
Page: Dashboard - Overview
URL: https://app.example.com/dashboard

[ref_1 navigation "Main menu"]
  [ref_2 link "Home" href=/]
  [ref_3 link "Reports" href=/reports]
[ref_4 main]
  [ref_5 heading level=2 "Summary"]
  [ref_6 table]
    [ref_7 row]
      [ref_8 columnheader "Item"]
      [ref_9 columnheader "Category"]
      [ref_10 columnheader "Value"]
    [ref_11 row]
      [ref_12 cell "Item A"]
      [ref_13 cell "Type 1"]
      [ref_14 cell "45,678"]
    ...
```

一般 150KB 的原始 HTML，accessibility tree 只有 3-5KB — **小 10-50 倍**。AI 拿到乾淨的結構化資料，不用浪費 context window 在 CSS class 和巢狀 div 上。

**提示**：先在 Chrome 瀏覽到該頁面，等幾秒讓 AJAX 完成再呼叫 `read_page`。

---

### 架構 2：React / Angular SPA

現代單頁應用，所有內容在客戶端渲染。初始 HTML 幾乎是空的，內容由 JavaScript 建構。

**策略：`read_page` 效果很好 — accessibility tree 能捕捉渲染後的狀態。**

React/Angular 在 accessibility tree 建構之前就已經把 DOM hydrate 完成，所以 `read_page` 看到的是完整的渲染結果 — 不需要特殊處理。

---

### 架構 3：iframe 架構的老系統

老式企業入口網站把主要內容放在 `<iframe>` 裡。Accessibility tree 只能捕捉外層框架。

**策略：`inject_script` 深入 iframe。**

先呼叫 `read_page` — 幾乎什麼都沒有：

```
Page: Legacy Portal
URL: https://legacy.example.com/portal

[ref_1 region]
  [ref_2 region "iframe content"]
```

改用 `inject_script`：

```javascript
// 進入 iframe 擷取表格資料
const iframe = document.querySelector('iframe#main');
const doc = iframe.contentDocument;
const rows = doc.querySelectorAll('table tr');
return Array.from(rows).map(row => {
  const cells = row.querySelectorAll('td');
  return Array.from(cells).map(c => c.textContent.trim());
}).filter(r => r.length > 0);
```

**回傳：**

```json
[
  ["Record 1", "Category A", "23,456"],
  ["Record 2", "Category B", "78,900"]
]
```

**注意**：只適用於同源 iframe。跨域 iframe 受瀏覽器安全模型限制，無法存取。

---

### 架構 4：Vue.js / 動態渲染

有些網站用 Vue、Svelte 或其他框架，DOM 結構高度動態，可能不使用語義化的 HTML 元素。

**策略：`inject_script` 配 `innerText` — 讓 AI 解析原始文字。**

```javascript
// 動態 SPA — 抓取所有可見文字讓 AI 解析
const body = document.body.innerText;
return body;
```

AI 收到純文字後可以從視覺排版解析出表格結構。結構化程度不如 `read_page`，但幾乎在任何網站都能用。

---

### 架構 5：CSP 嚴格的網站

有些網站設了嚴格的 Content Security Policy header，阻擋行內腳本執行。`inject_script` 會失敗。

**策略：退回 `read_page` + `screenshot`。**

如果 accessibility tree 能捕捉足夠資料就用它。如果不行，截圖讓 AI 從圖片中讀取文字。

---

### 決策流程

```
開始
  │
  ▼
嘗試 read_page
  │
  ├─ 拿到結構化資料？ ──▶ 完成 ✓
  │
  ├─ 空的 / 只有外框？ ──▶ 嘗試 inject_script
  │                            │
  │                            ├─ 拿到資料？ ──▶ 完成 ✓
  │                            │
  │                            └─ CSP 擋住？ ──▶ 用 screenshot
  │                                                  │
  │                                                  └─ 完成 ✓
  │
  └─ 部分資料？ ──▶ 用 inject_script 或 screenshot 補充
```

### 常見挑戰

| 架構 | 挑戰 | 解法 |
|------|------|------|
| **伺服器渲染 + AJAX** | 資料在初始渲染後載入 | 等頁面載入完，再 `read_page` |
| **React / Angular SPA** | 內容在客戶端渲染 | `read_page` 效果好 — 捕捉渲染後的狀態 |
| **iframe 架構** | 主要內容在 `<iframe>` 裡 | `inject_script` 存取 `iframe.contentDocument` |
| **Vue.js / 動態渲染** | 非語義化的 DOM 結構 | `inject_script` 配 `document.body.innerText` |
| **Session 逾時** | 頁面跳轉到登入頁 | 在瀏覽器重新登入，再重試 |
| **CSP 嚴格** | `inject_script` 被擋 | 退回 `read_page` + `screenshot` |

### 小技巧

1. **先登入**：browser-mcp-lite 讀取你現有的 session，不自動化登入 — 這是刻意的（安全考量）。你負責認證，AI 負責擷取資料。
2. **退路鏈**：`read_page` → `inject_script` → `screenshot`。從最有結構的選項開始，需要時再往下退。
3. **用 `screenshot` 驗證**：擷取資料後截圖確認正確性。
4. **組合工具**：用 `list_tabs` 找分頁、`read_page` 讀結構、`inject_script` 處理棘手擷取、`screenshot` 視覺存證。
