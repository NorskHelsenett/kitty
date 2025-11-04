import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { Tool } from './plugins.js';

/**
 * Agent Task - A single step in an agent workflow
 */
export interface AgentTask {
  name: string;
  description: string;
  tool?: string; // Optional: specific tool to use
  prompt?: string; // Optional: AI prompt for this step
  input?: Record<string, any>; // Input parameters
  output?: string; // Variable name to store output
  condition?: string; // Optional: condition to execute this task
}

/**
 * Agent Workflow - A sequence of tasks
 */
export interface AgentWorkflow {
  name: string;
  description: string;
  version: string;
  author?: string;
  license?: string;
  tasks: AgentTask[];
  variables?: Record<string, any>; // Initial variables
}

/**
 * Agent Metadata for tracking installed agents
 */
export interface AgentMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  installDate: string;
  enabled: boolean;
  source: string;
  tags?: string[]; // e.g., ["security", "sbom", "analysis"]
}

/**
 * Agent Execution Context
 */
export interface AgentContext {
  variables: Record<string, any>;
  results: Array<{ task: string; output: any; timestamp: number }>;
  errors: Array<{ task: string; error: string; timestamp: number }>;
}

/**
 * Agent Executor - Executes agent workflows
 */
export class AgentManager {
  private agentDir: string;
  private metadataFile: string;
  private agents: Map<string, AgentWorkflow> = new Map();
  private toolRegistry: Map<string, Tool> = new Map();

  constructor(customAgentDir?: string) {
    this.agentDir = customAgentDir || path.join(os.homedir(), '.kitty', 'agents');
    this.metadataFile = path.join(this.agentDir, 'metadata.json');
  }

  async initialize(): Promise<void> {
    // Create agent directory if it doesn't exist
    await fs.mkdir(this.agentDir, { recursive: true });
    
    // Load existing agents
    await this.loadAllAgents();
  }

