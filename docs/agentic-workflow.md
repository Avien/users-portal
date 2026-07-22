# Agentic AI Development — Deep Dive

[← Back to README](../README.md)

This project was built across two phases, each with a different AI pairing:

**Angular app** (`apps/users-portal-angular`) — built with **ChatGPT + Cursor**
- Architecture was designed upfront by translating product requirements into a clear structural model (Nx boundaries, NgRx patterns, facade contract)
- AI generated the initial implementation baseline aligned to that architecture
- Refined iteratively through engineering-led review, testing, and targeted improvements
- Final design decisions, trade-offs, and code quality were owned and validated manually

**React app** (`apps/users-portal-react`) — rebuilt with **Claude Code** (this repo)
- The Angular app serves as the architectural reference; the goal is an idiomatic React rebuild — not a direct translation
- Claude Code was used as a pair-programmer throughout: implementing features, explaining Angular→React mental model shifts, writing tests, and catching architectural drift
- All decisions (patterns, naming, boundaries) were reviewed and approved incrementally
- Serves as a learning exercise in how the same domain maps across two very different frontend paradigms

## Claude Code Slash Commands

The architecture is encoded into reusable Claude Code commands (`.claude/commands/`). These make AI follow the project's conventions automatically rather than reinventing them each time.

You don't need to know which command to run — just describe what you want in plain language and Claude reads `CLAUDE.md` to route you to the right tool:

| You say | Claude runs |
| :--- | :--- |
| "add a status badge component to the orders card" | `/new-component` |
| "add a priority field to the Order type" | `/sync-contract` |
| "create a full products domain" | `npm run g:feature-domain -- products` |
| "check for architecture drift before I PR this" | `/architecture-check` |

| Command | Usage | What it does |
| :--- | :--- | :--- |
| `/new-component` | `/new-component <name> <angular\|react>` | Scaffolds a presentational component in the correct lib with all conventions applied (React.memo / OnPush, input signals, layer rules) |
| `/sync-contract` | `/sync-contract <description>` | Adds a shared type or method to `@portal/users/utils` and propagates it to both the Angular and React facades, then runs both validates |
| `/architecture-check` | `/architecture-check` | Audits the React codebase for layer boundary violations, cross-framework imports, Zustand scope, JSX logic leaks, and naming convention drift |

> "The tech lead's job is to make AI follow the architecture, not invent a new one every time."

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

Built on `claude-opus-4-8` with adaptive thinking; file operations are confined to the repo root, and mutating tools require confirmation unless `--yes` is passed. The point isn't to replace Claude Code — it's to show the tool-use loop from the inside: schema design, the agentic loop, approval gating, and using the project's own architecture as the agent's knowledge base.

> "The tech lead's job is to make AI follow the architecture, not invent a new one every time — whether that AI is a pair-programmer or an autonomous loop you built yourself."

## PR Review Agent — `tools/pr-review-agent.mjs`

The last "encode architecture into workflow" piece: a GitHub Actions bot that reviews every pull request's diff for architecture drift before a human does.

```bash
# runs locally against a base branch (reads ANTHROPIC_API_KEY from env or a root .env)
npm run pr-review -- --base origin/main
```

- Loads `CLAUDE.md` **verbatim** as the system prompt — the bot enforces exactly the same rules Claude Code already follows in this repo, not a separately maintained rubric.
- Diffs the PR against its base branch (`git diff <base>...HEAD`), sends it to `claude-opus-4-8` with a rubric focused on module boundaries, layer/altitude, shared-contract discipline, state placement, and naming — explicitly instructed to stay low-noise (silent unless genuinely confident it's real drift).
- Wired into `.github/workflows/pr-review.yml`: runs on every PR to `main`, posts the review as a PR comment via `gh pr comment`, and **fails the job when the rubric's own verdict line signals drift** (`process.exit(1)` on a `⚠️` verdict) — a script/API failure now also fails the job, on the theory that "couldn't verify" shouldn't silently pass. To make this an actual merge gate rather than just a red/green badge, add "Architecture review" as a **required status check** in the `main` branch protection rule (GitHub Settings → Branches) — without that rule the job still runs and reports status, but nothing stops a PR from merging around it.
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
