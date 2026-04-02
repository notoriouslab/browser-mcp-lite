import { z } from 'zod';
import { sendToExtension } from './index.js';

// --- inject_script risk detection ---
const RISK_PATTERNS = [
  { pattern: /\b(fetch|XMLHttpRequest|sendBeacon|navigator\.sendBeacon)\s*\(/i, label: 'network request' },
  { pattern: /document\.cookie/i, label: 'cookie access' },
  { pattern: /localStorage|sessionStorage/i, label: 'storage access' },
  { pattern: /indexedDB/i, label: 'IndexedDB access' },
  { pattern: /new\s+WebSocket\s*\(/i, label: 'WebSocket connection' },
  { pattern: /new\s+EventSource\s*\(/i, label: 'EventSource connection' },
  { pattern: /window\.open\s*\(/i, label: 'window.open' },
  { pattern: /document\.write/i, label: 'document.write' },
];

function detectRisks(code) {
  return RISK_PATTERNS.filter(r => r.pattern.test(code)).map(r => r.label);
}

export function registerTools(server) {

  // --- list_tabs ---
  server.tool('list_tabs', 'List all open browser tabs with their URLs and titles', async () => {
    const tabs = await sendToExtension('list_tabs');
    return { content: [{ type: 'text', text: JSON.stringify(tabs, null, 2) }] };
  });

  // --- read_page ---
  // URL restriction is enforced by the extension (single source of truth).
  server.tool(
    'read_page',
    'Read the DOM structure of a browser tab as an accessibility tree',
    { tabId: z.number().optional().describe('Tab ID to read. Defaults to the active tab.') },
    async ({ tabId }) => {
      const result = await sendToExtension('read_page', { tabId });
      return { content: [{ type: 'text', text: result }] };
    }
  );

  // --- screenshot ---
  server.tool(
    'screenshot',
    'Capture a screenshot of the visible area of a browser tab',
    { tabId: z.number().optional().describe('Tab ID to capture. Defaults to the active tab.') },
    async ({ tabId }) => {
      const dataUrl = await sendToExtension('screenshot', { tabId });
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }] };
    }
  );

  // --- focus_tab ---
  server.tool(
    'focus_tab',
    'Switch to a specific browser tab (bring it to the foreground)',
    { tabId: z.number().describe('Tab ID to focus.') },
    async ({ tabId }) => {
      await sendToExtension('focus_tab', { tabId });
      return { content: [{ type: 'text', text: `Focused tab ${tabId}` }] };
    }
  );

  // --- inject_script ---
  server.tool(
    'inject_script',
    'Execute custom JavaScript code in a browser tab and return the result',
    {
      code: z.string().max(10000).describe('JavaScript code to execute (max 10,000 chars). Must return a JSON-serializable value.'),
      tabId: z.number().optional().describe('Tab ID to inject into. Defaults to the active tab.'),
    },
    async ({ code, tabId }) => {
      const risks = detectRisks(code);
      const result = await sendToExtension('inject_script', { code, tabId });
      const output = JSON.stringify(result, null, 2);
      if (risks.length > 0) {
        const warning = `\u26A0 RISK: This script uses ${risks.join(', ')}. Verify this was intentional.`;
        return { content: [{ type: 'text', text: `${warning}\n\n${output}` }] };
      }
      return { content: [{ type: 'text', text: output }] };
    }
  );
}
