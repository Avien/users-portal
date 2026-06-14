import Anthropic from '@anthropic-ai/sdk';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// ─────────────────────────────────────────────────────────────────────────────
// A from-scratch Claude agent that scaffolds and fills in a new dual-framework
// feature domain in this Nx monorepo. It exposes this repo's own operations as
// tools (the feature-domain generator, file edits, the validate scripts) and
// drives them with a manual agentic loop — model → tool → result → model —
// so every step is visible and mutating actions can be gated.
//
//   ANTHROPIC_API_KEY=... node tools/agent.mjs "add a products domain with
//     id/name/price and a selectProduct interaction"
//
// Flags:
//   --yes   skip the confirmation prompt before mutating tools (scaffold/write/edit)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'claude-opus-4-8';
const MAX_TURNS = 40;

const args = process.argv.slice(2);
const autoApprove = args.includes('--yes');
const goal = args.filter((a) => a !== '--yes').join(' ').trim();

if (!goal) {
  console.error('Usage: node tools/agent.mjs "<natural-language goal>" [--yes]');
  process.exit(1);
}
if (!process.env['ANTHROPIC_API_KEY']) {
  console.error('Set ANTHROPIC_API_KEY in your environment first.');
  process.exit(1);
}

const client = new Anthropic();
const rl = createInterface({ input: stdin, output: stdout });

// ── Tool plumbing ────────────────────────────────────────────────────────────

// Resolve a caller-supplied path and refuse anything outside the repo.
const safeResolve = (p) => {
  const abs = resolve(REPO_ROOT, p);
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + '/')) {
    throw new Error(`Path escapes the repo: ${p}`);
  }
  return abs;
};

const runShell = (command, commandArgs) => {
  const res = spawnSync(command, commandArgs, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // Disable the Nx daemon for the agent's own commands: after scaffold_domain
    // generates new projects, a running daemon serves a stale project graph and
    // task execution can't find them ("Could not find project …"). Computing the
    // graph fresh per command avoids that without touching the user's daemon config.
    env: { ...process.env, NX_DAEMON: 'false' },
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  // Keep tool results compact — the model only needs the tail of long logs.
  const tail = output.length > 8000 ? `…(truncated)…\n${output.slice(-8000)}` : output;
  return `exit code: ${res.status}\n${tail || '(no output)'}`;
};

const tools = {
  scaffold_domain: {
    mutating: true,
    definition: {
      name: 'scaffold_domain',
      description:
        'Run the feature-domain generator to scaffold a brand-new dual-framework domain ' +
        '(shared contract lib, Angular NgRx data-access + facade, React data-access + facade hook, ' +
        'and tsconfig path aliases). Use this ONCE at the start for a new domain. ' +
        'Name must be kebab-case and singular-ish, e.g. "products".',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'kebab-case domain name, e.g. "products"' },
        },
        required: ['name'],
      },
    },
    run: ({ name }) => runShell('npm', ['run', 'g:feature-domain', '--', name]),
  },

  list_files: {
    mutating: false,
    definition: {
      name: 'list_files',
      description:
        'List repo files tracked by git matching an optional glob (relative to repo root). ' +
        'Use to discover what the generator produced before editing.',
      input_schema: {
        type: 'object',
        properties: {
          glob: { type: 'string', description: 'e.g. "libs/products/**" — omit for all tracked files' },
        },
      },
    },
    run: ({ glob }) =>
      runShell('git', ['ls-files', ...(glob ? ['--', glob] : [])]),
  },

  read_file: {
    mutating: false,
    definition: {
      name: 'read_file',
      description: 'Read a UTF-8 file, relative to repo root.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    run: ({ path }) => {
      const abs = safeResolve(path);
      if (!existsSync(abs) || !statSync(abs).isFile()) return `No such file: ${path}`;
      return readFileSync(abs, 'utf8');
    },
  },

  write_file: {
    mutating: true,
    definition: {
      name: 'write_file',
      description:
        'Create or overwrite a file with the given content, relative to repo root. ' +
        'Use for replacing generated placeholder files (e.g. the model interface or mock data).',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    run: ({ path, content }) => {
      const abs = safeResolve(path);
      writeFileSync(abs, content, 'utf8');
      return `Wrote ${content.length} bytes to ${path}`;
    },
  },

  edit_file: {
    mutating: true,
    definition: {
      name: 'edit_file',
      description:
        'Replace an exact substring in a file (relative to repo root). old_string must appear ' +
        'exactly once. Prefer this over write_file for small, targeted changes.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    run: ({ path, old_string, new_string }) => {
      const abs = safeResolve(path);
      if (!existsSync(abs)) return `No such file: ${path}`;
      const before = readFileSync(abs, 'utf8');
      const count = before.split(old_string).length - 1;
      if (count === 0) return `old_string not found in ${path} — read it first.`;
      if (count > 1) return `old_string appears ${count}× in ${path} — make it unique.`;
      writeFileSync(abs, before.replace(old_string, new_string), 'utf8');
      return `Edited ${path}`;
    },
  },

  run_validation: {
    mutating: false,
    definition: {
      name: 'run_validation',
      description:
        'Run the project validation (lint + tests, plus tsc for React). ' +
        'Run this after editing to confirm both implementations still pass. ' +
        '"both" runs angular then react.',
      input_schema: {
        type: 'object',
        properties: {
          framework: { type: 'string', enum: ['angular', 'react', 'both'] },
        },
        required: ['framework'],
      },
    },
    run: ({ framework }) => {
      const scripts =
        framework === 'both' ? ['validate:angular', 'validate:react'] : [`validate:${framework}`];
      return scripts
        .map((s) => `# npm run ${s}\n${runShell('npm', ['run', s])}`)
        .join('\n\n');
    },
  },
};

