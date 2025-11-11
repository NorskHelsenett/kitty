import OpenAI from 'openai';
import { getTools } from './tools/index.js';
import { executeTool, registerCustomTool } from './tools/executor.js';
import { Orchestrator, ThinkingStep, Task, type ReasoningMode } from './orchestrator.js';
import { ProjectContext, loadProjectContext, buildSystemMessageWithContext } from './project-context.js';
import { TokenManager, TokenUsage } from './token-manager.js';
import { PluginManager } from './plugin-manager.js';
import { AgentManager } from './agent-manager.js';
import { config, getDefaultModel } from './config.js';

interface AgentSessionOptions {
  systemPrompt?: string;
  temperature?: number;
  reasoningMode?: ReasoningMode;
}

export class AIAgent {
  private client: OpenAI;
  private orchestrator: Orchestrator;
  private conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  private projectContext?: ProjectContext;
  private tokenManager: TokenManager;
  private modelName: string;
  private pluginManager: PluginManager;
  private agentManager: AgentManager;
  private sessionSystemPrompt?: string;
  private sessionTemperature?: number;
  private reasoningMode: ReasoningMode = 'high';

  constructor(apiKey?: string, baseURL?: string) {
    // Use centralized config if not provided
    const url = baseURL || config.getBaseURL();
    const key = apiKey || config.getApiKey();

    this.client = new OpenAI({
      apiKey: key,
      baseURL: url,
    });
    this.orchestrator = new Orchestrator(key, url);
    this.orchestrator.setReasoningMode(this.reasoningMode);

    // Use default model from config
    this.modelName = getDefaultModel();

    // Initialize token manager with 128k context window
    this.tokenManager = new TokenManager('gpt-3.5-turbo', 128000, 0.9);
    this.tokenManager.setOpenAIClient(this.client);

    // Initialize plugin manager
    this.pluginManager = new PluginManager();

    // Initialize agent manager
    this.agentManager = new AgentManager();
  }

  async initialize(): Promise<void> {
    this.projectContext = await loadProjectContext();

    // Initialize plugin manager and load plugins
    await this.pluginManager.initialize();

    // Initialize agent manager
    await this.agentManager.initialize();

    // Register all plugin tools
    const plugins = this.pluginManager.getLoadedPlugins();
    for (const plugin of plugins) {
      for (const tool of plugin.tools) {
        registerCustomTool(tool);
      }
    }

    // Try to fetch actual model info to get correct context window
    try {
      const modelInfo = await this.tokenManager.fetchModelInfo(this.modelName);
      if (modelInfo && modelInfo.contextWindow > 0) {
        this.tokenManager.updateMaxTokens(modelInfo.contextWindow);
      }
    } catch (error) {
      console.error('Could not fetch model info, using default 128k context window');
    }
  }

  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  getAgentManager(): AgentManager {
    return this.agentManager;
  }

  getProjectContext(): ProjectContext | undefined {
    return this.projectContext;
  }

  getTokenUsage(): TokenUsage {
    return this.tokenManager.getUsage(this.conversationHistory);
  }

  getTokenManager(): TokenManager {
    return this.tokenManager;
  }

  configureSession(options: AgentSessionOptions): void {
    if (options.systemPrompt !== undefined) {
      this.sessionSystemPrompt = options.systemPrompt;
    }
    if (options.temperature !== undefined) {
      this.sessionTemperature = options.temperature;
    }
    if (options.reasoningMode) {
      this.reasoningMode = options.reasoningMode;
      this.orchestrator.setReasoningMode(options.reasoningMode);
    }
  }

  private buildSystemPrompt(basePrompt: string): string {
    if (!this.sessionSystemPrompt) {
      return basePrompt;
    }
    const trimmedSessionPrompt = this.sessionSystemPrompt.trim();
    return `${trimmedSessionPrompt}\n\n${basePrompt}`;
  }

