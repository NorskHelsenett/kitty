# Examples Directory

This directory contains example plugins, agents, and usage demonstrations for the Kitty AI agent system.

## Plugins

### Plugin Formats

Plugins can use **inline code** or **external code files**:

#### Inline Code (Simple Plugins)

- **`calculator-plugin.json`** - JSON format with inline code
- **`calculator-plugin.yaml`** - YAML format with inline code (recommended)
- **`weather-plugin.json`** - Weather information using wttr.in
- **`base64-plugin.json`** - Base64 encoding/decoding utilities
- **`web-scraper-plugin.yaml`** - HTTP requests and HTML parsing tools

#### External Code Files (Complex Plugins)

- **`advanced-calculator-plugin.yaml`** - References `advanced-calculator.js`
  - Statistics calculations (mean, median, mode, stddev)
  - Matrix operations (add, multiply, transpose, determinant)
  - Shows how to reference external JS file
  
- **`github-plugin.yaml`** - References `github-plugin/dist/index.js`
  - Built from TypeScript source
  - Full GitHub API integration
  - Demonstrates professional plugin development workflow
  - See `github-plugin/README.md` for details

**When to Use External Code:**
- ✅ Plugin is complex (>50 lines)
- ✅ Need TypeScript and type safety
- ✅ Want to write tests
- ✅ Better IDE support needed
- ✅ Multiple developers

**When to Use Inline Code:**
- ✅ Simple plugin (<50 lines)
- ✅ Quick prototyping
- ✅ Easy distribution

YAML format is recommended for both because:
- Easier to write and maintain
- Support multiline text without escaping
- More readable for complex code
- Cleaner format for descriptions

## Agents

Multi-step workflow agents for complex tasks:

### `sbom-analyzer.yaml`

Comprehensive SBOM (Software Bill of Materials) analysis agent that:
- Parses CycloneDX and SPDX format SBOMs
- Extracts Package URLs (PURLs) 
- Fetches package metadata from registries (npm, PyPI, cargo, etc.)
- Checks repository maintenance status
- Generates security and maintenance reports

**Usage:**
```bash
bun run examples/agent-demo.ts
```

### `dependency-checker.yaml`

Simple dependency checking agent that demonstrates basic workflow:
- Fetches package information from npm
- Checks if packages are up to date
- Verifies repository accessibility

**Usage:**
```bash
kitty agent run dependency-checker --input '{"package_name": "react"}'
```

## Sample Data

- **`sample-sbom.json`** - Example CycloneDX SBOM file for testing

## Usage Examples

### Running the Agent Demo

```bash
cd /workspaces/kitty
bun run examples/agent-demo.ts
```

This demonstrates:
- Installing agents programmatically
- Registering tools for agents to use
- Executing multi-step workflows
- Handling agent results and errors

### Testing SBOM Analysis

```bash
# Using the sbom-analyzer agent
kitty agent run sbom-analyzer --input '{"sbom_file": "examples/sample-sbom.json"}'

# Quickly list unique PURLs without loading the SBOM into the model
kitty agent run sbom-analyzer --input examples/sample-sbom.json
```

You can also call the `scan_sbom_purls` tool directly in a chat:

```
> use scan_sbom_purls file_path=examples/sample-sbom.json
```

See `docs/PURL_TYPES.md` for the non-HTTP schemes (`pkg:npm/...`, `pkg:maven/...`, etc.) that the scanner looks for.

### Installing Example Plugins

```bash
# Install inline code YAML plugin
kitty plugin install examples/plugins/calculator-plugin.yaml

# Install inline code JSON plugin
kitty plugin install examples/plugins/base64-plugin.json

# Install external code plugin (JavaScript)
kitty plugin install examples/plugins/advanced-calculator-plugin.yaml

# Install external code plugin (TypeScript - build first!)
cd examples/plugins/github-plugin
bun install && bun run build
cd ../../..
kitty plugin install examples/plugins/github-plugin.yaml

# List all installed plugins
kitty plugin list
```

### Building Complex Plugins

For plugins with external code files:

```bash
# Advanced calculator (JavaScript)
# No build needed - already JavaScript

# GitHub plugin (TypeScript)
cd examples/plugins/github-plugin
bun install
bun run build      # Generates dist/index.js
cd ../../..
```

### Using Plugins Interactively

```bash
# Start interactive mode
kitty

# Then use the plugins:
> calculate 2 + 2
> convert 100 celsius to fahrenheit
> what's the weather in London?
```

## Creating Your Own

### Custom Plugin (YAML)

Create `my-plugin.yaml`:

```yaml
manifest:
  name: my-plugin
  version: 1.0.0
  description: |
    My custom plugin that does something awesome.
    Multiple lines are easy in YAML!
  author: Your Name
  license: MIT
  main: index.js

code: |
  export const tools = [{
    name: 'my_tool',
    description: 'What my tool does',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Input parameter' }
      },
      required: ['input']
    },
    execute: async (params) => {
      return `Processed: ${params.input}`;
    }
  }];
```

### Custom Agent (YAML)

Create `my-agent.yaml`:

```yaml
name: my-agent
version: 1.0.0
description: My custom multi-step workflow

variables:
  input_data: ""

tasks:
  - name: step1
    tool: some_tool
    input:
      data: "${input_data}"
    output: result1

  - name: step2
    prompt: |
      Analyze this data: ${result1}
      Provide insights.
    output: final_result
```

## Testing Tools Individually

You can test SBOM tools directly:

```typescript
import { tools } from './src/tools/sbom-tools.js';

const parseSBOM = tools.find(t => t.name === 'parse_sbom');
const result = await parseSBOM.execute({ 
  file_path: 'examples/sample-sbom.json' 
});
console.log(result);
```

## Multi-Ecosystem Examples

The agents support multiple package ecosystems:

- **npm** (Node.js) - `pkg:npm/package@version`
- **PyPI** (Python) - `pkg:pypi/package@version`
- **cargo** (Rust) - `pkg:cargo/crate@version`
- **Maven** (Java) - `pkg:maven/group/artifact@version`
- **NuGet** (.NET) - `pkg:nuget/package@version`
- **Go** - `pkg:golang/module@version`

## File Structure

```
examples/
├── README.md                      # This file
├── plugins/                       # Plugin examples
│   ├── calculator-plugin.json     # JSON format
│   ├── calculator-plugin.yaml     # YAML format (recommended)
│   ├── weather-plugin.json
│   ├── web-scraper-plugin.yaml
│   └── base64-plugin.json
├── agents/                        # Agent workflows
│   ├── sbom-analyzer.yaml         # SBOM analysis workflow
│   └── dependency-checker.yaml    # Simple dependency checker
├── sample-sbom.json               # Test SBOM file
├── agent-demo.ts                  # Agent system demonstration
├── repl.ts                        # REPL example
└── simple-cli.ts                  # CLI example
```

## Next Steps

1. Read [PLUGIN_GUIDE.md](../PLUGIN_GUIDE.md) for plugin development
2. Read [AGENT_GUIDE.md](../AGENT_GUIDE.md) for agent workflows
3. Try the examples in this directory
4. Create your own plugins and agents!

## Support

For issues or questions:
- Check the documentation in the root directory
- Review these examples
- Look at the source code in `src/`
