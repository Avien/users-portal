import Anthropic from '@anthropic-ai/sdk';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

// ─────────────────────────────────────────────────────────────────────────────
// A from-scratch Claude coding agent for this Nx monorepo. It loads the repo's
// architecture rules, discovers repository-owned Skills, exposes constrained
// file/generator/validation tools, and drives them with a manual agentic loop:
// model → tool → result → model. Every mutating step can be approval-gated.
//
//   ANTHROPIC_API_KEY=... node tools/agent.mjs "add a products domain with
//     id/name/price and a selectProduct interaction"
//   ANTHROPIC_API_KEY=... node tools/agent.mjs "create an Angular user-badge component"
//
// Flags:
//   --yes          skip the confirmation prompt before mutating tools (scaffold/write/edit)
//   --list-skills  print discovered repository Skills and exit without calling the API
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'claude-opus-4-8';
const MAX_TURNS = 40;

const args = process.argv.slice(2);
const autoApprove = args.includes('--yes');
const listSkillsOnly = args.includes('--list-skills');
const goal = args
  .filter((a) => a !== '--yes' && a !== '--list-skills')
  .join(' ')
  .trim();

if (!goal && !listSkillsOnly) {
  console.error('Usage: node tools/agent.mjs "<natural-language goal>" [--yes]');
  console.error('       node tools/agent.mjs --list-skills');
  process.exit(1);
}

// Load a root .env (dependency-free) so you can just `npm run agent -- "..."`.
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

const parseSkillFrontmatter = (content) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const metadata = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const colon = rawLine.indexOf(':');
    if (colon === -1) continue;
    const key = rawLine.slice(0, colon).trim();
    let value = rawLine.slice(colon + 1).trim();
    value = value.replace(/^(["'])(.*)\1$/, '$2');
    if (key) metadata[key] = value;
  }
  return metadata;
};

const discoverSkills = () => {
  const skillsRoot = resolve(REPO_ROOT, '.claude', 'skills');
  if (!existsSync(skillsRoot)) return [];

  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = resolve(skillsRoot, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) return null;
      const content = readFileSync(skillPath, 'utf8');
      const metadata = parseSkillFrontmatter(content);
      return {
        name: metadata.name || entry.name,
        description: metadata.description || '',
        path: relative(REPO_ROOT, skillPath),
      };
    })
    .filter(Boolean);
};

const repoSkills = discoverSkills();

if (listSkillsOnly) {
  if (repoSkills.length === 0) {
    console.log('No repository Skills discovered.');
  } else {
    console.log(
      repoSkills
        .map((skill) => `${skill.name}\t${skill.path}\t${skill.description || '(no description)'}`)
        .join('\n'),
    );
  }
  process.exit(0);
}

if (!process.env['ANTHROPIC_API_KEY']) {
  console.error('Set ANTHROPIC_API_KEY in your environment or in a .env file at the repo root.');
  process.exit(1);
}

const client = new Anthropic();
const rl = createInterface({ input: stdin, output: stdout });

const tools = {
  load_skill: {
    mutating: false,
    definition: {
      name: 'load_skill',
      description:
        'Load the full instructions for one repository-owned Skill discovered under .claude/skills. ' +
        'Call this before making changes when the user goal matches a listed Skill.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name from the available repository Skills catalog.' },
        },
        required: ['name'],
      },
    },
    run: ({ name }) => {
      const skill = repoSkills.find((candidate) => candidate.name === name);
      if (!skill) {
        return `Unknown skill: ${name}. Available: ${repoSkills.map((candidate) => candidate.name).join(', ') || '(none)'}`;
      }
      return readFileSync(safeResolve(skill.path), 'utf8');
    },
  },

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
      mkdirSync(dirname(abs), { recursive: true });
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
        'Run the project validation for Angular, React, Vue, or the legacy Angular+React pair. ' +
        'Use the framework required by the task or loaded Skill; "both" runs angular then react.',
      input_schema: {
        type: 'object',
        properties: {
          framework: { type: 'string', enum: ['angular', 'react', 'vue', 'both'] },
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

const skillCatalog = repoSkills.length
  ? repoSkills
      .map((skill) => `- ${skill.name}: ${skill.description || '(no description)'} [${skill.path}]`)
      .join('\n')
  : '(no repository Skills discovered)';

const OPERATING_INSTRUCTIONS = `You are an autonomous coding agent operating inside this Nx monorepo
via a tool-use loop. The project rules above (from CLAUDE.md) are authoritative — follow them.
You have no terminal — only the provided tools.

Repository Skills are reusable procedures owned by this repo. Their catalog is included below.
When the user's goal clearly matches a Skill, call load_skill with that Skill name BEFORE any
mutating tool, then follow the loaded SKILL.md as the task-specific procedure. Do not guess or
reconstruct a Skill from its catalog description. A loaded Skill supplements CLAUDE.md; it does
not override the project's architectural rules.

For goals that do not match a Skill, use CLAUDE.md and the available tools directly.

Existing new-domain workflow (use only when the goal is to create a brand-new business domain):
1. Call scaffold_domain with a kebab-case name to generate the shared contract plus Angular/React libs.
2. Use list_files / read_file to inspect what the generator produced.
3. Fill in the model, realistic mock data, shared interaction contract, and both facades.
4. Keep the Angular NgRx-backed facade and React hook facade aligned with the shared contract.
5. Run run_validation("both") and fix failures before finishing.

Do NOT call scaffold_domain for a component inside an existing domain. If a matching component
Skill exists, load and follow it instead.

For minor choices (a field name, a sensible default, which of two equivalent approaches), pick a
reasonable option and note it rather than asking. Do not hand-edit workspace config files
(.env, nx.json, tsconfig.base.json, package.json) unless the user's goal explicitly requires it
and CLAUDE.md allows it. Stay inside the repository, validate the affected framework(s), and end
with a short summary of what changed and what validation ran.`;

const SYSTEM_PROMPT = [
  claudeMd,
  `Available repository Skills:\n${skillCatalog}`,
  OPERATING_INSTRUCTIONS,
]
  .filter(Boolean)
  .join('\n\n---\n\n');

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