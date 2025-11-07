# Project Summary: Kitty

## Overview
Kitty is a terminal‑first AI chat client with agent and plugin support, rendered with Ink for a polished TUI experience. It offers a clean chat timeline, an agent workflow engine, a plugin manager, animated status bar, live token counter, and works both interactively and non‑interactively.

## Key Features
- Clean chat timeline that hides system/tool chatter unless `--debug` is used.
- Agent workflow engine with optional confirmation prompts before tools run.
- Plugin manager (`kitty plugin ...`) and agent manager (`kitty agent ...`).
- Animated status bar, live token counter, and task list to track tool calls.
- Works in the TUI or via piping/direct queries.
- Generates and consumes `KITTY.md` to keep long‑running project context up to date.

## Installation
Kitty targets the Bun runtime.
```bash
bun install
```
To install globally so `kitty` is available on your PATH:
```bash
./install-global.sh
```

## Usage
### Interactive TUI
```bash
bun run src/index.ts
```
### Interactive with Debug Details
```bash
bun run src/index.ts --debug
```
### Non‑interactive (pipe or direct query)
```bash
kitty "summarize this diff" < diff.txt

echo "hello" | kitty "translate to Norwegian"
```

## Scripts (from package.json)
- `dev`: `bun run src/index.ts`
- `build`: `bun build src/index.ts --outdir dist --target node`
- `start`: `bun run dist/index.js`
- `repl`: `bun run examples/repl.ts`
- `demo`: `bun run examples/simple-cli.ts`
- `demo:agent`: `bun run examples/agent-demo.ts`
- `plugin:list`, `plugin:install`, `agent:demo`, `install:global`, version bump scripts, etc.

## Dependencies
- **Runtime**: `chalk`, `highlight.js`, `ink`, `ink-text-input`, `js-yaml`, `marked`, `marked-terminal`, `openai`, `react`, `tiktoken`
- **Dev**: `@types/js-yaml`, `@types/marked-terminal`, `@types/node`, `@types/react`, `bun-types`, `react-devtools-core`

## Top‑Level File Structure
- `README.md` – project description and usage.
- `ANALYSIS.md`, `REPO_EXPLANATION.md` – additional documentation.
- `package.json` – metadata, scripts, dependencies.
- `tsconfig.json`, `bun.lock` – TypeScript and Bun configuration.
- `src/` – source code of the Kitty CLI.
- `examples/` – example scripts and plugin definitions.
- `node_modules/` – installed dependencies.

## Additional Notes
- The repository includes several example agents and plugins under `examples/agents` and `examples/plugins`.
- `KITTY.md` is used by the application to maintain long‑running context.
