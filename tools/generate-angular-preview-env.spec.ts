import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercises the real script as a child process (spawnSync), not by importing it —
// the script runs its validate-or-generate logic at module top level, including a
// real process.exit(1) on the failure path, which would kill the test worker if
// imported directly. This is also exactly how it's actually invoked (`node
// tools/generate-angular-preview-env.mjs`, see package.json's build:angular:preview),
// so the test exercises the real invocation contract, not an internal seam.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'tools/generate-angular-preview-env.mjs');
const OUTPUT_PATH = resolve(
  REPO_ROOT,
  'apps/users-portal-angular/src/environments/environment.preview.ts'
);

const VALID_API_URL = 'https://example-preview.up.railway.app/api/orders';
const VALID_WS_URL = 'wss://example-preview.up.railway.app/orders';
const VALID_REMOTE_URL = 'https://example-preview.vercel.app/remoteEntry.js';

function buildEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['VITE_ORDERS_API_URL'];
  delete env['VITE_ORDERS_WS_URL'];
  delete env['VITE_REACT_REMOTE_URL'];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function run(overrides: Record<string, string | undefined>) {
  return spawnSync('node', [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    env: buildEnv(overrides),
    encoding: 'utf8',
  });
}

afterEach(() => {
  rmSync(OUTPUT_PATH, { force: true });
});

describe('generate-angular-preview-env (all three Preview vars present)', () => {
  it('exits 0 and writes environment.preview.ts with the exact supplied values', () => {
    const result = run({
      VITE_ORDERS_API_URL: VALID_API_URL,
      VITE_ORDERS_WS_URL: VALID_WS_URL,
      VITE_REACT_REMOTE_URL: VALID_REMOTE_URL,
    });

    expect(result.status).toBe(0);
    expect(existsSync(OUTPUT_PATH)).toBe(true);

    const contents = readFileSync(OUTPUT_PATH, 'utf8');
    expect(contents).toContain(`ordersApiUrl: ${JSON.stringify(VALID_API_URL)}`);
    expect(contents).toContain(`ordersWsUrl: ${JSON.stringify(VALID_WS_URL)}`);
    expect(contents).toContain(`reactRemoteUrl: ${JSON.stringify(VALID_REMOTE_URL)}`);
  });

  it('trims surrounding whitespace from otherwise-valid values before writing', () => {
    const result = run({
      VITE_ORDERS_API_URL: `  ${VALID_API_URL}  `,
      VITE_ORDERS_WS_URL: `\t${VALID_WS_URL}\t`,
      VITE_REACT_REMOTE_URL: `\n${VALID_REMOTE_URL}\n`,
    });

    expect(result.status).toBe(0);
    const contents = readFileSync(OUTPUT_PATH, 'utf8');
    expect(contents).toContain(`ordersApiUrl: ${JSON.stringify(VALID_API_URL)}`);
    expect(contents).toContain(`ordersWsUrl: ${JSON.stringify(VALID_WS_URL)}`);
    expect(contents).toContain(`reactRemoteUrl: ${JSON.stringify(VALID_REMOTE_URL)}`);
  });
});

describe('generate-angular-preview-env (each required variable missing)', () => {
  it('fails when VITE_ORDERS_API_URL is missing', () => {
    const result = run({ VITE_ORDERS_WS_URL: VALID_WS_URL, VITE_REACT_REMOTE_URL: VALID_REMOTE_URL });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_ORDERS_API_URL');
    expect(existsSync(OUTPUT_PATH)).toBe(false);
  });

  it('fails when VITE_ORDERS_WS_URL is missing', () => {
    const result = run({ VITE_ORDERS_API_URL: VALID_API_URL, VITE_REACT_REMOTE_URL: VALID_REMOTE_URL });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_ORDERS_WS_URL');
    expect(existsSync(OUTPUT_PATH)).toBe(false);
  });

  it('fails when VITE_REACT_REMOTE_URL is missing', () => {
    const result = run({ VITE_ORDERS_API_URL: VALID_API_URL, VITE_ORDERS_WS_URL: VALID_WS_URL });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_REACT_REMOTE_URL');
    expect(existsSync(OUTPUT_PATH)).toBe(false);
  });

  it('fails when all three variables are missing', () => {
    const result = run({});
    expect(result.status).toBe(1);
    expect(existsSync(OUTPUT_PATH)).toBe(false);
  });
});

describe('generate-angular-preview-env (whitespace-only values)', () => {
  it('fails when VITE_ORDERS_API_URL is whitespace-only', () => {
    const result = run({
      VITE_ORDERS_API_URL: '   ',
      VITE_ORDERS_WS_URL: VALID_WS_URL,
      VITE_REACT_REMOTE_URL: VALID_REMOTE_URL,
    });
    expect(result.status).toBe(1);
    expect(existsSync(OUTPUT_PATH)).toBe(false);
  });

  it('fails when VITE_ORDERS_WS_URL is whitespace-only', () => {
    const result = run({
      VITE_ORDERS_API_URL: VALID_API_URL,
      VITE_ORDERS_WS_URL: '\t\t',
      VITE_REACT_REMOTE_URL: VALID_REMOTE_URL,
    });
    expect(result.status).toBe(1);
    expect(existsSync(OUTPUT_PATH)).toBe(false);
  });

  it('fails when VITE_REACT_REMOTE_URL is whitespace-only', () => {
    const result = run({
      VITE_ORDERS_API_URL: VALID_API_URL,
      VITE_ORDERS_WS_URL: VALID_WS_URL,
      VITE_REACT_REMOTE_URL: '\n\n',
    });
    expect(result.status).toBe(1);
    expect(existsSync(OUTPUT_PATH)).toBe(false);
  });

  it('fails when all three variables are whitespace-only', () => {
    const result = run({
      VITE_ORDERS_API_URL: ' ',
      VITE_ORDERS_WS_URL: ' ',
      VITE_REACT_REMOTE_URL: ' ',
    });
    expect(result.status).toBe(1);
    expect(existsSync(OUTPUT_PATH)).toBe(false);
  });
});
