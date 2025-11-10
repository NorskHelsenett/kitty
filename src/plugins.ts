import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

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
      const flags = params.recursive ? '-r' : '';
      const { stdout } = await execAsync(`grep ${flags} "${params.pattern}" "${params.path}"`);
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
      const args = params.args || '';
      const { stdout } = await execAsync(`git ${params.command} ${args}`);
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
      const { stdout } = await execAsync(`find ${searchPath} -name "${params.pattern}"`);
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