  /**
   * Create an OpenAI client with custom model configuration
   * Used for executing agents with their own model settings
   */
  createClientForModel(modelConfig?: { apiKey?: string; baseURL?: string }): OpenAI {
    if (!modelConfig?.apiKey && !modelConfig?.baseURL) {
      return this.client; // Use default client
    }

    const apiKey = modelConfig.apiKey || '';
    const baseURL = modelConfig.baseURL || process.env.OPENAI_BASE_URL || 'http://host.docker.internal:22434';

    return new OpenAI({
      apiKey,
      baseURL,
    });
  }

  /**
   * Get the model name to use for a request
   * Can be overridden by agent-specific configuration
   */
  getModelName(overrideModel?: string): string {
    return overrideModel || this.modelName;
  }

  /**
   * Get current model name
   */
  getCurrentModel(): string {
    return this.modelName;
  }

  /**
   * Set the model to use for this agent
   */
  async setModel(modelName: string): Promise<void> {
    this.modelName = modelName;

    // Update token manager with new model info
    try {
      const modelInfo = await this.tokenManager.fetchModelInfo(modelName);
      if (modelInfo && modelInfo.contextWindow > 0) {
        this.tokenManager.updateMaxTokens(modelInfo.contextWindow);
      }
    } catch (error) {
      console.error('Could not fetch model info for', modelName);
    }
  }

  /**
   * List available models from the API endpoint
   */
  async listAvailableModels(): Promise<Array<{ id: string; created?: number; owned_by?: string }>> {
    try {
      const response = await this.client.models.list();
      return response.data.map(model => ({
        id: model.id,
        created: model.created,
        owned_by: model.owned_by,
      }));
    } catch (error) {
      console.error('Failed to list models:', error);
      return [];
    }
  }

  /**
   * Get the OpenAI client (for direct API access)
   */
  getClient(): OpenAI {
    return this.client;
  }

