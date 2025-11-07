• Using Kitty For SBOMs

  - Install/run the CLI (bun install then bun run src/index.ts or ./install-global.sh for a kitty binary) to open the TUI or run ad‑hoc commands; see the built‑in
    help in src/index.ts:24-65 if you need the full command matrix.
  - Install the packaged SBOM workflow once per machine: kitty agent install examples/agents/sbom-analyzer.yaml, then run it with kitty agent run sbom-analyzer
    --input '{"sbom_file":"examples/sample-sbom.json"}' (adjust the path). The agent defined in examples/agents/sbom-analyzer.yaml walks through reading the
    SBOM, extracting packages, inferring Git repos, running git ls-remote, and emitting a Markdown report with security/maintenance findings, so you don’t have to
    assemble those steps manually.
  - To query GitHub for deprecation/archival status, use either the bundled GitHub plugin (build it under examples/plugins/github-plugin, install via kitty plugin
    install examples/plugins/github-plugin.yaml, then call its tools inside the chat) or let the agent’s execute_command steps run git/curl/gh to inspect a repo;
    both approaches are described in examples/README.md:54-141. The plugin route is nicer if you need authenticated GitHub API calls or richer repo metadata on
    demand.
  - For multi-megabyte SBOMs, call the `scan_sbom_purls` tool (or let the updated `sbom-analyzer` agent call it) to grep for Package URLs (`pkg:npm/...`,
    `pkg:maven/...`, etc.) without streaming the file contents into the model. Refer to docs/PURL_TYPES.md for the list of scheme prefixes the scanner targets.
