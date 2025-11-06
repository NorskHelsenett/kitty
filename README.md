# Kitty

A beautiful TUI terminal AI chat client with agent capabilities.

## Description

This repository implements **kitty**, a terminal‑based AI chat client with agent capabilities. It provides an interactive Text User Interface (TUI) built with **Ink** and **React**, allowing users to converse with OpenAI models directly from the command line. The tool also supports **plugins** and **agents**, enabling extensibility and automation of tasks such as file access, code generation, and more.

## Installation

```bash
bun install
```

## Usage

```bash
bun run src/index.ts
```

You can also run the provided examples:

```bash
bun run examples/simple-cli.ts
bun run examples/agent-demo.ts
```

## Scripts

| Script | Command |
|--------|---------|
| dev | `bun run src/index.ts` |
| build | `bun build src/index.ts --outdir dist --target node` |
| start | `bun run dist/index.js` |
| repl | `bun run examples/repl.ts` |
| demo | `bun run examples/simple-cli.ts` |
| demo:agent | `bun run examples/agent-demo.ts` |
| plugin:list | `bun run src/index.ts plugin list` |
| plugin:install | `bun run src/index.ts plugin install` |
| install:global | `./install-global.sh` |
| version:patch | `npm version patch` |
| version:minor | `npm version minor` |
| version:major | `npm version major` |

## Dependencies

See `package.json` for the full list of dependencies.

## Contributing

Contributions are welcome! Please open issues or submit pull requests.

## License

MIT
