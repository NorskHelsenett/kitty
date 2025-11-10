#!/usr/bin/env node
import { ChatUI } from './ui.js';
import { AIAgent } from './agent.js';
import { PluginManager } from './plugin-manager.js';
import { AgentManager, type AgentWorkflow } from './agent-manager.js';
import type { Tool } from './plugins.js';
import { config } from './config.js';
import * as fs from 'fs';
import * as path from 'path';
import { executeTool as runExecutorTool } from './tools/executor.js';
import { builtInTools } from './tools/index.js';
import { tools as sbomTools } from './tools/sbom-tools.js';

// Parse command line arguments
const args = process.argv.slice(2);
const isDebugMode = args.includes('--debug');
const showHelp = args.includes('--help') || args.includes('-h');

// Check for plugin commands (support both singular and plural)
const isPluginCommand = args[0] === 'plugin' || args[0] === 'plugins';

// Check for agent commands (support both singular and plural)
const isAgentCommand = args[0] === 'agent' || args[0] === 'agents';

// Check if we're in non-interactive mode (piped input or arguments provided)
const isInteractive = process.stdin.isTTY && args.filter(a => !a.startsWith('--') && a !== 'plugin' && a !== 'plugins' && a !== 'agent' && a !== 'agents').length === 0 && !isPluginCommand && !isAgentCommand;

if (showHelp) {
  console.log(`
AI Chat Agent - Terminal UI chat with file access tools

Usage: 
  kitty [options]                    # Interactive TUI mode
  kitty [options] "query"            # Non-interactive mode
  kitty [options] "query" < file     # Process file with query
  echo "text" | kitty "query"        # Pipe input to query
  kitty plugin(s) <command> [args]   # Plugin management
  kitty agent(s) <command> [args]    # Agent management

Options:
  --debug    Enable debug logging and show tool calls/results in chat
  --help     Show this help message

Plugin Commands:
  kitty plugin install <url|file>    # Install plugin from URL or file
  kitty plugin list                  # List installed plugins
  kitty plugin enable <name>         # Enable a plugin
  kitty plugin disable <name>        # Disable a plugin
  kitty plugin remove <name>         # Remove a plugin

Agent Commands:
  kitty agent install <file>         # Install agent from local file
  kitty agent list                   # List installed agents
  kitty agent run <name> [--input]   # Run an agent workflow
  kitty agent enable <name>          # Enable an agent
  kitty agent disable <name>         # Disable an agent
  kitty agent remove <name>          # Remove an agent

Examples:
  kitty                              # Interactive TUI mode
  kitty --debug                      # Interactive with debug mode
  kitty "summarize this file" < README.md
  echo "hello world" | kitty "translate to Spanish"
  git diff | kitty "review this code"
  kitty plugin install https://example.com/my-plugin.json
  kitty plugins list
  kitty agent install examples/agents/sbom-analyzer.yaml
  kitty agents list
`);
  process.exit(0);
}

let debugFile: string | null = null;

if (isDebugMode) {
  debugFile = path.join(process.cwd(), `debug-${Date.now()}.log`);
  if (isInteractive) {
    console.log(`Debug mode enabled. Logging to: ${debugFile}`);
  }
}

