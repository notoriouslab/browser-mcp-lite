import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const secretsPath = join(homedir(), '.browser-mcp-secrets.json');

let secrets = {};
try {
  secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
} catch {
  // File doesn't exist or invalid JSON — start fresh
}

if (secrets.token) {
  console.log('Token already exists in', secretsPath);
  console.log('Token (first 8 chars):', secrets.token.slice(0, 8) + '...');
  process.exit(0);
}

const token = randomBytes(32).toString('hex');
secrets.token = token;

writeFileSync(secretsPath, JSON.stringify(secrets, null, 2) + '\n', 'utf8');
chmodSync(secretsPath, 0o600);

console.log('Generated token and saved to', secretsPath);
console.log('Token (first 8 chars):', token.slice(0, 8) + '...');
console.log('File permissions set to 600 (owner read/write only)');
