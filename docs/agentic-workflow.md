# Agentic AI Development — Deep Dive

[← Back to README](../README.md)

This repository is built with a deliberately **agentic** development workflow, not AI-assisted autocomplete — the deep dive behind the README's [Agentic AI Development](../README.md#-agentic-ai-development) section. It evolved from close collaboration with **Claude Code** into that workflow: I set the core architecture and engineering guardrails early on — Nx boundaries, the facade contract, module federation seams, the platform SDK — and continue to own feature intent, architectural decisions, constraints, and review direction, while increasingly delegating implementation details to Claude Code and the automated agents below.

- Architecture decisions were designed and directed by me; Claude Code and the automated agents implement against them rather than inventing them from scratch
- `CLAUDE.md` is the source of truth encoding those decisions — Claude Code consumes it as repository-level instructions/context during a session, while `tools/agent.mjs` and `tools/pr-review-agent.mjs` load it verbatim into their own system prompts, so every path works against the same rules instead of an implicit "house style"
- The React and Vue rebuilds treat the Angular app as an architectural reference, not a template to translate line-by-line — each pattern's (facade, state management, virtualization) idiomatic reinterpretation per framework was directed by me, with Claude Code explaining the cross-framework mental-model shifts along the way
- Implementation is increasingly delegated within those guardrails — via slash commands, Claude Code, and the autonomous agent below. The PR review agent is a separate role: it enforces and reviews those same guardrails against every diff, it doesn't implement anything itself

## Claude Code Slash Commands

The architecture is encoded into reusable Claude Code commands (`.claude/commands/`) — explicit, scoped prompts for common changes, each one encoding the project's own conventions so the output doesn't depend on restating them every time. They're invoked directly (`/new-component`, `/sync-contract`, `/architecture-check`), not inferred automatically from a plain-language request.

