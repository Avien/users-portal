import Anthropic from '@anthropic-ai/sdk';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin } from 'node:process';
import { formatReviewOutput } from './pr-review-format.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// A single-call Claude reviewer that checks a pull-request diff for ARCHITECTURE
// DRIFT against this repo's own rules. The same CLAUDE.md that governs Claude Code
// here is loaded verbatim as the system prompt, so the bot enforces the exact
// conventions the project already documents — layer boundaries, framework
// isolation, facade/altitude, the shared-contract discipline, state placement,
// and naming. It writes a GitHub-flavored-markdown review to stdout.
//
//   # against a base branch (default origin/main)
//   ANTHROPIC_API_KEY=... node tools/pr-review-agent.mjs --base main
//   # or feed a precomputed diff
//   git diff main...HEAD | ANTHROPIC_API_KEY=... node tools/pr-review-agent.mjs --stdin
//
// Diagnostics go to stderr; only the review goes to stdout, so a CI job can do
//   node tools/pr-review-agent.mjs --base origin/main > review.md
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_DIFF_CHARS = 300_000; // keep the request well inside the context window
const MARKER = '<!-- architecture-review-bot -->';

const args = process.argv.slice(2);
const useStdin = args.includes('--stdin');
const baseIdx = args.indexOf('--base');
const BASE = baseIdx !== -1 ? args[baseIdx + 1] : 'origin/main';

// Load a root .env (dependency-free) so `npm run pr-review` works locally.
// A real environment variable always wins over a .env entry.
const loadEnv = () => {
  const envPath = resolve(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
};
loadEnv();

// Read after loadEnv() so a .env-file entry (not just a real env var) can override it.
const MODEL = process.env['PR_REVIEW_MODEL'] || 'claude-opus-4-8';

if (!process.env['ANTHROPIC_API_KEY']) {
  console.error('Set ANTHROPIC_API_KEY in your environment or a .env file at the repo root.');
  process.exit(1);
}

// ── Get the diff ─────────────────────────────────────────────────────────────

const readStdin = async () => {
  let data = '';
  for await (const chunk of stdin) data += chunk;
  return data;
};

const gitDiff = () => {
  // Three-dot: diff from the merge-base, i.e. what the PR actually introduces.
  const res = spawnSync('git', ['diff', '--no-color', `${BASE}...HEAD`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(`git diff against "${BASE}" failed:\n${res.stderr ?? ''}`);
    process.exit(1);
  }
  return res.stdout ?? '';
};

let diff = (useStdin ? await readStdin() : gitDiff()).trim();

if (!diff) {
  process.stdout.write(`${MARKER}\n✅ No changes to review.\n`);
  process.exit(0);
}

let truncated = false;
if (diff.length > MAX_DIFF_CHARS) {
  diff = diff.slice(0, MAX_DIFF_CHARS);
  truncated = true;
}
console.error(`Reviewing ${diff.length} chars of diff${truncated ? ' (truncated)' : ''}…`);

// ── Prompt: CLAUDE.md (verbatim) + the review rubric ─────────────────────────

const claudeMd = (() => {
  const p = resolve(REPO_ROOT, 'CLAUDE.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
})();

const REVIEW_INSTRUCTIONS = `You are an automated architecture reviewer for this Nx monorepo. The project
rules above (from CLAUDE.md) are AUTHORITATIVE. You are given a pull-request diff. Review it ONLY
for architecture drift against those rules — not general code style or taste.

Flag genuine violations of:
- **Module boundaries** (Nx \`type:\` / \`framework:\` tags): a \`ui\` or \`data-access\` lib importing
  "upward"; \`feature\` importing another \`feature\`; cross-framework imports (Angular ↔ React ↔ Vue);
  an app reaching past \`feature\`/\`data-access\`.
- **Layer / altitude**: business logic — filtering, sorting, deriving, mapping — living in a component
  or in JSX/template instead of the facade; a dumb presentational component importing a store, query
  client, or router; view-derived state that belongs in the ViewModel.
- **Contract discipline**: domain types redefined in app code instead of imported from the shared
  \`@portal/*/utils\` lib; a facade not returning the shared \`Vm & IFacadeInteractions\` shape.
- **State placement**: a store (Zustand/Pinia) holding server state or route-derivable state;
  a WebSocket or other singleton created inside a route-bound facade instead of at the app root.
- **Naming conventions**: files kebab-case; component exports PascalCase; hook exports \`use\`-prefixed
  camelCase; shared interfaces \`I\`-prefixed; facade files \`use-[name]-facade.ts\`.

Be **LOW NOISE**. This comment is posted on every push, so only report issues you are genuinely
confident are real architecture drift introduced by this diff. Do NOT report formatting, subjective
preferences, hypothetical concerns, or anything outside the rules above. A noisy bot gets muted.

Output GitHub-flavored markdown suitable for a PR comment, and nothing else:
- Open with a one-line verdict: \`✅ No architecture drift found.\` or \`⚠️ N issue(s) found:\`.
- Then one bullet per finding: **\`path:line\`** — one sentence on what's wrong and which rule it breaks.
- Order most-severe first. Be concise. No preamble, no summary of the diff, no praise.`;

const SYSTEM_PROMPT = claudeMd
  ? `${claudeMd}\n\n---\n\n${REVIEW_INSTRUCTIONS}`
  : REVIEW_INSTRUCTIONS;

// ── Single call (streamed to avoid HTTP timeouts on large diffs) ─────────────

const client = new Anthropic();

const message = await client.messages
  .stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Review this pull-request diff${truncated ? ' (truncated to the first ' + MAX_DIFF_CHARS + ' chars)' : ''}:\n\n<diff>\n${diff}\n</diff>`,
      },
    ],
  })
  .finalMessage();

const review = message.content
  .filter((b) => b.type === 'text')
  .map((b) => b.text)
  .join('\n')
  .trim();

// Required-check semantics: exit non-zero when the rubric's own verdict line
// signals drift, so CI fails the job and branch protection can block the merge.
// Also non-zero — unconditionally — when the diff was truncated: the model only
// saw part of the PR, so its verdict (even a clean one) can't gate the merge.
const { output, exitCode } = formatReviewOutput({ review, truncated, maxDiffChars: MAX_DIFF_CHARS, marker: MARKER });
process.stdout.write(output);
process.exit(exitCode);