  async chat(
    userMessage: string,
    onTextChunk?: (text: string) => void,
    onToolUse?: (tool: any) => void,
    onToolResult?: (result: any) => void,
    onWaitingForResponse?: () => void,
    onThinking?: (step: ThinkingStep) => void
  ): Promise<void> {
    // Check token usage before adding new message
    const usage = this.tokenManager.getUsage(this.conversationHistory);

    if (usage.shouldSummarize) {
      // Notify user about summarization
      onThinking?.({
        type: 'planning',
        content: `Context window at ${usage.percentageUsed.toFixed(1)}% - Summarizing conversation history to free up space...`,
        timestamp: new Date(),
      });

      // Summarize the conversation
      this.conversationHistory = await this.tokenManager.summarizeConversation(
        this.conversationHistory,
        this.client,
        10 // Keep last 10 messages
      );

      const newUsage = this.tokenManager.getUsage(this.conversationHistory);
      onThinking?.({
        type: 'planning',
        content: `Conversation summarized. Token usage reduced from ${usage.percentageUsed.toFixed(1)}% to ${newUsage.percentageUsed.toFixed(1)}%`,
        timestamp: new Date(),
      });
    }

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    const thinkingStep1: ThinkingStep = {
      type: 'planning',
      content: 'Analyzing if this request requires task planning...',
      timestamp: new Date(),
    };
    onThinking?.(thinkingStep1);

    const tools = getTools();
    const { shouldPlan, reasoning } = await this.orchestrator.shouldCreatePlan(
      userMessage,
      tools.map(t => ({ name: t.name, description: t.description })),
      this.conversationHistory.map(m => typeof m.content === 'string' ? m.content : '').filter(Boolean)
    );

    const thinkingStep2: ThinkingStep = {
      type: 'decision',
      content: reasoning,
      timestamp: new Date(),
    };
    onThinking?.(thinkingStep2);

    if (!shouldPlan) {
      await this.respondDirectly(userMessage, onTextChunk);
      return;
    }

    const planThinking: ThinkingStep = {
      type: 'planning',
      content: 'Creating a task plan to fulfill this request...',
      timestamp: new Date(),
    };
    onThinking?.(planThinking);

    const { thinking, tasks } = await this.orchestrator.createPlan(
      userMessage,
      tools.map(t => ({ name: t.name, description: t.description })),
      this.conversationHistory.map(m => typeof m.content === 'string' ? m.content : '').filter(Boolean)
    );

    const planResult: ThinkingStep = {
      type: 'planning',
      content: `Plan: ${thinking}\n\nTasks to execute: ${tasks.length}`,
      timestamp: new Date(),
    };
    onThinking?.(planResult);

    let allTasks = [...tasks];
    let maxIterations = 5;
    let iteration = 0;
    let taskIdCounter = tasks.length;

    while (iteration < maxIterations) {
      iteration++;

      const tasksToProcess = allTasks.filter(t => !t.completed);

      for (const task of tasksToProcess) {
        if (task.toolName) {
          onToolUse?.({ name: task.toolName, input: task.toolInput });

          try {
            const result = await executeTool(task.toolName, task.toolInput);
            task.result = result;
            task.successful = true;
            task.completed = true;
            onToolResult?.(result);

            // Automatic verification: if write_file succeeded, immediately read it back to verify
            if (task.toolName === 'write_file' && task.successful && task.toolInput?.path) {
              const verifyTask: Task = {
                id: `verify-${taskIdCounter++}`,
                description: `Verify content written to ${task.toolInput.path}`,
                toolName: 'read_file',
                toolInput: { path: task.toolInput.path },
                completed: false,
                successful: undefined,
                result: undefined,
              };

              // Add verification task immediately after this one
              allTasks.push(verifyTask);

              // Execute verification immediately
              onToolUse?.({ name: verifyTask.toolName!, input: verifyTask.toolInput });
              try {
                const verifyResult = await executeTool(verifyTask.toolName!, verifyTask.toolInput);
                verifyTask.result = verifyResult;
                verifyTask.successful = true;
                verifyTask.completed = true;
                onToolResult?.(verifyResult);
              } catch (verifyError) {
                verifyTask.result = verifyError instanceof Error ? verifyError.message : String(verifyError);
                verifyTask.successful = false;
                verifyTask.completed = true;
                onToolResult?.({ error: verifyTask.result });
              }
            }
          } catch (error) {
            task.result = error instanceof Error ? error.message : String(error);
            task.successful = false;
            task.completed = true;
            onToolResult?.({ error: task.result });
          }
        } else {
          task.completed = true;
          task.successful = true;
        }
      }

      const reflectThinking: ThinkingStep = {
        type: 'reflection',
        content: 'Analyzing task results...',
        timestamp: new Date(),
      };
      onThinking?.(reflectThinking);

      const reflection = await this.orchestrator.reflectOnResults(
        userMessage,
        allTasks,
        tools.map(t => ({ name: t.name, description: t.description })),
        onThinking
      );

      if (reflection.isComplete) {
        break;
      }

      if (reflection.nextActions && reflection.nextActions.length > 0) {
        // Filter out invalid tasks (e.g., toolName="none" or other invalid tools)
        const validToolNames = new Set(tools.map(t => t.name));
        const validNextActions = reflection.nextActions.filter(action => {
          // Allow tasks with no tool (null or undefined)
          if (!action.toolName) return true;
          // Only allow tasks with valid tool names
          if (validToolNames.has(action.toolName)) return true;
          // Log invalid tool names
          console.warn(`Skipping task with invalid tool name: "${action.toolName}"`);
          return false;
        });

        if (validNextActions.length === 0) {
          // No valid actions, consider complete
          break;
        }

        const continueThinking: ThinkingStep = {
          type: 'decision',
          content: `Not complete yet. ${reflection.issues?.join(', ') || 'Continuing with additional tasks...'}`,
          timestamp: new Date(),
        };
        onThinking?.(continueThinking);

        allTasks = [...allTasks, ...validNextActions];
      } else {
        break;
      }
    }

    await this.generateFinalResponse(userMessage, allTasks, onTextChunk);
  }