  /**
   * Register a tool for use by agents
   */
  registerTool(tool: Tool): void {
    this.toolRegistry.set(tool.name, tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  private async loadAllAgents(): Promise<void> {
    try {
      const metadataContent = await fs.readFile(this.metadataFile, 'utf-8');
      const allMetadata: Record<string, AgentMetadata> = JSON.parse(metadataContent);

      for (const [agentName, metadata] of Object.entries(allMetadata)) {
        if (metadata.enabled) {
          try {
            await this.loadAgent(agentName);
          } catch (error) {
            console.error(`Failed to load agent ${agentName}:`, error);
          }
        }
      }
    } catch (error) {
      // No metadata file yet or error reading it
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Error loading agent metadata:', error);
      }
    }
  }

  private async loadAgent(agentName: string): Promise<void> {
    const agentPath = path.join(this.agentDir, agentName);
    
    // Try to find agent file (support both JSON and YAML)
    let agentFilePath: string | null = null;
    
    for (const ext of ['agent.json', 'agent.yaml', 'agent.yml']) {
      const testPath = path.join(agentPath, ext);
      try {
        await fs.access(testPath);
        agentFilePath = testPath;
        break;
      } catch {
        // File doesn't exist, try next
      }
    }
    
    if (!agentFilePath) {
      throw new Error(`No agent file found (tried agent.json, agent.yaml, agent.yml)`);
    }

    try {
      // Read and parse agent workflow
      const content = await fs.readFile(agentFilePath, 'utf-8');
      let workflow: AgentWorkflow;
      
      if (agentFilePath.endsWith('.json')) {
        workflow = JSON.parse(content);
      } else {
        // YAML
        workflow = yaml.load(content) as AgentWorkflow;
      }

      this.agents.set(agentName, workflow);
    } catch (error) {
      throw new Error(`Failed to load agent ${agentName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute an agent workflow
   */
  async executeAgent(
    agentName: string, 
    initialInput?: Record<string, any>,
    aiExecutor?: (prompt: string, context: AgentContext) => Promise<string>
  ): Promise<AgentContext> {
    const workflow = this.agents.get(agentName);
    if (!workflow) {
      throw new Error(`Agent ${agentName} not found`);
    }

    const context: AgentContext = {
      variables: { ...(workflow.variables || {}), ...(initialInput || {}) },
      results: [],
      errors: [],
    };

    console.log(`\n🤖 Starting agent: ${workflow.name}`);
    console.log(`📋 Description: ${workflow.description}\n`);

    for (const task of workflow.tasks) {
      try {
        // Check condition if present
        if (task.condition) {
          const shouldExecute = this.evaluateCondition(task.condition, context);
          if (!shouldExecute) {
            console.log(`⏭️  Skipping task: ${task.name} (condition not met)`);
            continue;
          }
        }

        console.log(`▶️  Executing task: ${task.name}`);
        
        let result: any;

        // Execute based on task type
        if (task.tool) {
          // Execute a specific tool
          result = await this.executeTool(task, context);
        } else if (task.prompt && aiExecutor) {
          // Execute AI prompt
          result = await aiExecutor(task.prompt, context);
        } else {
          throw new Error(`Task ${task.name} has neither tool nor prompt specified`);
        }

        // Store result in variables if output is specified
        if (task.output) {
          context.variables[task.output] = result;
        }

        context.results.push({
          task: task.name,
          output: result,
          timestamp: Date.now(),
        });

        console.log(`✅ Completed: ${task.name}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error in task ${task.name}: ${errorMsg}`);
        
        context.errors.push({
          task: task.name,
          error: errorMsg,
          timestamp: Date.now(),
        });
        
        // Stop execution on error (could make this configurable)
        throw new Error(`Agent execution failed at task: ${task.name}`);
      }
    }

    console.log(`\n✨ Agent completed successfully\n`);
    return context;
  }

  private async executeTool(task: AgentTask, context: AgentContext): Promise<any> {
    if (!task.tool) {
      throw new Error('No tool specified');
    }

    const tool = this.toolRegistry.get(task.tool);
    if (!tool) {
      throw new Error(`Tool ${task.tool} not found in registry`);
    }

    // Resolve input parameters by replacing variables
    const params = this.resolveParameters(task.input || {}, context);

    // Execute the tool
    const result = await tool.execute(params);
    return result;
  }

  private resolveParameters(params: Record<string, any>, context: AgentContext): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        // Variable reference
        const varName = value.slice(2, -1);
        resolved[key] = context.variables[varName];
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private evaluateCondition(condition: string, context: AgentContext): boolean {
    // Simple condition evaluation (could be enhanced)
    // Format: "variable_name exists" or "variable_name equals value"
    const parts = condition.split(' ');
    
    if (parts.length >= 2) {
      const varName = parts[0];
      const operator = parts[1];
      
      if (operator === 'exists') {
        return varName in context.variables && context.variables[varName] !== undefined;
      } else if (operator === 'equals' && parts.length >= 3) {
        return context.variables[varName] === parts.slice(2).join(' ');
      }
    }
    
    return true; // Default to true if can't parse
  }

  /**
   * Install an agent from a file
   */
  async installAgent(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let workflow: AgentWorkflow;

      // Determine file format based on extension
      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        workflow = yaml.load(content) as AgentWorkflow;
      } else {
        workflow = JSON.parse(content);
      }

      // Validate workflow
      if (!workflow.name || !workflow.tasks || !Array.isArray(workflow.tasks)) {
        throw new Error('Invalid agent workflow format');
      }

      // Create agent directory
      const agentPath = path.join(this.agentDir, workflow.name);
      await fs.mkdir(agentPath, { recursive: true });

      // Determine output format (preserve input format)
      const outputFileName = filePath.endsWith('.json') ? 'agent.json' : 'agent.yaml';
      const outputPath = path.join(agentPath, outputFileName);

      // Write agent file
      if (outputFileName.endsWith('.json')) {
        await fs.writeFile(outputPath, JSON.stringify(workflow, null, 2), 'utf-8');
      } else {
        await fs.writeFile(outputPath, yaml.dump(workflow), 'utf-8');
      }

      // Update metadata
      await this.updateMetadata(workflow, filePath);

      this.agents.set(workflow.name, workflow);
      console.log(`✅ Agent ${workflow.name} installed successfully`);
    } catch (error) {
      throw new Error(`Failed to install agent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async updateMetadata(workflow: AgentWorkflow, source: string): Promise<void> {
    let allMetadata: Record<string, AgentMetadata> = {};

    try {
      const content = await fs.readFile(this.metadataFile, 'utf-8');
      allMetadata = JSON.parse(content);
    } catch (error) {
      // File doesn't exist yet
    }

    allMetadata[workflow.name] = {
      name: workflow.name,
      version: workflow.version,
      description: workflow.description,
      author: workflow.author,
      license: workflow.license,
      installDate: new Date().toISOString(),
      enabled: true,
      source,
    };

    await fs.writeFile(this.metadataFile, JSON.stringify(allMetadata, null, 2), 'utf-8');
  }

  /**
   * List all installed agents
   */
  listAgents(): Array<{ name: string; description: string; version: string }> {
    return Array.from(this.agents.values()).map(agent => ({
      name: agent.name,
      description: agent.description,
      version: agent.version,
    }));
  }

  /**
   * Get a specific agent workflow
   */
  getAgent(name: string): AgentWorkflow | undefined {
    return this.agents.get(name);
  }
}
