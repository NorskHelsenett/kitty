import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

// All commands run via execFile with an argument array: no shell is involved,
// so model-supplied text cannot inject commands.
const execFileAsync = promisify(execFile);

/** Keep a path argument from being parsed as an option. */
function asPathArg(p: string): string {
  return p.startsWith('-') ? `./${p}` : p;
}

/** Split a free-form argument string into argv, honouring simple quotes. No shell expansion. */
function splitArgs(input: string): string[] {
  const args: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match[1] !== undefined) args.push(match[1].replace(/\\(.)/g, '$1'));
    else if (match[2] !== undefined) args.push(match[2]);
    else args.push(match[3]);
  }
  return args;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  execute: (params: any) => Promise<any>;
}

// List directory contents
const listDirectory: Tool = {
  name: 'list_directory',
  description: 'List files and directories in a given path. Similar to ls command.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list (default: current directory)',
      },
      showHidden: {
        type: 'boolean',
        description: 'Show hidden files (starting with .)',
      },
    },
    required: [],
  },
  execute: async (params: { path?: string; showHidden?: boolean }) => {
    try {
      const targetPath = params.path || process.cwd();
      const files = await readdir(targetPath);
      
      let filteredFiles = params.showHidden 
        ? files 
        : files.filter(f => !f.startsWith('.'));
      
      const fileDetails = await Promise.all(
        filteredFiles.map(async (file) => {
          try {
            const stats = await stat(join(targetPath, file));
            return {
              name: file,
              type: stats.isDirectory() ? 'dir' : 'file',
              size: stats.size,
            };
          } catch (err) {
            return { name: file, type: 'unknown', size: 0 };
          }
        })
      );
      
      return JSON.stringify(fileDetails, null, 2);
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  },
};

// Read file contents
const readFileContent: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Similar to cat command.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to read',
      },
    },
    required: ['path'],
  },
  execute: async (params: { path: string }) => {
    try {
      const content = await readFile(params.path, 'utf-8');
      return content;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  },
};

// Execute grep
const grepFile: Tool = {
  name: 'grep',
  description: 'Search for patterns in files using grep.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The pattern to search for',
      },
      path: {
        type: 'string',
        description: 'The file or directory to search in',
      },
      recursive: {
        type: 'boolean',
        description: 'Search recursively in directories',
      },
    },
    required: ['pattern', 'path'],
  },
  execute: async (params: { pattern: string; path: string; recursive?: boolean }) => {
    try {
      const grepArgs = params.recursive ? ['-r'] : [];
      // -e: pattern can't be read as an option; --: path can't either
      grepArgs.push('-e', String(params.pattern), '--', String(params.path));
      const { stdout } = await execFileAsync('grep', grepArgs, { maxBuffer: 10 * 1024 * 1024 });
      return stdout;
    } catch (error: any) {
      if (error.code === 1) return 'No matches found';
      return `Error: ${error.message}`;
    }
  },
};

// Execute git commands
const gitCommand: Tool = {
  name: 'git',
  description: 'Execute git commands in the current directory.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The git command to execute (e.g., "status", "log", "diff")',
      },
      args: {
        type: 'string',
        description: 'Additional arguments for the git command',
      },
    },
    required: ['command'],
  },
  execute: async (params: { command: string; args?: string }) => {
    try {
      const subcommand = String(params.command || '').trim();
      if (!/^[a-z][a-z0-9-]*$/.test(subcommand)) {
        return `Error: invalid git subcommand ${JSON.stringify(subcommand)}`;
      }
      const extraArgs = params.args ? splitArgs(String(params.args)) : [];
      const blocked = extraArgs.find(arg => /^--(upload-pack|receive-pack|exec)(=|$)/.test(arg));
      if (blocked) {
        return `Error: git argument ${JSON.stringify(blocked)} is not allowed`;
      }
      const { stdout } = await execFileAsync('git', [subcommand, ...extraArgs], { maxBuffer: 10 * 1024 * 1024 });
      return stdout;
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  },
};

// Find files
const findFiles: Tool = {
  name: 'find',
  description: 'Search for files by name or pattern.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The file name pattern to search for',
      },
      path: {
        type: 'string',
        description: 'The directory to search in (default: current directory)',
      },
    },
    required: ['pattern'],
  },
  execute: async (params: { pattern: string; path?: string }) => {
    try {
      const searchPath = params.path || '.';
      const { stdout } = await execFileAsync('find', [asPathArg(searchPath), '-name', String(params.pattern)], { maxBuffer: 10 * 1024 * 1024 });
      return stdout || 'No files found';
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  },
};

// Get current working directory
const getCurrentDir: Tool = {
  name: 'pwd',
  description: 'Get the current working directory.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    return process.cwd();
  },
};

export const tools: Tool[] = [
  listDirectory,
  readFileContent,
  grepFile,
  gitCommand,
  findFiles,
  getCurrentDir,
];

export async function executeTool(toolName: string, params: any): Promise<string> {
  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    return `Error: Tool "${toolName}" not found`;
  }
  return await tool.execute(params);
}
