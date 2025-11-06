import OpenAI from 'openai';
import { config, getDefaultModel } from './config.js';

export interface ThinkingStep {
  type: 'planning' | 'reflection' | 'decision';
  content: string;
  timestamp: Date;
}

export interface Task {
  id: string;
  description: string;
  toolName?: string;
  toolInput?: any;
  completed: boolean;
  result?: any;
  successful?: boolean;
}

export interface OrchestratorResult {
  shouldPlan: boolean;
  thinking: ThinkingStep[];
  tasks: Task[];
  finalDecision?: string;
}

export class Orchestrator {
  private client: OpenAI;
  private modelName: string;

  constructor(apiKey?: string, baseURL?: string) {
    const url = baseURL || config.getBaseURL();
    const key = apiKey || config.getApiKey();

    this.client = new OpenAI({
      apiKey: key,
      baseURL: url,
    });
    this.modelName = getDefaultModel();
  }

  /**
   * Analyzes a user query to determine if task planning is needed
   */
  async shouldCreatePlan(
    userMessage: string,
    availableTools: Array<{ name: string; description: string }>,
    conversationContext?: string[]
  ): Promise<{
    shouldPlan: boolean;
    reasoning: string;
  }> {
    const toolsList = availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n');

    const systemPrompt = `
Reasoning: high
You are an AI task analyzer. Your job is to determine if a user's request requires complex task planning or can be answered directly.

Available tools that can help with complex tasks:
${toolsList}

Requests that need planning:
- "explain this repo" - needs to list files, read important ones, then summarize (can use list_directory, read_file)
- "find all TypeScript files with errors" - needs to search, filter, analyze (can use search_files)
- "create a new feature X" - needs multiple steps (can use write_file, execute_command)
- "refactor the codebase" - needs analysis and multiple changes (can use read_file, write_file)
- Multi-step operations or analysis that benefit from tool usage
- Requests that explicitly or implicitly require using available tools

Requests that DON'T need planning:
- "hi" or "hello" - simple greeting
- "what's the weather?" - direct question (no relevant tools)
- "explain this code: [snippet]" - direct explanation with context provided
- Single, simple questions that can be answered immediately without tools
- General knowledge questions

IMPORTANT: Consider whether the request can be better fulfilled by using the available tools. If tools can help accomplish the task, prefer planning.

Respond with JSON only: { "shouldPlan": boolean, "reasoning": "brief explanation mentioning if/which tools would be useful" }`;

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `User request: "${userMessage}"\n\nShould this require task planning?` }
      ],
      temperature: 0.3,
    });

    try {
      const content = response.choices[0]?.message?.content || '{"shouldPlan": false, "reasoning": "unknown"}';
      return JSON.parse(content);
    } catch (e) {
      // Default to no planning if parsing fails
      return { shouldPlan: false, reasoning: 'Failed to analyze request' };
    }
  }

  /**
   * Creates a task plan for complex requests
   */
  async createPlan(
    userMessage: string,
    availableTools: Array<{ name: string; description: string }>,
    conversationContext?: string[]
  ): Promise<{ thinking: string; tasks: Task[] }> {
    const toolsList = availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n');

    const systemPrompt = `You are an AI task planner. Break down the user's request into concrete, sequential tasks.

Available tools (USE THESE when possible):
${toolsList}

For each task, specify:
1. A clear description of what needs to be done
2. Which tool to use (if any) - USE THE EXACT TOOL NAME from the list above
3. What input parameters the tool needs

CRITICAL GUIDELINES:
- PREFER using available tools over generic approaches
- To write files, use "write_file" tool, NOT "execute_command"
- To read files, use "read_file" tool, NOT "execute_command"
- To list directories, use "list_directory" tool
- To search files, use "search_files" tool
- Only use "execute_command" for shell operations that don't have dedicated tools
- Consider which tools from the available list can best accomplish each task
- If a tool exists for an operation, use it instead of a workaround

Respond with JSON only:
{
  "thinking": "your internal reasoning about how to approach this request",
  "tasks": [
    {
      "id": "task-1",
      "description": "clear description",
      "toolName": "tool_name_or_null",
      "toolInput": { "param": "value" }
    }
  ]
}

Example for "create a config.json file":
{
  "thinking": "I need to create a JSON configuration file. I should use the write_file tool, not execute_command.",
  "tasks": [
    {
      "id": "task-1",
      "description": "Create config.json with default settings",
      "toolName": "write_file",
      "toolInput": { 
        "path": "config.json",
        "content": "{\n  \"version\": \"1.0.0\"\n}"
      }
    }
  ]
}

Example for "create KITTY.md by analyzing the project":
{
  "thinking": "To create KITTY.md, I must first gather information by reading project files. I'll read the key files first, and then in the reflection phase, I can construct the actual KITTY.md content based on what I learned. I should NOT include the write_file task in the initial plan since I don't have the data yet.",
  "tasks": [
    {
      "id": "task-1",
      "description": "List project structure to understand organization",
      "toolName": "list_directory",
      "toolInput": { "path": ".", "recursive": true }
    },
    {
      "id": "task-2",
      "description": "Read package.json to get project metadata and scripts",
      "toolName": "read_file",
      "toolInput": { "path": "package.json" }
    },
    {
      "id": "task-3",
      "description": "Read README.md for project description",
      "toolName": "read_file",
      "toolInput": { "path": "README.md" }
    },
    {
      "id": "task-4",
      "description": "Read main source file to understand code patterns",
      "toolName": "read_file",
      "toolInput": { "path": "src/index.ts" }
    },
    {
      "id": "task-5",
      "description": "Read tsconfig.json for coding rules",
      "toolName": "read_file",
      "toolInput": { "path": "tsconfig.json" }
    }
  ]
}

Example for "explain this repo":
{
  "thinking": "To explain the repo, I need to first see what files exist, then read key files like README and package.json, then summarize the structure and purpose.",
  "tasks": [
    {
      "id": "task-1",
      "description": "List all files in the repository to understand structure",
      "toolName": "list_directory",
      "toolInput": { "path": ".", "recursive": true }
    },
    {
      "id": "task-2", 
      "description": "Read README.md to understand project purpose",
      "toolName": "read_file",
      "toolInput": { "path": "README.md" }
    },
    {
      "id": "task-3",
      "description": "Summarize findings to user",
      "toolName": null,
      "toolInput": null
    }
  ]
}`;

    const response = await this.client.chat.completions.create({
      model: 'nhn-large:fast',
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.4,
    });

    try {
      const content = response.choices[0]?.message?.content || '{"thinking": "", "tasks": []}';
      const parsed = JSON.parse(content);

      // Mark all tasks as not completed
      const tasks = parsed.tasks.map((t: any) => ({
        ...t,
        completed: false,
        successful: undefined,
        result: undefined,
      }));

      return {
        thinking: parsed.thinking,
        tasks,
      };
    } catch (e) {
      return {
        thinking: 'Failed to create plan',
        tasks: [],
      };
    }
  }

  /**
   * Reflects on task execution results to determine next steps
   */
  async reflectOnResults(
    originalRequest: string,
    tasks: Task[],
    availableTools: Array<{ name: string; description: string }>,
    onThinking?: (step: ThinkingStep) => void
  ): Promise<{
    isComplete: boolean;
    reasoning: string;
    nextActions?: Task[];
    issues?: string[];
  }> {
    const completedTasks = tasks.filter(t => t.completed);
    const failedTasks = tasks.filter(t => t.completed && t.successful === false);

    const taskSummary = completedTasks.map(t => {
      let resultPreview = 'No result';
      if (t.result !== undefined && t.result !== null) {
        if (typeof t.result === 'string') {
          // Increase preview length to 2000 characters to give better context
          const maxLen = 2000;
          resultPreview = t.result.substring(0, maxLen);
          if (t.result.length > maxLen) {
            resultPreview += `\n... (truncated, total length: ${t.result.length} characters)`;
          }
        } else {
          try {
            const jsonStr = JSON.stringify(t.result);
            const maxLen = 2000;
            resultPreview = jsonStr.substring(0, maxLen);
            if (jsonStr.length > maxLen) {
              resultPreview += `\n... (truncated, total length: ${jsonStr.length} characters)`;
            }
          } catch (e) {
            const strResult = String(t.result);
            const maxLen = 2000;
            resultPreview = strResult.substring(0, maxLen);
            if (strResult.length > maxLen) {
              resultPreview += `\n... (truncated, total length: ${strResult.length} characters)`;
            }
          }
        }
      }

      return {
        description: t.description,
        successful: t.successful,
        result: resultPreview,
      };
    });

    const toolsList = availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n');

    const systemPrompt = `You are an AI task evaluator. Analyze whether tasks successfully fulfilled the user's request.

Available tools for corrective actions:
${toolsList}

Your job:
1. Check if the executed tasks actually achieved what the user asked for
2. Identify any issues or failures
3. Determine if additional work is needed
4. Suggest corrective actions using available tools if something went wrong

Common issues to check:
- Empty results when data was expected (maybe wrong path or search pattern?)
- Tool errors or failures (maybe incorrect parameters?)
- Incomplete information (maybe need to gather more data?)
- User request not fully addressed
- write_file called with empty content (check if result says "Error: Cannot write file - content is empty")
- File operations that failed silently
- Verification tasks showing placeholder content like "<FULL_CONTENT_PLACEHOLDER>" or "[Will be filled]" - this means the write failed
- If a verify task (read_file after write_file) shows placeholder/template content instead of real data, the write needs to be redone

IMPORTANT NOTES:
- Results may be truncated for display. If you see "(truncated, total length: X characters)", the full data exists and the task succeeded
- Truncated output is NORMAL and does NOT mean the task failed
- If a write_file task shows "Error: Cannot write file - content is empty", create tasks to gather data first
- When suggesting nextActions, use ONLY tools from the available list above
- If the request is complete, set isComplete=true and nextActions=[] (empty array)
- Do NOT use toolName="none" - use null or omit toolName if no tool is needed
- Only suggest nextActions if something actually went wrong or is incomplete

SPECIAL CASE - Creating documentation files (like KITTY.md, README.md, etc.):
- If the request is to "create KITTY.md" or similar documentation AND you see that files were successfully read but the write_file task had empty content or wasn't executed yet:
  1. Look at the results from read_file tasks - you have the actual file contents
  2. Create a nextAction with write_file that includes REAL content synthesized from those results
  3. The content should be a complete, well-formatted document based on the data you gathered
  4. Do NOT use placeholders like "[Will be filled]" or "<FULL_CONTENT_PLACEHOLDER>" - use the actual data from the results
  5. Build the content string directly in the toolInput.content field
- If a verify task (read_file after write_file) shows the file contains placeholders like "<FULL_CONTENT_PLACEHOLDER>":
  1. This means the AI wrote placeholder content instead of real content
  2. Look at earlier read_file results to get the actual project data
  3. Create a nextAction to write_file again with REAL synthesized content from the gathered data
  4. The file content must be actual formatted text, not template markers

Example nextAction for writing KITTY.md after reading files:
{
  "id": "task-final",
  "description": "Write KITTY.md with complete content based on gathered project information",
  "toolName": "write_file",
  "toolInput": {
    "path": "KITTY.md",
    "content": "# Project Name\n\n## Overview\nActual description from README...\n\n## Commands\n- npm start: description from package.json\n..."
  }
}

IMPORTANT: When creating write_file nextActions, put the ENTIRE file content in the toolInput.content field.
Do NOT output the file content in your reasoning - put it ONLY in the toolInput.content field.
Keep your reasoning brief so you have enough tokens for the full file content in toolInput.

Respond with JSON only:
{
  "isComplete": boolean,
  "reasoning": "brief explanation",
  "issues": ["list of any problems found"],
  "nextActions": [
    {
      "id": "task-N",
      "description": "what to do next",
      "toolName": "tool_name_from_available_tools_or_null",
      "toolInput": { "param": "value" }
    }
  ]
}`;

    const reflectionPrompt = `Original user request: "${originalRequest}"

Tasks executed:
${JSON.stringify(taskSummary, null, 2)}

Failed tasks: ${failedTasks.length}

Analyze: Did we fulfill the user's request? Are there issues? Should we continue or try a different approach?`;

    const thinkingStep: ThinkingStep = {
      type: 'reflection',
      content: 'Analyzing task results to determine if the request was fulfilled...',
      timestamp: new Date(),
    };
    onThinking?.(thinkingStep);

    const response = await this.client.chat.completions.create({
      model: 'nhn-large:fast',
      max_tokens: 4096, // Increased to allow for full file content in nextActions
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: reflectionPrompt }
      ],
      temperature: 0.3,
    });

    try {
      const content = response.choices[0]?.message?.content || '{"isComplete": true, "reasoning": "unknown"}';
      const parsed = JSON.parse(content);

      const reflectionResult: ThinkingStep = {
        type: 'decision',
        content: parsed.reasoning,
        timestamp: new Date(),
      };
      onThinking?.(reflectionResult);

      // Mark next actions as not completed
      if (parsed.nextActions) {
        parsed.nextActions = parsed.nextActions.map((t: any) => ({
          ...t,
          completed: false,
          successful: undefined,
          result: undefined,
        }));
      }

      return {
        isComplete: parsed.isComplete ?? true,
        reasoning: parsed.reasoning,
        issues: parsed.issues || [],
        nextActions: parsed.nextActions || [],
      };
    } catch (e) {
      return {
        isComplete: true,
        reasoning: 'Failed to analyze results, assuming completion',
        issues: ['Failed to analyze results'],
      };
    }
  }

  /**
   * Determines if a simple response is sufficient (no tools needed)
   */
  async generateSimpleResponse(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>
  ): Promise<string> {
    const messages = [
      ...conversationHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userMessage }
    ];

    const response = await this.client.chat.completions.create({
      model: 'nhn-large:fast',
      max_tokens: 1000,
      messages,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || 'I apologize, but I could not generate a response.';
  }
}
