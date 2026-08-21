import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ANTHROPIC_API_KEY must only ever be read server-side (tools/business-agent-server.ts,
// api/business-agent.ts) or by the local .env loader — never by anything that ships to
// a browser. This greps the actual frontend source trees rather than trusting review;
// a future edit that accidentally threads the key into a widget/app env var would fail
// this test immediately instead of silently shipping.
describe('ANTHROPIC_API_KEY never reaches the browser', () => {
  it('is not referenced anywhere under the widget or any framework host adapter/app source', () => {
    const frontendDirs = [
      'libs/business-agent-widget',
      'libs/business-agent-react',
      'libs/business-agent-angular',
      'libs/business-agent-vue',
      'apps',
    ];
    const hits = execSync(`grep -rl "ANTHROPIC_API_KEY" ${frontendDirs.join(' ')} 2>/dev/null || true`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    expect(hits).toBe('');
  });
});
