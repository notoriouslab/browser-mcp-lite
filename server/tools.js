import { z } from 'zod';
import { sendToExtension } from './index.js';

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

  // --- inject_script ---
  server.tool(
    'inject_script',
    'Execute custom JavaScript code in a browser tab and return the result',
    {
      code: z.string().describe('JavaScript code to execute. Must return a JSON-serializable value.'),
      tabId: z.number().optional().describe('Tab ID to inject into. Defaults to the active tab.'),
    },
    async ({ code, tabId }) => {
      const result = await sendToExtension('inject_script', { code, tabId });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