function debugLog(data: any) {
  if (debugFile) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${JSON.stringify(data, null, 2)}\n`;
    fs.appendFileSync(debugFile, logEntry);
  }
}

function inferFileVariableName(workflow?: AgentWorkflow | null): string | null {
  if (!workflow?.variables) {
    return null;
  }

  const entries = Object.entries(workflow.variables)
    .filter(([, value]) => typeof value === 'string');

  if (entries.length === 0) {
    return null;
  }

  const fileLike = entries.find(([name]) => {
    const lowered = name.toLowerCase();
    return lowered.includes('file') || lowered.includes('path');
  });

  if (fileLike) {
    return fileLike[0];
  }

  if (entries.length === 1) {
    return entries[0][0];
  }

  return null;
}

function buildInputDataFromArgument(rawInput: string, workflow?: AgentWorkflow): Record<string, any> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {};
  }

  // Try JSON first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to other heuristics
  }

  // Support simple key=value pairs
  const equalsIndex = trimmed.indexOf('=');
  if (equalsIndex > 0) {
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();

    if (!key) {
      throw new Error('Error: Invalid --input format. Provide JSON, key=value, or a file path.');
    }

    return { [key]: value };
  }

  // Treat as file path if it exists
  const resolvedPath = path.resolve(process.cwd(), trimmed);
  if (fs.existsSync(resolvedPath)) {
    const stats = fs.statSync(resolvedPath);
    if (stats.isFile()) {
      const variableName = inferFileVariableName(workflow);
      if (!variableName) {
        throw new Error('Error: Unable to infer which variable should receive the file path. Use JSON (e.g., {"sbom_file":"path"}) or key=value format.');
      }
      return { [variableName]: resolvedPath };
    }
  }

  throw new Error('Error: Invalid --input value. Provide JSON, key=value, or a valid file path.');
}

function normalizeExecutorResult(output: string): string {
  try {
    const parsed = JSON.parse(output);
    if (parsed.error) return parsed.error;
    if (parsed.raw) return parsed.raw;
    if (parsed.markdown) return parsed.markdown;
    return output;
  } catch {
    return output;
  }
}

function registerAgentTools(agentManager: AgentManager, pluginManager: PluginManager) {
  const executorTools: Tool[] = builtInTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema || {},
    execute: async (params: any) => normalizeExecutorResult(await runExecutorTool(tool.name, params)),
  }));

  agentManager.registerTools(executorTools);

  if (sbomTools.length > 0) {
    agentManager.registerTools(sbomTools);
  }

  const pluginTools = pluginManager.getAllTools();
  if (pluginTools.length > 0) {
    agentManager.registerTools(pluginTools);
  }
}

// Non-interactive mode: handle piped input or direct query
async function runNonInteractive() {
  // Use centralized config
  const agent = new AIAgent();
  await agent.initialize();

  // Get query from arguments (filter out flags)
  const query = args.filter(a => !a.startsWith('--')).join(' ');
  
  // Read from stdin if available
  let stdinContent = '';
  if (!process.stdin.isTTY) {
    stdinContent = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
    });
  }

  // Combine query with stdin content
  const fullQuery = stdinContent 
    ? `${query}\n\nInput:\n${stdinContent}`
    : query || stdinContent;

  if (!fullQuery.trim()) {
    console.error('Error: No query provided. Use --help for usage information.');
    process.exit(1);
  }

  // Run the agent and stream output
  try {
    await agent.chat(
      fullQuery,
      (text) => process.stdout.write(text), // Stream text chunks
      undefined, // onToolUse
      undefined, // onToolResult
      undefined, // onWaitingForResponse
      undefined  // onThinking
    );
    console.log(); // Final newline
    agent.dispose();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Plugin command handler
async function runPluginCommand() {
  const command = args[1];
  const pluginManager = new PluginManager();
  await pluginManager.initialize();

  try {
    switch (command) {
      case 'install': {
        const source = args[2];
        if (!source) {
          console.error('Error: Please provide a URL or file path to install from');
          process.exit(1);
        }

        const isForce = args.includes('--force');

        console.log(`Installing plugin from: ${source}`);

        if (source.startsWith('http://') || source.startsWith('https://')) {
          await pluginManager.installFromURL(source, isForce);
        } else {
          await pluginManager.installFromFile(source, isForce);
        }

        console.log('Plugin installed successfully!');
        break;
      }

      case 'list': {
        const plugins = await pluginManager.listInstalled();
        
        if (plugins.length === 0) {
          console.log('No plugins installed.');
        } else {
          console.log('\nInstalled Plugins:\n');
          for (const plugin of plugins) {
            const status = plugin.enabled ? '✓ enabled' : '✗ disabled';
            console.log(`  ${plugin.name} (${plugin.version}) - ${status}`);
            console.log(`    ${plugin.description}`);
            if (plugin.author) console.log(`    Author: ${plugin.author}`);
            console.log(`    Source: ${plugin.source}`);
            console.log(`    Installed: ${new Date(plugin.installDate).toLocaleDateString()}`);
            console.log();
          }
        }
        break;
      }

      case 'enable': {
        const pluginName = args[2];
        if (!pluginName) {
          console.error('Error: Please provide a plugin name');
          process.exit(1);
        }

        await pluginManager.enable(pluginName);
        console.log(`Plugin "${pluginName}" enabled successfully!`);
        break;
      }

      case 'disable': {
        const pluginName = args[2];
        if (!pluginName) {
          console.error('Error: Please provide a plugin name');
          process.exit(1);
        }

        await pluginManager.disable(pluginName);
        console.log(`Plugin "${pluginName}" disabled successfully!`);
        break;
      }

      case 'remove': {
        const pluginName = args[2];
        if (!pluginName) {
          console.error('Error: Please provide a plugin name');
          process.exit(1);
        }

        await pluginManager.uninstall(pluginName);
        console.log(`Plugin "${pluginName}" removed successfully!`);
        break;
      }

      default:
        console.error(`Unknown plugin command: ${command}`);
        console.log('Available commands: install, list, enable, disable, remove');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Agent command handler
async function runAgentCommand() {
  const command = args[1];
  const agentManager = new AgentManager();
  await agentManager.initialize();
  const pluginManager = new PluginManager();
  await pluginManager.initialize();
  registerAgentTools(agentManager, pluginManager);

  try {
    switch (command) {
      case 'install': {
        const source = args[2];
        if (!source) {
          console.error('Error: Please provide a file path to install from');
          process.exit(1);
        }

        console.log(`Installing agent from: ${source}`);
        await agentManager.installAgent(source);
        console.log('Agent installed successfully!');
        break;
      }

      case 'list': {
        const agents = agentManager.listAgents();
        
        if (agents.length === 0) {
          console.log('No agents installed.');
        } else {
          console.log('\nInstalled Agents:\n');
          for (const agent of agents) {
            console.log(`  ${agent.name} (${agent.version})`);
            console.log(`    ${agent.description}`);
            console.log();
          }
        }
        break;
      }

      case 'run': {
        const agentName = args[2];
        if (!agentName) {
          console.error('Error: Please provide an agent name');
          process.exit(1);
        }

        const workflow = agentManager.getAgentWorkflow(agentName);
        if (!workflow) {
          console.error(`Error: Agent "${agentName}" is not installed or enabled. Run "kitty agent list" to see available agents.`);
          process.exit(1);
        }

        // Parse --input flag if provided
        const inputIndex = args.indexOf('--input');
        let inputData = {};
        if (inputIndex !== -1 && args[inputIndex + 1]) {
          try {
            inputData = buildInputDataFromArgument(args[inputIndex + 1], workflow);
          } catch (error) {
            console.error(error instanceof Error ? error.message : 'Error parsing --input parameter');
            process.exit(1);
          }
        }

        console.log(`Running agent: ${agentName}`);

        // Create AI agent for executing prompts
        const agent = new AIAgent();
        await agent.initialize();

        // AI executor that actually calls the AI model
        const aiExecutor = async (prompt: string) => {
          console.log(`\n🤖 AI Prompt:\n${prompt}\n`);

          // Use the OpenAI client directly for simple completions
          const client = agent.getClient();
          const modelName = workflow.model?.name || agent.getCurrentModel();

          try {
            const response = await client.chat.completions.create({
              model: modelName,
              max_tokens: workflow.model?.maxTokens || 2000,
              temperature: workflow.model?.temperature || 0.7,
              messages: [
                {
                  role: 'system',
                  content: 'You are a helpful AI assistant. Analyze the provided data and respond with the requested information in the specified format.'
                },
                {
                  role: 'user',
                  content: prompt
                }
              ],
            });

            const result = response.choices[0]?.message?.content || '';
            console.log(`\n📝 AI Response:\n${result}\n`);
            return result;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`\n❌ AI Error: ${errorMsg}\n`);
            throw error;
          }
        };

        const context = await agentManager.executeAgent(agentName, inputData, aiExecutor);

        console.log('\n📊 Execution Summary:');
        console.log(`   Tasks completed: ${context.results.length}`);
        console.log(`   Errors: ${context.errors.length}`);

        if (context.errors.length > 0) {
          console.log('\n❌ Errors encountered:');
          for (const error of context.errors) {
            console.log(`   - ${error.task}: ${error.error}`);
          }
        }

        // Display final report if available
        if (context.variables.report) {
          console.log('\n' + '='.repeat(80));
          console.log('📄 FINAL REPORT');
          console.log('='.repeat(80) + '\n');
          console.log(context.variables.report);
          console.log('\n' + '='.repeat(80) + '\n');
        }

        // Display other key outputs
        if (context.variables.final_report && !context.variables.report) {
          console.log('\n' + '='.repeat(80));
          console.log('📄 FINAL REPORT');
          console.log('='.repeat(80) + '\n');
          console.log(context.variables.final_report);
          console.log('\n' + '='.repeat(80) + '\n');
        }

        // Clean up
        agent.dispose();
        break;
      }

      case 'enable':
      case 'disable':
      case 'remove': {
        console.log(`Note: ${command} command for agents is not yet implemented.`);
        console.log('Agents are always enabled once installed.');
        console.log('You can manually remove agent directories from ~/.kitty/agents/');
        break;
      }

      default:
        console.error(`Unknown agent command: ${command}`);
        console.log('Available commands: install, list, run');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function main() {
  // Handle plugin commands
  if (isPluginCommand) {
    await runPluginCommand();
    return;
  }

  // Handle agent commands
  if (isAgentCommand) {
    await runAgentCommand();
    return;
  }

  // Handle non-interactive mode
  if (!isInteractive) {
    await runNonInteractive();
    return;
  }

  // Interactive mode (original TUI)
  // Configuration is now centralized in config.ts
  console.log(`Using OpenAI-compatible API at: ${config.getBaseURL()}`);
  if (isDebugMode) {
    console.log(`Debug mode: ENABLED`);
    console.log(`Default model: ${config.getDefaultModel()}`);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.log('Note: No OPENAI_API_KEY set, using empty key (suitable for local servers)');
  }

  // Initialize agent and UI using centralized config
  const agent = new AIAgent();
  const ui = new ChatUI(null, agent, isDebugMode ? debugLog : undefined, isDebugMode);

  // Initialize and run the UI - this will block until the app exits
  await ui.initialize();
}

main().catch(console.error);