  private async respondDirectly(
    userMessage: string,
    onTextChunk?: (text: string) => void
  ): Promise<void> {
    const baseSystemMessage = 'You are a helpful AI assistant. Format responses using Markdown. Keep responses concise and clear.';
    const sessionAwareBase = this.buildSystemPrompt(baseSystemMessage);
    const systemContent = this.projectContext
      ? buildSystemMessageWithContext(this.projectContext, sessionAwareBase)
      : sessionAwareBase;

    const systemMessage = {
      role: 'system' as const,
      content: systemContent
    };

    const promptMessages = [systemMessage, ...this.conversationHistory];
    const completionTokens = this.tokenManager.getAvailableCompletionTokens(promptMessages, 2048);

    try {
      const response = await this.client.chat.completions.create({
        model: this.modelName,
        max_tokens: completionTokens,
        temperature: this.sessionTemperature,
        messages: promptMessages,
        stream: true,
      });

      let fullResponse = '';
      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          fullResponse += delta.content;
          onTextChunk?.(delta.content);
        }
      }

      this.conversationHistory.push({
        role: 'assistant',
        content: fullResponse,
      });
    } catch (error: any) {
      // Log the error for debugging
      console.error('Error in respondDirectly:', error);

      // Add error to conversation history
      const errorMessage = `Error: ${error.message || String(error)}`;
      this.conversationHistory.push({
        role: 'assistant',
        content: errorMessage,
      });

      // Still call the callback with error message
      onTextChunk?.(errorMessage);

      // Re-throw to let caller handle it
      throw error;
    }
  }

  private async generateFinalResponse(
    userMessage: string,
    tasks: Task[],
    onTextChunk?: (text: string) => void
  ): Promise<void> {
    const taskSummary = tasks.map(t => {
      let resultPreview = 'No result';
      if (t.result !== undefined && t.result !== null) {
        if (typeof t.result === 'string') {
          resultPreview = t.result.substring(0, 1000);
        } else {
          try {
            resultPreview = JSON.stringify(t.result).substring(0, 1000);
          } catch (e) {
            resultPreview = String(t.result).substring(0, 1000);
          }
        }
      }

      return {
        description: t.description,
        successful: t.successful,
        result: resultPreview,
      };
    });

    const baseSystemMessage = `You are a helpful AI assistant. Based on the task execution results, provide a comprehensive answer to the user's request.

Format your response using Markdown for readability. Be concise but thorough. If tasks failed, explain what went wrong.

IMPORTANT: 
- Analyze and synthesize the task results - don't just list them. Provide insights and answer the user's original question.
- If a file was written successfully (write_file task succeeded), do NOT output the file content in your response
- Just confirm what was created, e.g., "I've created KITTY.md with project documentation including overview, commands, and coding rules."
- Focus on what was accomplished, not reproducing file contents`;
    const sessionAwareBase = this.buildSystemPrompt(baseSystemMessage);
    const systemContent = this.projectContext
      ? buildSystemMessageWithContext(this.projectContext, sessionAwareBase)
      : sessionAwareBase;

    const systemMessage = {
      role: 'system' as const,
      content: systemContent
    };

    const promptMessage = `Original user request: "${userMessage}"

Tasks executed and their results:
${JSON.stringify(taskSummary, null, 2)}

Please provide a comprehensive response to the user based on these results.`;

    // Add task results as a temporary context message (will be included in API call but not stored in history)
    const messagesWithTaskContext = [
      systemMessage,
      ...this.conversationHistory,
      {
        role: 'user' as const,
        content: promptMessage,
      }
    ];

    const completionTokens = this.tokenManager.getAvailableCompletionTokens(messagesWithTaskContext, 2048);

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      max_tokens: completionTokens,
      temperature: this.sessionTemperature,
      messages: messagesWithTaskContext,
      stream: true,
    });

    let fullResponse = '';
    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullResponse += delta.content;
        onTextChunk?.(delta.content);
      }
    }

    // Add ONLY the assistant response to history (not the task summary prompt)
    // The original user message is already in the history from the beginning of chat()
    this.conversationHistory.push({
      role: 'assistant',
      content: fullResponse,
    });
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  dispose() {
    this.tokenManager.dispose();
  }
}
