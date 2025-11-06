# Kitty

Kitty is a terminal-first AI chat client with agent and plugin support, rendered with Ink for a polished TUI experience.

## Features

- Clean chat timeline that hides system/tool chatter unless you launch with `--debug`.
- Agent workflow engine with optional confirmation prompts before tools run.
- Plugin manager (`kitty plugin ...`) and agent manager (`kitty agent ...`) built into the CLI.
- Animated status bar, live token counter, and task list to track tool calls as they happen.
- Works interactively in the TUI or non-interactively by piping input or passing a one-off query.
- Generates and consumes `KITTY.md` to keep long-running project context up to date.

## Quick Chat Snapshot

- `You:` Ask a question, run a slash command, or paste context.
- `AI:` Streams markdown-formatted answers with syntax highlighting.
- `Status:` Animated `=^._.^=` bar shows what the agent is doing.
- `Tasks:` Tool runs appear as tasks; expanded tool logs are visible only in `--debug`.
- `Logs:` In debug mode Kitty also writes JSON traces to `debug-<timestamp>.log`.

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

Debug mode keeps the chat transcript intact but adds tool/thinking messages and writes a JSON debug log in the current directory. Launch without `--debug` when you want a concise chat view.

### Non-interactive (pipe or direct query)

```bash
kitty "summarize this diff" < diff.txt
echo "hello" | kitty "translate to Norwegian"
```

### Built-in Slash Commands

Inside the TUI you can type:

```
/help      Show available commands
/models    Switch the active OpenAI model
/plugins   Enable or disable installed plugins
/agents    Enable or disable installed agents
/init      Generate KITTY.md project context
/reinit    Regenerate KITTY.md from scratch
/clear     Clear the visible conversation
```

### Plugin and Agent CLIs

```bash
kitty plugin list
kitty plugin install https://example.com/my-plugin.json
kitty agent install examples/agent-demo.yaml
kitty agent run my-agent --input prompt.txt
```

## Project Context

Run `/init` inside the TUI (or let Kitty do it automatically) to build a `KITTY.md` file that captures repository structure, commands, and coding conventions. Once present, the agent loads it on startup for richer answers.

## Development Scripts

| Script | Command |
|--------|---------|
| Run dev TUI | `bun run src/index.ts` |
| Build for distribution | `bun build src/index.ts --outdir dist --target node` |
| Start built CLI | `bun run dist/index.js` |
| Example demos | `bun run examples/simple-cli.ts` / `bun run examples/agent-demo.ts` |
| Plugin helper | `bun run src/index.ts plugin list` |
| Release bundle | `bash scripts/build-release.sh` |

See `package.json` for the full list, including version bump helpers and additional tests.

## Contributing

Issues and pull requests are welcome. Please include reproduction steps and note whether you ran Kitty in standard or debug mode when reporting UI behaviour.

## License

MIT
