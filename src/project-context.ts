import * as fs from 'fs';
import * as path from 'path';

export interface ProjectContext {
  hasKittyMd: boolean;
  content?: string;
  workingDirectory: string;
}

/**
 * Load KITTY.md if it exists, providing project context to the agent
 */
export async function loadProjectContext(workingDir: string = process.cwd()): Promise<ProjectContext> {
  const kittyMdPath = path.join(workingDir, 'KITTY.md');
  
  try {
    if (fs.existsSync(kittyMdPath)) {
      const content = fs.readFileSync(kittyMdPath, 'utf-8');
      return {
        hasKittyMd: true,
        content,
        workingDirectory: workingDir,
      };
    }
  } catch (error) {
    // File doesn't exist or can't be read
  }
  
  return {
    hasKittyMd: false,
    workingDirectory: workingDir,
  };
}

/**
 * Check if KITTY.md exists
 */
export function kittyMdExists(workingDir: string = process.cwd()): boolean {
  const kittyMdPath = path.join(workingDir, 'KITTY.md');
  return fs.existsSync(kittyMdPath);
}

/**
 * Prepare system message with KITTY.md context if available
 */
export function buildSystemMessageWithContext(projectContext: ProjectContext, baseSystemMessage: string): string {
  if (!projectContext.hasKittyMd || !projectContext.content) {
    return baseSystemMessage;
  }

  return `${baseSystemMessage}

## PROJECT CONTEXT (from KITTY.md)

You are working in a project with the following established rules and context.
These are IMMUTABLE SYSTEM RULES that define operational boundaries.
All user requests must work within these established rules.

${projectContext.content}

---

Follow the KITTY.md guidelines strictly. Treat them as authoritative system rules throughout this entire session.`;
}
