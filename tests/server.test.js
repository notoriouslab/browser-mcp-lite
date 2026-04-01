import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const PORT = 12399; // Use non-default port for tests
const BASE = `http://127.0.0.1:${PORT}`;
const SECRETS_PATH = join(homedir(), '.browser-mcp-secrets.json');

let originalSecrets = null;
let serverProcess = null;
let TOKEN = null;

// --- Helper: read or create test token ---
function ensureToken() {
  try {
    const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
    TOKEN = secrets.token;
  } catch {
    // No secrets file — create one for testing
    TOKEN = 'a'.repeat(64);
    writeFileSync(SECRETS_PATH, JSON.stringify({ token: TOKEN }, null, 2), 'utf8');
  }
  if (!TOKEN) {
    TOKEN = 'a'.repeat(64);
    const secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
    secrets.token = TOKEN;
    writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2), 'utf8');
  }
}

// --- Helper: start server as child process ---
async function startServer() {
  const { spawn } = await import('child_process');
  const serverDir = join(import.meta.dirname, '..', 'server');

  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['index.js'], {
      cwd: serverDir,
      env: { ...process.env, MCP_PORT: String(PORT) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Server start timeout'));
    }, 10000);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('MCP server:') && !started) {
        started = true;
        clearTimeout(timeout);
        resolve(proc);
      }
    });

    proc.stderr.on('data', (data) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server error: ${data.toString()}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('MCP Server', () => {
  before(async () => {
    // Save original secrets if they exist
    try {
      originalSecrets = readFileSync(SECRETS_PATH, 'utf8');
    } catch { /* no existing file */ }

    ensureToken();
    serverProcess = await startServer();
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
    // Restore original secrets
    if (originalSecrets !== null) {
      writeFileSync(SECRETS_PATH, originalSecrets, 'utf8');
    }
  });

  // --- Health check ---

  it('GET /ping returns ok without auth', async () => {
    const res = await fetch(`${BASE}/ping`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.extension, false); // No extension connected in tests
  });

  // --- Auth tests ---

  it('POST /mcp without token returns 401', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    assert.equal(res.status, 401);
  });

  it('POST /mcp with wrong token returns 401', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    assert.equal(res.status, 401);
  });

  it('POST /mcp with valid token reaches MCP layer', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    });
    // Should get 200 with MCP initialize response
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('browser-mcp-lite'), `Expected server name in response, got: ${text.slice(0, 200)}`);
  });

  // --- Session tests ---

  it('GET /mcp without session returns 400', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
  });

  it('DELETE /mcp without session returns 400', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 400);
  });
});