| Command | Usage | What it does |
| :--- | :--- | :--- |
| `/new-component` | `/new-component <name> <angular\|react\|vue>` | Scaffolds a presentational component in the correct lib with all conventions applied (React.memo / OnPush / Vue's fine-grained reactivity, input signals, layer rules) |
| `/sync-contract` | `/sync-contract <description>` | Adds a shared type or method to `@portal/users/utils` and propagates it to the Angular and React facades, then runs both validates |
| `/architecture-check` | `/architecture-check` | Audits the React codebase for layer boundary violations, cross-framework imports, Zustand scope, JSX logic leaks, and naming convention drift |

Current per-command scope: `/new-component` covers Angular, React, and Vue; `/sync-contract` covers Angular and React only; `/architecture-check` audits the React codebase only. None of the three has a Vue-and-Angular-aware drift check yet.

## Autonomous Agent — `tools/agent.mjs`

Where the slash commands above run inside Claude Code, this is a standalone agent built directly on the **Claude API** — a hand-rolled tool-use loop, not a wrapper around an existing tool. Describe a goal in plain language and it scaffolds and wires up a whole new feature domain end to end, without step-by-step human prompting.

```bash
# autonomous — runs the full trajectory unattended
ANTHROPIC_API_KEY=sk-... npm run agent -- "create a products domain with name, price, category and a selectProduct interaction" --yes

# interactive — prompts for approval before each mutating step (drop --yes)
ANTHROPIC_API_KEY=sk-... npm run agent -- "create a products domain with name and price"
```

**How it works** — the same `CLAUDE.md` that governs Claude Code in this repo is loaded *verbatim* as the agent's system prompt, with a thin operating layer on top. The agent then reasons over that and drives the loop itself: `model → tool → result → model`, until the domain is scaffolded, wired in both frameworks, and validation passes.

| Tool | What the agent does with it |
| :--- | :--- |
| `scaffold_domain` | Runs the `feature-domain` generator to create all four libs + path aliases |
| `list_files` / `read_file` | Inspects what the generator produced before editing |
| `write_file` / `edit_file` | Fills in the model interface, mock data, and interaction methods in **both** facades |
| `run_validation` | Runs `validate:angular` / `validate:react` and fixes anything that fails before finishing |

Built on `claude-opus-4-8` with adaptive thinking; file operations are confined to the repo root, and mutating tools require confirmation unless `--yes` is passed. The point isn't to replace Claude Code — it's to show the tool-use loop from the inside: schema design, the agentic loop, approval gating, and using the project's own architecture as the agent's knowledge base. Angular + React only — it doesn't scaffold Vue.

## PR Review Agent — `tools/pr-review-agent.mjs`

The last "encode architecture into workflow" piece: a GitHub Actions bot that reviews every pull request's diff for architecture drift before a human does.

```bash
# runs locally against a base branch (reads ANTHROPIC_API_KEY from env or a root .env)
npm run pr-review -- --base origin/main
```

- Loads `CLAUDE.md` **verbatim** as the system prompt — the bot enforces exactly the same rules Claude Code already follows in this repo, not a separately maintained rubric.
- Diffs the PR against its base branch (`git diff <base>...HEAD`) and sends only that diff to `claude-opus-4-8` — it judges what changed, not the whole codebase, so it never flags pre-existing issues elsewhere in the repo.

**What it actually checks:**

| Category | Flags |
| :--- | :--- |
| Module boundaries | A `ui`/`data-access` lib importing "upward"; one `feature` importing another `feature`; cross-framework imports (Angular ↔ React ↔ Vue); an app reaching past `feature`/`data-access` |
| Layer / altitude | Business logic (filter/sort/derive/map) living in a component or template instead of the facade; a dumb component importing a store, query client, or router; view-derived state that belongs in the ViewModel |
| Contract discipline | A domain type redefined in app code instead of imported from `@portal/*/utils`; a facade not returning the shared `Vm & IFacadeInteractions` shape |
| State placement | A Zustand/Pinia store holding server state or route-derivable state; a WebSocket or singleton created inside a route-bound facade instead of the app root |
| Naming conventions | Non-kebab-case files, non-PascalCase component exports, hooks not `use`-prefixed camelCase, shared interfaces missing the `I` prefix, facade files not named `use-[name]-facade.ts` |

It's explicitly instructed to stay **low-noise** — no formatting nitpicks, no subjective style opinions, no hypotheticals, only what it's genuinely confident is real drift introduced by that diff. Output is forced into a fixed shape: one verdict line (`✅ No architecture drift found.` or `⚠️ N issue(s) found:`) followed by `path:line` bullets — and that verdict line is exactly what the exit-code check parses to decide pass/fail (see below).

- Wired into `.github/workflows/pr-review.yml`: runs on every PR to `main`, posts the review as a PR comment via `gh pr comment`, and **fails the job when the rubric's own verdict line signals drift** (`process.exit(1)` on a `⚠️` verdict) — a script/API failure now also fails the job, on the theory that "couldn't verify" shouldn't silently pass. **Architecture review** is configured as a required status check in the `main` branch protection rule, so a PR with confirmed drift can't be merged around it.
- Verified locally against two synthetic diffs before shipping: one with real violations (a `ui` component importing a Zustand store, business logic in JSX, a redefined domain type) — correctly flagged all three — and one clean contract-only change — correctly stayed silent.

## Nx Generator — `feature-domain`

For creating a brand-new feature domain, a custom Nx generator scaffolds the full dual-framework skeleton from a single command.

```bash
npm run g:feature-domain -- <domain-name>
```

**Example:**
```bash
npm run g:feature-domain -- products
```

Generates **35 files across 4 libs** and updates `tsconfig.base.json` path aliases automatically:

| Output | Contents |
| :--- | :--- |
| `libs/products/` | Shared contract — `Product` model, `IProductsFacadeInteractions`, `ProductsVm`, mock data |
| `libs/products-angular/data-access/` | NgRx actions, reducer, effects, selectors + `ProductsFacade` (Angular Signals, `inject()`) |
| `libs/products-react/data-access/` | `fetchProducts()` API fn + Zustand store for UI state |
| `libs/products-react/feature/` | `useProductsFacade()` hook returning `ProductsVm & IProductsFacadeInteractions` |

After generating, fill in the model interface, replace mock data, add domain-specific interaction methods to `IXxxFacadeInteractions`, then implement them in both facades. Run `validate:angular` and `validate:react` before committing.

The generator enforces architecture at **creation time** — correct Nx tags, layer boundaries, shared contract shape, and framework conventions are baked in before a single line of feature code is written. The slash commands then enforce it during **ongoing development**, and the PR review agent catches anything that still drifts.

| Tool | When | Enforces |
| :--- | :--- | :--- |
| Generator | New domain | Structure, tags, contracts, facades |
| `/new-component` | New UI component | Layer placement, memo/OnPush, props-only |
| `/sync-contract` | New shared type or method | Dual-framework propagation, validates |
| `/architecture-check` | Before PR (local) | Drift detection across all layers |
| PR Review Agent | Every PR (CI) | Same drift checks, automated, posted as a PR comment |

## Product-Facing vs. Development-Facing AI

Everything above is **development tooling** — it helps build and review
this repository's own code. The **Business Agent** is a separate
product-facing surface: a feature end users interact with, not development
tooling.

| Surface | Who uses it | What it touches |
| :--- | :--- | :--- |
| Claude Code (this session) | Me, during development | The whole repo, interactively |
| `tools/agent.mjs` | Me, to scaffold new domains | Source code, unattended |
| `tools/pr-review-agent.mjs` | CI, on every PR | A PR's diff, for architecture drift |
| **`<business-agent-widget>`** | **End users, in the app UI** | **Live Users/Orders business data — no source code access at all** |

Same underlying pattern (Claude API + structured tool calling +
model → tool → result → model), applied to a completely different
domain and audience. See **[docs/business-agent.md](./business-agent.md)**
for the full architecture.

See the [Project Roadmap](./roadmap.md) for other planned work.
