import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { isPathIgnored, filterIgnoredPaths } from './gitignore-utils';
import { Tool } from '../plugins.js';

const execAsync = promisify(exec);

// Registry for custom plugin tools
const customTools = new Map<string, Tool>();

export function registerCustomTool(tool: Tool): void {
  customTools.set(tool.name, tool);
}

export function unregisterCustomTool(toolName: string): void {
  customTools.delete(toolName);
}

export function getCustomTools(): Tool[] {
  return Array.from(customTools.values());
}

export async function executeTool(toolName: string, input: any): Promise<string> {
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
  
  // Security: Prevent dangerous commands
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
    // Get current working directory
    const { stdout: pwdOutput } = await execAsync('pwd');
    const cwd = pwdOutput.trim();
    
    // Resolve the target directory (default to current directory)
    const targetDir = dirPath || cwd;
    const resolvedPath = path.isAbsolute(targetDir) ? targetDir : path.resolve(cwd, targetDir);
    
    // Security check: Prevent listing directories above the current working directory
    if (!resolvedPath.startsWith(cwd)) {
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
      
      const command = `ls ${flags.join(' ')} "${resolvedPath}"`;
      const { stdout } = await execAsync(command);
      
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
    let command: string;
    
    if (search_type === 'content') {
      // Use grep to search file contents
      command = `grep -r "${pattern}" "${searchPath}"`;
      if (file_pattern) {
        command += ` --include="${file_pattern}"`;
      }
      command += ' 2>/dev/null || true';
    } else {
      // Use find to search filenames
      // Detect if pattern looks like a regex (contains regex special chars)
      const looksLikeRegex = use_regex || /[|()[\]{}^$+?\\]/.test(pattern);
      
      if (looksLikeRegex) {
        // Use -regex for regex patterns
        // find -regex uses full path matching, so we need to adjust the pattern
        let regexPattern = pattern;
        
        // If pattern doesn't start with path separator or .*, prepend .*
        if (!regexPattern.startsWith('.*') && !regexPattern.startsWith('/')) {
          regexPattern = '.*' + regexPattern;
        }
        
        // Use posix-extended for better regex support (alternation, etc.)
        // Add -type f to only find files (not directories)
        command = `find "${searchPath}" -type f -regextype posix-extended -regex "${regexPattern}" 2>/dev/null || true`;
      } else {
        // Use -name for glob patterns
        command = `find "${searchPath}" -type f -name "${pattern}" 2>/dev/null || true`;
      }
    }
    
    const { stdout } = await execAsync(command);
    
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

async function gitOperation(input: { 
  operation: string; 
  args?: string[];
  repository_path?: string;
  command?: string;  // Added for backward compatibility
}): Promise<string> {
  const { operation, args = [], repository_path = '.', command: legacyCommand } = input;
  
  try {
    let gitCommand: string[];
    
    // Handle legacy 'command' field for backward compatibility
    if (legacyCommand) {
      // If command is provided, parse it
      const parts = legacyCommand.trim().split(/\s+/);
      const gitOp = parts[0];
      const gitArgs = parts.slice(1);
      gitCommand = ['git', gitOp, ...gitArgs];
    } else if (!operation || operation === 'undefined') {
      return `Error: git operation is required. Received: ${JSON.stringify(input)}`;
    } else if (operation === 'custom' && args.length > 0) {
      gitCommand = ['git', ...args];
    } else {
      gitCommand = ['git', operation, ...args];
    }
    
    // Use shell: true to properly handle quoting
    const command = gitCommand.map(arg => {
      // Quote arguments that contain spaces or special shell characters
      if (arg.includes(' ') || arg.includes('%') || arg.includes('$') || arg.includes('*')) {
        return `'${arg.replace(/'/g, "'\\''")}'`; // Escape single quotes
      }
      return arg;
    }).join(' ');
    
    const { stdout, stderr } = await execAsync(command, { 
      cwd: repository_path,
      shell: '/bin/bash'
    });
    
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
