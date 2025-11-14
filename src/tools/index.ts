import { getCustomTools } from './executor.js';
import { tools as sbomTools } from './sbom-tools.js';

export const builtInTools = [
  {
    name: 'execute_command',
    description: 'Execute a shell command and return its output. Can run commands like ls, cat, grep, find, git, etc. Use this to interact with the file system and run various CLI tools.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (e.g., "ls -la", "cat file.txt", "git status")',
        },
        working_directory: {
          type: 'string',
          description: 'Optional working directory to execute the command in. Defaults to current directory.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. More efficient than cat for programmatic access.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read',
        },
        encoding: {
          type: 'string',
          description: 'File encoding (default: utf-8)',
          enum: ['utf-8', 'ascii', 'base64'],
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it doesn\'t exist. IMPORTANT: Only use this when the user explicitly asks you to create or modify a file. Do NOT use this to save analysis, summaries, or responses - those should be returned directly in your message to the user.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to write',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
        append: {
          type: 'boolean',
          description: 'Whether to append to the file instead of overwriting (default: false)',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the contents of a directory with detailed information. If no path is provided, lists the current working directory. Automatically respects .gitignore files. IMPORTANT: Recursive listing can return many files - use sparingly and prefer non-recursive listing when possible.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory to list. Defaults to current working directory if not provided. Cannot access parent directories above the current working directory.',
        },
        show_hidden: {
          type: 'boolean',
          description: 'Whether to show hidden files (default: false)',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively (default: false). WARNING: This can return many files. Use only when necessary and the AI should summarize results, not display all.',
        },
      },
    },
  },
  {
    name: 'search_files',
    description: 'Search for files matching a pattern using grep or find. For filename searches, supports both glob patterns (*.ts) and regex patterns (\\.(ts|tsx)$). Regex patterns are auto-detected or can be explicitly enabled.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Search pattern. For filename search: use glob (*.ts) or regex (\\.(ts|tsx)$). For content search: use grep regex.',
        },
        path: {
          type: 'string',
          description: 'Path to search in (default: current directory)',
        },
        search_type: {
          type: 'string',
          description: 'Type of search: "content" (grep) or "filename" (find)',
          enum: ['content', 'filename'],
        },
        file_pattern: {
          type: 'string',
          description: 'File pattern to filter (e.g., "*.js", "*.txt")',
        },
        use_regex: {
          type: 'boolean',
          description: 'Explicitly use regex for filename search. Auto-detected if pattern contains regex special chars like |()[]{}^$+?\\',
        },
      },
      required: ['pattern', 'search_type'],
    },
  },
  {
    name: 'git_operation',
    description: 'Execute common git operations like status, log, diff, branch, etc. Use operation="log" with args=["-n5", "--oneline"] for "git log -n5 --oneline"',
    input_schema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Git operation to perform (e.g., "log", "status", "diff"). This is the git subcommand.',
          enum: ['status', 'log', 'diff', 'branch', 'add', 'commit', 'push', 'pull', 'clone', 'custom'],
        },
        args: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Additional arguments for the git command as an array. Example: ["-n5", "--oneline"] for log, or ["--staged"] for diff',
        },
        repository_path: {
          type: 'string',
          description: 'Path to the git repository (default: current directory)',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'get_file_info',
    description: 'Get detailed information about a file or directory (size, permissions, modification time, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file or directory',
        },
      },
      required: ['path'],
    },
  },
];

// Export combined tools (built-in + custom plugins)
export function getTools() {
  const customTools = getCustomTools();
  return [
    ...builtInTools,
    ...sbomTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    })),
    ...customTools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))
  ];
}

// For backwards compatibility
export const tools = builtInTools;

// Export gitignore utilities for use by other modules
export { 
  isPathIgnored, 
  filterIgnoredPaths, 
  reloadGitignore, 
  resetGitignoreChecker 
} from './gitignore-utils.js';