// The same CLAUDE.md that governs Claude Code in this repo is loaded verbatim as the
// agent's knowledge base; the operating instructions below layer the tool-use workflow on top.
const claudeMd = (() => {
  const p = resolve(REPO_ROOT, 'CLAUDE.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
})();

const OPERATING_INSTRUCTIONS = `You are an autonomous coding agent operating inside this Nx monorepo
via a tool-use loop. The project rules above (from CLAUDE.md) are authoritative — follow them.
Your job is to scaffold and fully wire up a NEW feature domain end to end, given a
natural-language goal. You have no terminal — only the provided tools.

Workflow for a new domain:
1. Call scaffold_domain with a kebab-case name to generate all four libs and the path aliases.
2. Use list_files / read_file to see what the generator produced (placeholder model interface,
   MOCK_<NAME> data, the I<Name>FacadeInteractions contract, and both facades).
3. Fill in the real shape:
   - The shared model interface in libs/<name>/src/lib/models/<name>.interface.ts
   - Realistic MOCK_<NAME> mock data
   - Any domain-specific interaction methods on I<Name>FacadeInteractions
4. Implement those interaction methods in BOTH facades — the Angular NgRx-backed facade and the
   React hook facade. The shared contract is the single source of truth; never duplicate types
   in app code, always import from @portal/<name>/utils. Keep both facades in lock-step.
5. Run run_validation("both") and fix anything that fails before finishing.

Conventions: files kebab-case; component exports PascalCase; hook exports camelCase with a use
prefix; shared interfaces get an I prefix. Find the React-idiomatic equivalent — do not translate
Angular patterns literally.

For minor choices (a field name, a sensible default, which of two equivalent approaches), pick a
reasonable option and note it rather than asking. Only the file edits, generator, and validation
are available to you — there is no terminal. Work only inside the generated libs/<name> directories;
do NOT hand-edit workspace config files (.env, nx.json, tsconfig.base.json, package.json) — the
generator manages path aliases for you. When the domain is scaffolded, wired in both frameworks,
and validation passes, stop and give a short summary of what you built.`;

const SYSTEM_PROMPT = claudeMd
  ? `${claudeMd}\n\n---\n\n${OPERATING_INSTRUCTIONS}`
  : OPERATING_INSTRUCTIONS;

// ── Confirmation gate for mutating tools ─────────────────────────────────────

const confirm = async (toolName, input) => {
  if (autoApprove || !tools[toolName].mutating) return true;
  const preview =
    toolName === 'write_file'
      ? `${input.path} (${input.content?.length ?? 0} bytes)`
      : JSON.stringify(input).slice(0, 200);
  const answer = await rl.question(`  ↳ approve ${toolName} ${preview}? [y/N] `);
  return answer.trim().toLowerCase() === 'y';
};

// ── The agentic loop ─────────────────────────────────────────────────────────

const dispatch = async (block) => {
  const tool = tools[block.name];
  let resultText;
  let isError = false;
  if (!tool) {
    resultText = `Unknown tool: ${block.name}`;
    isError = true;
  } else if (!(await confirm(block.name, block.input))) {
    resultText = 'User declined this action. Adjust your plan or ask for guidance.';
    isError = true;
  } else {
    try {
      resultText = tool.run(block.input);
    } catch (err) {
      resultText = `Tool error: ${err.message}`;
      isError = true;
    }
  }
  return { type: 'tool_result', tool_use_id: block.id, content: resultText, is_error: isError };
};

const run = async () => {
  console.log(`\n▸ goal: ${goal}\n`);
  const messages = [{ role: 'user', content: goal }];
  const toolDefs = Object.values(tools).map((t) => t.definition);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: 'adaptive', display: 'summarized' },
      system: SYSTEM_PROMPT,
      tools: toolDefs,
      messages,
    });

    let lastChannel = null;
    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_delta') return;
      if (event.delta.type === 'thinking_delta') {
        if (lastChannel !== 'thinking') stdout.write('\n\x1b[2m[thinking] ');
        lastChannel = 'thinking';
        stdout.write(event.delta.thinking);
      } else if (event.delta.type === 'text_delta') {
        if (lastChannel !== 'text') stdout.write('\x1b[0m\n');
        lastChannel = 'text';
        stdout.write(event.delta.text);
      }
    });

    const message = await stream.finalMessage();
    stdout.write('\x1b[0m\n');
    messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason !== 'tool_use') {
      console.log('\n✓ done.');
      break;
    }

    const toolUses = message.content.filter((b) => b.type === 'tool_use');
    const results = [];
    for (const block of toolUses) {
      console.log(`\n● ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`);
      const result = await dispatch(block);
      console.log(`  → ${String(result.content).split('\n')[0].slice(0, 120)}`);
      results.push(result);
    }
    messages.push({ role: 'user', content: results });
  }

  rl.close();
};

run().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});