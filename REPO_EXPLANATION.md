# Repository Explanation

## Purpose
Kitty is a terminal‑first AI chat client built with Ink, offering a polished TUI for interacting with large language models. It supports agents, plugins, and a workflow engine, allowing tool usage and context persistence via `KITTY.md`.

## Structure
- `src/` – source code (TypeScript) for the CLI, UI, agent engine, plugin manager.
- `examples/` – example scripts and demo agents/plugins.
- `package.json` – project metadata, scripts, dependencies.
- `README.md` – documentation and usage instructions.
- `ANALYSIS.md` – analysis file (not essential).
- `tsconfig.json` – TypeScript configuration.
- `node_modules/` – dependencies.

Key sub‑folders in `examples/`:
- `agents/` – YAML definitions for example agents.
- `plugins/` – YAML/JSON definitions and source for example plugins (calculator, GitHub, weather, etc.).

## Main Components
- **CLI entry point** (`src/index.ts`) exposing commands: chat, plugin management, agent management.
- **Agent workflow engine** – processes user prompts, decides when to invoke tools, optionally asks for confirmation.
- **Plugin manager** – loads plugins defined in YAML/JSON, enables extending functionality.
- **UI** – built with Ink, showing chat timeline, status bar, token counter, task list.
- **Context persistence** – `KITTY.md` stores long‑running project context.

## Usage
**Installation (Bun runtime):**
```bash
bun install
./install-global.sh   # optional, adds `kitty` to PATH
```

**Run interactive TUI:**
```bash
bun run src/index.ts
```
**Debug mode:**
```bash
bun run src/index.ts --debug
```
**Non‑interactive:**
```bash
kitty "summarize this diff" < diff.txt
echo "hello" | kitty "translate to Norwegian"
```
**Plugin commands:**
```bash
bun run src/index.ts plugin list
bun run src/index.ts plugin install <plugin>
```
**Agent demo:**
```bash
bun run examples/agent-demo.ts
```

## Scripts (package.json)
- `dev`, `build`, `start`, `repl`, `demo`, `demo:agent`, etc.

## License
No LICENSE file present (the package.json indicates MIT license).
