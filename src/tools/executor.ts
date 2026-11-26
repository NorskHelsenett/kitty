import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { isPathIgnored, filterIgnoredPaths } from './gitignore-utils.js';
import { Tool } from '../plugins.js';
import { confirmOnTerminal } from '../cli-confirm.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Run a program with an argument array (no shell). Non-zero exit codes listed
 * in okExitCodes (e.g. grep's 1 for "no match") return their output instead of
 * throwing.
 */
async function runFile(
  file: string,
  args: string[],
  options: { cwd?: string; okExitCodes?: number[] } = {}
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd: options.cwd,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    });
    return { stdout, stderr };
  } catch (error: any) {
    if (typeof error?.code === 'number' && options.okExitCodes?.includes(error.code)) {
      return { stdout: error.stdout || '', stderr: error.stderr || '' };
    }
    throw error;
  }
}

/** Keep a path argument from being parsed as an option by find/ls. */
function asPathArg(p: string): string {
  return p.startsWith('-') ? `./${p}` : p;
}

// Registry for custom plugin tools
const customTools = new Map<string, Tool>();

// Confirmation callback for tools that require user approval
export type ConfirmationCallback = (toolName: string, input: any, details?: string) => Promise<boolean>;
let confirmationCallback: ConfirmationCallback | null = null;

export function setConfirmationCallback(callback: ConfirmationCallback | null): void {
  confirmationCallback = callback;
}

export function registerCustomTool(tool: Tool): void {
  customTools.set(tool.name, tool);
}

export function unregisterCustomTool(toolName: string): void {
  customTools.delete(toolName);
}

export function getCustomTools(): Tool[] {
  return Array.from(customTools.values());
}

// Tools that require confirmation before execution
const toolsRequiringConfirmation = new Set(['write_file', 'execute_command', 'git_operation']);

export async function executeTool(toolName: string, input: any): Promise<string> {
  // Check if tool requires confirmation. The gate always applies: when no UI
  // callback is registered (non-interactive mode, `kitty agent run`) we fall
  // back to asking on the terminal, or deny unless KITTY_AUTO_APPROVE is set.
  if (toolsRequiringConfirmation.has(toolName)) {
    let details = '';

    if (toolName === 'write_file') {
      const contentPreview = input.content?.substring(0, 200) || '';
      const truncated = (input.content?.length || 0) > 200 ? '...' : '';
      details = `File: ${input.path}\nSize: ${input.content?.length || 0} bytes\nPreview:\n${contentPreview}${truncated}`;
    } else if (toolName === 'execute_command') {
      const workDir = input.working_directory
        ? path.resolve(input.working_directory)
        : process.cwd();
      details = `Command: ${input.command}\nWorking Directory: ${workDir}`;
    } else if (toolName === 'git_operation') {
      const repoPath = input.repository_path || 'current directory';
      const operation = input.operation || input.command || 'unknown';
      const args: unknown[] = Array.isArray(input.args) ? input.args : [];
      // Show each argument JSON-quoted so separators or trailing content can't hide
      details = `Operation: git ${JSON.stringify(operation)}\nArgs: ${args.length > 0 ? args.map(a => JSON.stringify(a)).join(' ') : '(none)'}\nRepository: ${repoPath}`;
    }

    let confirmed: boolean;
    let reason = 'Action cancelled by user';
    if (confirmationCallback) {
      confirmed = await confirmationCallback(toolName, input, details);
    } else {
      const result = await confirmOnTerminal(toolName, details);
      confirmed = result.approved;
      if (result.reason) reason = result.reason;
    }
    if (!confirmed) {
      return JSON.stringify({
        tool: toolName,
        markdown: `**${reason}**`,
        cancelled: true,
        error: reason,
      }, null, 2);
    }
  }
  try {
    let result: string;
    
    // Check if it's a custom plugin tool first
    const customTool = customTools.get(toolName);
    if (customTool) {
      result = await customTool.execute(input);
      return JSON.stringify({
        tool: toolName,
        markdown: result,
        raw: result
      }, null, 2);
    }
    
    // Built-in tools
    switch (toolName) {
      case 'execute_command':
        result = await executeCommand(input);
        break;
      case 'read_file':
        result = await readFile(input);
        break;
      case 'write_file':
        result = await writeFile(input);
        break;
      case 'list_directory':
        result = await listDirectory(input);
        break;
      case 'search_files':
        result = await searchFiles(input);
        break;
      case 'git_operation':
        result = await gitOperation(input);
        break;
      case 'get_file_info':
        result = await getFileInfo(input);
        break;
      default:
        return `Error: Unknown tool "${toolName}"`;
    }
    
    // Return result wrapped in a JSON structure with markdown content
    // This allows agents to parse and present the results nicely
    return JSON.stringify({
      tool: toolName,
      markdown: result,
      raw: result
    }, null, 2);
  } catch (error: any) {
    return JSON.stringify({
      tool: toolName,
      markdown: `**Error executing ${toolName}:**\n\n\`\`\`\n${error.message}\n\`\`\``,
      error: error.message
    }, null, 2);
  }
}

