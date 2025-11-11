# External Code Plugin Example

This example demonstrates how to create a complex plugin using external code files and TypeScript.

## Benefits of External Code Files

- **Better IDE Support** - Full syntax highlighting, autocomplete, and type checking
- **Easy Testing** - Write unit tests for your plugin code
- **Build Tools** - Use TypeScript, bundlers, minifiers, etc.
- **Maintainability** - Easier to read and modify complex logic
- **Separation of Concerns** - Keep manifest and code separate

## Structure

```
github-plugin/
├── package.json          # Build configuration
├── src/
│   └── index.ts         # TypeScript source code
└── dist/
    └── index.js         # Built JavaScript (generated)

github-plugin.yaml       # Plugin manifest (references dist/index.js)
```

## Development Workflow

### 1. Create Plugin Directory

```bash
mkdir my-plugin
cd my-plugin
```

### 2. Initialize Package

```bash
npm init -y
```

### 3. Add Build Script

Edit `package.json`:

```json
{
  "name": "my-plugin",
  "type": "module",
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js --format=esm",
    "watch": "esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js --format=esm --watch",
    "test": "jest"
  }
}
```

Install build/test tools:

```bash
npm install --save-dev esbuild typescript
npm install --save-dev jest ts-jest @types/jest
```

(You can also use other bundlers or tsc + a bundler if preferred.)

### 4. Write TypeScript Code

Create `src/index.ts`:

```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  execute: (params: any) => Promise<string>;
}

const myTool: Tool = {
  name: 'my_tool',
  description: 'What my tool does',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input parameter' }
    },
    required: ['input']
  },
  execute: async (params: { input: string }): Promise<string> => {
    return `Processed: ${params.input}`;
  }
};

export const tools: Tool[] = [myTool];
```

### 5. Build

```bash
npm run build
```

This generates `dist/index.js`.

### 6. Create Plugin Manifest

Create `my-plugin.yaml` in the parent directory:

```yaml
manifest:
  name: my-plugin
  version: 1.0.0
  description: My awesome plugin
  author: Your Name
  license: MIT
  main: index.js

# Reference the built code
codeFile: ./my-plugin/dist/index.js
```

### 7. Install

```bash
# Install dependencies and build
npm install
npm run build

# Install the plugin
kitty plugin install my-plugin.yaml
```

## GitHub Plugin Example

This directory contains a complete example:

### Features

- **TypeScript** - Full type safety
- **GitHub API** - Real API integration
- **Multiple Tools** - 3 different tools in one plugin
- **Error Handling** - Proper error messages
- **Build Process** - Demonstrates complete workflow

### Tools Included

1. **github_repo_info** - Get repository information
2. **github_list_commits** - List recent commits
3. **github_check_maintenance** - Check if repo is maintained

### Build & Install

```bash
# Build the plugin
cd examples/plugins/github-plugin
npm install
npm run build

# Install the plugin
cd ../..
kitty plugin install examples/plugins/github-plugin.yaml
```

### Usage

```bash
kitty

> Get info about facebook/react repository
> List recent commits from microsoft/vscode
> Check if torvalds/linux is maintained
```

## Advanced: With Tests

Add Jest for TypeScript testing:

**src/index.test.ts:**
```typescript
import { describe, it, expect } from '@jest/globals';
import { tools } from './index';

describe('tools', () => {
  it('tool executes correctly', async () => {
    const tool = tools[0];
    const result = await tool.execute({ input: 'test' });
    expect(result).toBe('Processed: test');
  });
});
```

Configure Jest for TypeScript (basic):

```bash
npx ts-jest config:init
```

Run tests:
```bash
npm test
```

## Tips

1. **Keep it simple** - Start with inline code, move to external when needed
2. **Version control** - Add your plugin directory to git
3. **Document** - Add comments and README for your plugin
4. **Test** - Write tests before building
5. **Bundle** - Use `--minify` flag for smaller builds (esbuild supports `--minify`)

## Inline vs External - When to Use What

**Use Inline Code When:**
- Plugin is simple (< 50 lines)
- No external dependencies needed
- Quick prototyping
- Easy distribution is priority

**Use External Code When:**
- Plugin is complex (> 50 lines)
- Need TypeScript or build tools
- Want to write tests
- Multiple developers working on it
- Need better IDE support
```
