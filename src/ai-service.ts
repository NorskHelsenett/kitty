import OpenAI from 'openai';
import { tools, executeTool } from './plugins.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  input: any;
  result?: string;
}

export class AIService {
  private client: OpenAI;
  private conversationHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  constructor(apiKey: string = '', baseURL?: string) {
    const url = baseURL || process.env.OPENAI_BASE_URL || 'http://host.docker.internal:22434';
    this.client = new OpenAI({ 
      apiKey: apiKey || '',
      baseURL: url,
    });
  }

  async sendMessage(
    userMessage: string,
    onStream?: (text: string) => void,
    onToolUse?: (toolName: string, input: any) => void
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    let assistantMessage = '';
    const toolCalls: ToolCall[] = [];
    let continueLoop = true;

    while (continueLoop) {
      continueLoop = false;

      const stream = await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 4096,
        messages: this.conversationHistory,
        tools: tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        stream: true,
      });

      let currentText = '';
      let pendingToolCalls: { [index: number]: { id?: string; name?: string; arguments: string } } = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          currentText += delta.content;
          if (onStream) {
            onStream(delta.content);
          }
        }
        
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index!;
            
            if (!pendingToolCalls[index]) {
              pendingToolCalls[index] = { arguments: '' };
            }
            
            if (toolCall.id) {
              pendingToolCalls[index].id = toolCall.id;
            }
            
            if (toolCall.function?.name) {
              pendingToolCalls[index].name = toolCall.function.name;
            }
            
            if (toolCall.function?.arguments) {
              pendingToolCalls[index].arguments += toolCall.function.arguments;
            }
          }
        }
        
        if (chunk.choices[0]?.finish_reason === 'tool_calls') {
          continueLoop = true;
        }
      }

      // Process tool calls
      const completedToolCalls = Object.values(pendingToolCalls).filter(tc => tc.id && tc.name);
      
      if (completedToolCalls.length > 0) {
        // Add assistant message with tool calls to history
        this.conversationHistory.push({
          role: 'assistant',
          content: currentText || null,
          tool_calls: completedToolCalls.map(tc => ({
            id: tc.id!,
            type: 'function' as const,
            function: {
              name: tc.name!,
              arguments: tc.arguments,
            },
          })),
        });

        // Execute tools and add results
        for (const toolCall of completedToolCalls) {
          const functionName = toolCall.name!;
          const functionArgs = JSON.parse(toolCall.arguments || '{}');
          
          if (onToolUse) {
            onToolUse(functionName, functionArgs);
          }
          
          const result = await executeTool(functionName, functionArgs);
          
          toolCalls.push({
            name: functionName,
            input: functionArgs,
            result,
          });

          // Add tool result to history
          this.conversationHistory.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id!,
          });
        }
      } else {
        // No tool calls, add text response to history
        assistantMessage = currentText;
        this.conversationHistory.push({
          role: 'assistant',
          content: currentText,
        });
      }
    }

    return { content: assistantMessage, toolCalls };
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  getHistory() {
    return this.conversationHistory;
  }
}
