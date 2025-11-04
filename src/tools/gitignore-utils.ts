import * as fs from 'fs/promises';
import * as path from 'path';

interface GitignoreRule {
  pattern: string;
  negation: boolean;
  isDirectory: boolean;
  regex: RegExp;
  baseDir: string; // The directory where this .gitignore file is located
}

class GitignoreChecker {
  private rulesByDir: Map<string, GitignoreRule[]> = new Map();
  private rootDir: string = '';
  private gitignoreCache: Map<string, string> = new Map();

  async loadGitignore(rootPath: string): Promise<void> {
    this.rootDir = path.resolve(rootPath);
    this.rulesByDir.clear();
    this.gitignoreCache.clear();
    
    // Find all .gitignore files recursively
    await this.findAndLoadGitignores(this.rootDir);
  }

  private async findAndLoadGitignores(dirPath: string): Promise<void> {
    try {
      const gitignorePath = path.join(dirPath, '.gitignore');
      
      // Try to load .gitignore in current directory
      try {
        const content = await fs.readFile(gitignorePath, 'utf-8');
        this.gitignoreCache.set(dirPath, content);
        const rules = this.parseGitignore(content, dirPath);
        if (rules.length > 0) {
          this.rulesByDir.set(dirPath, rules);
        }
      } catch (error) {
        // No .gitignore in this directory, that's fine
      }

      // Recursively search subdirectories
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          
          const subDirPath = path.join(dirPath, entry.name);
          
          // Skip if this directory would be ignored by parent rules
          // This prevents descending into node_modules, .git, etc.
          if (this.isIgnoredByParents(subDirPath, dirPath)) {
            continue;
          }
          
          await this.findAndLoadGitignores(subDirPath);
        }
      } catch (error) {
        // Can't read directory, skip it
      }
    } catch (error) {
      // Error accessing directory
    }
  }

  private isIgnoredByParents(targetPath: string, upToDir: string): boolean {
    const relativePath = path.relative(this.rootDir, targetPath);
    
    // Check all parent directories for applicable rules
    let currentDir = path.dirname(targetPath);
    
    while (currentDir.startsWith(this.rootDir) && currentDir !== upToDir) {
      const rules = this.rulesByDir.get(currentDir);
      if (rules) {
        const relativeToRuleDir = path.relative(currentDir, targetPath);
        for (const rule of rules) {
          if (!rule.negation && rule.regex.test(relativeToRuleDir)) {
            return true;
          }
        }
      }
      
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
    
    return false;
  }

  private parseGitignore(content: string, baseDir: string): GitignoreRule[] {
    const rules: GitignoreRule[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      const negation = trimmed.startsWith('!');
      const pattern = negation ? trimmed.slice(1) : trimmed;
      const isDirectory = pattern.endsWith('/');
      const cleanPattern = isDirectory ? pattern.slice(0, -1) : pattern;
      
      // Convert gitignore pattern to regex
      const regex = this.patternToRegex(cleanPattern);
      
      rules.push({
        pattern: cleanPattern,
        negation,
        isDirectory,
        regex,
        baseDir,
      });
    }
    
    return rules;
  }

  private patternToRegex(pattern: string): RegExp {
    // Escape special regex characters except * and ?
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/{{DOUBLESTAR}}/g, '.*');
    
    // If pattern starts with /, it's relative to root
    if (pattern.startsWith('/')) {
      regexPattern = '^' + regexPattern.slice(1);
    } else {
      // Otherwise it can match anywhere in the path
      regexPattern = '(^|/)' + regexPattern;
    }
    
    // Match end of string or /
    regexPattern += '(/|$)';
    
    return new RegExp(regexPattern);
  }

  isIgnored(filePath: string): boolean {
    // Normalize path
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.rootDir, filePath);
    
    const relativePath = path.relative(this.rootDir, absolutePath);
    
    // Never ignore the root directory itself
    if (relativePath === '' || relativePath === '.') {
      return false;
    }

    // Check rules from all applicable .gitignore files
    // Start from the root and work down to the file's directory
    let ignored = false;
    
    // Get all directories from root to the file's location
    const pathSegments = relativePath.split(path.sep);
    const dirsToCheck: string[] = [this.rootDir];
    
    let currentPath = this.rootDir;
    for (let i = 0; i < pathSegments.length - 1; i++) {
      currentPath = path.join(currentPath, pathSegments[i]);
      dirsToCheck.push(currentPath);
    }
    
    // Also check the file's own directory if it's a directory
    const fileDir = path.dirname(absolutePath);
    if (!dirsToCheck.includes(fileDir)) {
      dirsToCheck.push(fileDir);
    }
    
    // Apply rules from each .gitignore in the hierarchy
    for (const dir of dirsToCheck) {
      const rules = this.rulesByDir.get(dir);
      if (!rules) continue;
      
      // Calculate path relative to this .gitignore's location
      const relativeToDir = path.relative(dir, absolutePath);
      
      for (const rule of rules) {
        const matches = rule.regex.test(relativeToDir);
        
        if (matches) {
          if (rule.negation) {
            ignored = false;
          } else {
            ignored = true;
          }
        }
      }
    }
    
    return ignored;
  }

  filterPaths(paths: string[]): string[] {
    return paths.filter(p => !this.isIgnored(p));
  }
  
  async reloadGitignore(dirPath?: string): Promise<void> {
    // Reload a specific directory's .gitignore or reload all
    if (dirPath) {
      const gitignorePath = path.join(dirPath, '.gitignore');
      try {
        const content = await fs.readFile(gitignorePath, 'utf-8');
        this.gitignoreCache.set(dirPath, content);
        const rules = this.parseGitignore(content, dirPath);
        if (rules.length > 0) {
          this.rulesByDir.set(dirPath, rules);
        } else {
          this.rulesByDir.delete(dirPath);
        }
      } catch (error) {
        // .gitignore doesn't exist or can't be read
        this.gitignoreCache.delete(dirPath);
        this.rulesByDir.delete(dirPath);
      }
    } else {
      // Reload all
      await this.loadGitignore(this.rootDir);
    }
  }
}

// Singleton instance
let gitignoreChecker: GitignoreChecker | null = null;
let lastRootPath: string | null = null;

export async function getGitignoreChecker(rootPath?: string): Promise<GitignoreChecker> {
  const root = rootPath || process.cwd();
  
  // If root path changed, recreate the checker
  if (!gitignoreChecker || lastRootPath !== root) {
    gitignoreChecker = new GitignoreChecker();
    lastRootPath = root;
    await gitignoreChecker.loadGitignore(root);
  }
  
  return gitignoreChecker;
}

export async function isPathIgnored(filePath: string, rootPath?: string): Promise<boolean> {
  const checker = await getGitignoreChecker(rootPath);
  return checker.isIgnored(filePath);
}

export async function filterIgnoredPaths(paths: string[], rootPath?: string): Promise<string[]> {
  const checker = await getGitignoreChecker(rootPath);
  return checker.filterPaths(paths);
}

export async function reloadGitignore(dirPath?: string, rootPath?: string): Promise<void> {
  const checker = await getGitignoreChecker(rootPath);
  await checker.reloadGitignore(dirPath);
}

// Reset the singleton (useful for testing or when workspace changes)
export function resetGitignoreChecker(): void {
  gitignoreChecker = null;
  lastRootPath = null;
}