async function executeCommand(input: { command: string; working_directory?: string }): Promise<string> {
  const { command, working_directory } = input;
  
  // This runs an arbitrary shell command. The real control is the user
  // confirmation in executeTool; the patterns below only catch a few obvious
  // accidents and are not a security boundary.
  const dangerousPatterns = [
    /rm\s+-rf\s+\/(?!home|tmp)/,
    /dd\s+if=/,
    /mkfs/,
    /:\(\)\{/,  // Fork bomb
  ];

  if (dangerousPatterns.some(pattern => pattern.test(command))) {
    return 'Error: Command rejected for safety reasons';
  }

  try {
    const options: any = {
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 30000, // 30 seconds
    };

    if (working_directory) {
      options.cwd = working_directory;
    }

    const { stdout, stderr } = await execAsync(command, options);
    
    let result = '';
    if (stdout) result += stdout;
    if (stderr) result += `\nSTDERR:\n${stderr}`;
    
    return result || 'Command executed successfully (no output)';
  } catch (error: any) {
    return `Error: ${error.message}\n${error.stderr || ''}`;
  }
}

async function readFile(input: { path: string; encoding?: string }): Promise<string> {
  const { path: filePath, encoding = 'utf-8' } = input;
  
  // Check if file is ignored by .gitignore
  if (await isPathIgnored(filePath)) {
    return `Error: Cannot read file - path is ignored by .gitignore: ${filePath}`;
  }
  
  try {
    const content = await fs.readFile(filePath, encoding as BufferEncoding);
    return content;
  } catch (error: any) {
    return `Error reading file: ${error.message}`;
  }
}

async function writeFile(input: { path: string; content: string; append?: boolean }): Promise<string> {
  const { path: filePath, content, append = false } = input;
  
  // Validate content is not empty
  if (!content || content.trim().length === 0) {
    return `Error: Cannot write file - content is empty or whitespace only. Path: ${filePath}`;
  }
  
  // Check if file is ignored by .gitignore
  if (await isPathIgnored(filePath)) {
    return `Error: Cannot write file - path is ignored by .gitignore: ${filePath}`;
  }
  
  try {
    if (append) {
      await fs.appendFile(filePath, content, 'utf-8');
    } else {
      await fs.writeFile(filePath, content, 'utf-8');
    }
    const stats = await fs.stat(filePath);
    return `Successfully wrote ${stats.size} bytes to ${filePath}`;
  } catch (error: any) {
    return `Error writing file: ${error.message}`;
  }
}

async function listDirectory(input: { path?: string; show_hidden?: boolean; recursive?: boolean }): Promise<string> {
  const { path: dirPath, show_hidden = false, recursive = false } = input;
  
  try {
    const cwd = process.cwd();
    
    // Resolve the target directory (default to current directory)
    const targetDir = dirPath || cwd;
    const resolvedPath = path.isAbsolute(targetDir) ? targetDir : path.resolve(cwd, targetDir);
    
    // Security check: Prevent listing directories above the current working directory
    if (resolvedPath !== cwd && !resolvedPath.startsWith(cwd + path.sep)) {
      return `Error: Cannot list directories above the current working directory (${cwd})`;
    }
    
    if (recursive) {
      // Use custom recursive walk that respects .gitignore from the start
      const maxResults = 500;
      const entries = await walkDirectory(resolvedPath, show_hidden, maxResults);
      
      if (entries.length === 0) {
        return 'Directory is empty or all contents are ignored by .gitignore';
      }
      
      // Add warning if we hit the limit
      const warning = entries.length >= maxResults 
        ? `\n**WARNING: Showing first ${maxResults} files only. Results truncated to prevent token overflow.**\n` 
        : '';
      
      // Format the output similar to tree or ls -R
      const lines: string[] = [];
      lines.push(`${resolvedPath}:${warning}`);
      
      // Group entries by directory
      const byDirectory = new Map<string, string[]>();
      for (const entry of entries) {
        const dir = path.dirname(entry);
        if (!byDirectory.has(dir)) {
          byDirectory.set(dir, []);
        }
        byDirectory.get(dir)!.push(path.basename(entry));
      }
      
      // Sort directories
      const sortedDirs = Array.from(byDirectory.keys()).sort();
      
      for (const dir of sortedDirs) {
        const files = byDirectory.get(dir)!.sort();
        
        if (dir !== resolvedPath) {
          lines.push('');
          lines.push(`${dir}:`);
        }
        
        for (const file of files) {
          lines.push(`  ${file}`);
        }
      }
      
      return lines.join('\n');
    } else {
      // Non-recursive: use ls and filter
      const flags = ['-l'];
      if (show_hidden) flags.push('-a');
      
      const { stdout } = await runFile('ls', [...flags, '--', resolvedPath]);
      
      // Filter out ignored paths
      const lines = stdout.split('\n');
      const filteredLines: string[] = [];
      
      for (const line of lines) {
        if (!line.trim() || line.startsWith('total ')) {
          filteredLines.push(line);
          continue;
        }
        
        const parts = line.split(/\s+/);
        if (parts.length < 9) {
          filteredLines.push(line);
          continue;
        }
        
        const filename = parts.slice(8).join(' ');
        const fullPath = path.join(resolvedPath, filename);
        
        if (await isPathIgnored(fullPath)) {
          continue;
        }
        
        filteredLines.push(line);
      }
      
      return filteredLines.join('\n');
    }
  } catch (error: any) {
    return `Error listing directory: ${error.message}`;
  }
}

async function walkDirectory(dirPath: string, showHidden: boolean, maxResults: number = 500): Promise<string[]> {
  const results: string[] = [];
  
  async function walk(currentPath: string): Promise<void> {
    // Stop if we've hit the limit
    if (results.length >= maxResults) {
      return;
    }
    
    // Check if this directory itself is ignored
    if (await isPathIgnored(currentPath)) {
      return;
    }
    
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= maxResults) {
          break;
        }
        
        // Skip hidden files if not requested
        if (!showHidden && entry.name.startsWith('.')) {
          continue;
        }
        
        const fullPath = path.join(currentPath, entry.name);
        
        // Check if this path is ignored by .gitignore
        if (await isPathIgnored(fullPath)) {
          continue;
        }
        
        results.push(fullPath);
        
        // Recursively walk subdirectories
        if (entry.isDirectory()) {
          await walk(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  await walk(dirPath);
  return results;
}

async function searchFiles(input: { 
  pattern: string; 
  path?: string; 
  search_type: 'content' | 'filename';
  file_pattern?: string;
  use_regex?: boolean;
}): Promise<string> {
  const { pattern, path: searchPath = '.', search_type, file_pattern, use_regex = false } = input;
  
  try {
    // Arguments go to grep/find as an array, never through a shell, so
    // pattern and path text cannot run commands.
    let stdout: string;

    if (search_type === 'content') {
      const grepArgs = ['-r'];
      if (file_pattern) {
        grepArgs.push(`--include=${file_pattern}`);
      }
      // -e keeps a pattern that starts with "-" from being read as an option
      grepArgs.push('-e', pattern, '--', searchPath);
      // grep exits 1 for "no matches" and 2 for unreadable files; keep the output either way
      ({ stdout } = await runFile('grep', grepArgs, { okExitCodes: [1, 2] }));
    } else {
      // Use find to search filenames
      // Detect if pattern looks like a regex (contains regex special chars)
      const looksLikeRegex = use_regex || /[|()[\]{}^$+?\\]/.test(pattern);
      const findArgs = [asPathArg(searchPath), '-type', 'f'];

      if (looksLikeRegex) {
        // find -regex uses full path matching, so we need to adjust the pattern
        let regexPattern = pattern;

        // If pattern doesn't start with path separator or .*, prepend .*
        if (!regexPattern.startsWith('.*') && !regexPattern.startsWith('/')) {
          regexPattern = '.*' + regexPattern;
        }

        // Use posix-extended for better regex support (alternation, etc.)
        findArgs.push('-regextype', 'posix-extended', '-regex', regexPattern);
      } else {
        // Use -name for glob patterns
        findArgs.push('-name', pattern);
      }
      // find exits 1 when some directories can't be read; keep partial results
      ({ stdout } = await runFile('find', findArgs, { okExitCodes: [1] }));
    }
    
    if (!stdout || !stdout.trim()) {
      return 'No matches found';
    }
    
    // Filter out ignored paths from results
    const lines = stdout.trim().split('\n');
    const filteredLines: string[] = [];
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Extract file path from the result line
      let filePath: string;
      if (search_type === 'content') {
        // grep output format: "filepath:content"
        const colonIndex = line.indexOf(':');
        filePath = colonIndex !== -1 ? line.substring(0, colonIndex) : line;
      } else {
        // find output format: just the filepath
        filePath = line;
      }
      
      // Check if path should be ignored
      if (await isPathIgnored(filePath)) {
        continue; // Skip ignored files
      }
      
      filteredLines.push(line);
    }
    
    return filteredLines.length > 0 ? filteredLines.join('\n') : 'No matches found (after applying .gitignore filters)';
  } catch (error: any) {
    return `Error searching files: ${error.message}`;
  }
}

// Must match the operation enum in tools/index.ts
const ALLOWED_GIT_OPERATIONS = new Set(['status', 'log', 'diff', 'branch', 'add', 'commit', 'push', 'pull', 'clone', 'custom']);
const GIT_SUBCOMMAND = /^[a-z][a-z0-9-]*$/;
// Options that make git run an arbitrary program
const BLOCKED_GIT_ARG = /^--(upload-pack|receive-pack|exec)(=|$)/;

async function gitOperation(input: { 
  operation: string; 
  args?: string[];
  repository_path?: string;
  command?: string;  // Added for backward compatibility
}): Promise<string> {
  const { operation, repository_path = '.', command: legacyCommand } = input;
  const args: string[] = Array.isArray(input.args) ? input.args : [];
  
  try {
    let gitArgs: string[];

    // Handle legacy 'command' field for backward compatibility
    if (legacyCommand) {
      // Split on whitespace into argv; nothing is passed through a shell
      const parts = String(legacyCommand).trim().split(/\s+/);
      const gitOp = parts[0];
      if (!GIT_SUBCOMMAND.test(gitOp)) {
        return `Error: invalid git subcommand ${JSON.stringify(gitOp)}`;
      }
      gitArgs = [gitOp, ...parts.slice(1)];
    } else if (!operation || operation === 'undefined') {
      return `Error: git operation is required. Received: ${JSON.stringify(input)}`;
    } else if (!ALLOWED_GIT_OPERATIONS.has(operation)) {
      return `Error: unsupported git operation ${JSON.stringify(operation)}. Allowed: ${[...ALLOWED_GIT_OPERATIONS].join(', ')}`;
    } else if (operation === 'custom' && args.length > 0) {
      gitArgs = [...args];
    } else {
      gitArgs = [operation, ...args];
    }

    gitArgs = gitArgs.map(arg => String(arg));
    const blocked = gitArgs.find(arg => BLOCKED_GIT_ARG.test(arg));
    if (blocked) {
      return `Error: git argument ${JSON.stringify(blocked)} is not allowed (it can run arbitrary programs)`;
    }

    // execFile: arguments reach git as-is, no shell parsing
    const { stdout, stderr } = await runFile('git', gitArgs, { cwd: repository_path });

    let result = '';
    if (stdout) result += stdout;
    if (stderr) result += `\n${stderr}`;
    
    return result || 'Git operation completed successfully';
  } catch (error: any) {
    return `Error executing git command: ${error.message}\nCommand that failed: git ${operation || 'undefined'} ${args.join(' ')}\n${error.stderr || ''}`;
  }
}

async function getFileInfo(input: { path: string }): Promise<string> {
  const { path: filePath } = input;
  
  // Check if file is ignored by .gitignore
  if (await isPathIgnored(filePath)) {
    return `Error: Cannot get file info - path is ignored by .gitignore: ${filePath}`;
  }
  
  try {
    const stats = await fs.stat(filePath);
    const info = {
      path: filePath,
      type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
      size: stats.size,
      sizeHuman: formatBytes(stats.size),
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      accessed: stats.atime.toISOString(),
      permissions: stats.mode.toString(8).slice(-3),
      isReadable: !!(stats.mode & 0o444),
      isWritable: !!(stats.mode & 0o222),
      isExecutable: !!(stats.mode & 0o111),
    };
    
    return JSON.stringify(info, null, 2);
  } catch (error: any) {
    return `Error getting file info: ${error.message}`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
