# Repository Explanation: Kitty

## Purpose
Kitty is a terminal‑first AI chat client that provides a polished Text User Interface (TUI) built with **Ink**. It supports agents and plugins, enabling advanced workflows and tool integrations directly from the command line.

## Primary Language & Runtime
- **Language:** TypeScript / JavaScript
- **Runtime:** **Bun** (with a Node compatibility layer)
- **Package manager:** `bun`

## Key Components
- **Core CLI (`src/index.ts`)** – entry point that drives the interactive TUI and non‑interactive modes.
- **Agent Engine** – workflow engine that can run tools, optionally prompting for confirmation before execution.
- **Plugin System** – commands under `kitty plugin …` to list, install, and manage plugins. Example plugins are provided in `examples/plugins/`.
- **Agent Management** – commands under `kitty agent …` to list and run predefined agents.
- **Utilities** – helper scripts for building, releasing, and global installation (`install-global.sh`).
- **Examples** – a collection of demo scripts (`simple-cli.ts`, `agent-demo.ts`, etc.) and sample SBOM files.

## Dependencies (selected)
- `ink` – React‑like library for building TUIs.
- `openai` – integration with OpenAI models.
- `chalk`, `highlight.js`, `marked-terminal` – for colored output and markdown rendering.
- `js-yaml` – YAML parsing for plugin/agent definitions.
- Development dependencies include TypeScript typings and React devtools.

## Installation
```bash
bun install            # install dependencies
./install-global.sh   # install the `kitty` command globally
```

## Usage
- **Interactive TUI**: `bun run src/index.ts`
- **Interactive with debug**: `bun run src/index.ts --debug`
- **One‑off query**: `kitty "summarize this diff" < diff.txt`
- **Pipe input**: `echo "hello" | kitty "translate to Norwegian"

## Extensibility
- **Plugins** are defined in YAML/JSON and can be added via `kitty plugin install <path>`.
- **Agents** are defined in `examples/agents/*.yaml` and can be executed with `kitty agent run <agent-name>`.

## Project Structure (high‑level)
- `src/` – source code of the CLI.
- `examples/` – demo scripts, sample SBOMs, and plugin/agent definitions.
- `node_modules/` – Bun‑managed dependencies.
- `README.md` – detailed documentation (this file).
- `EXPLANATION.md` – (this file) provides a concise overview of the repository.
