import { encoding_for_model, Tiktoken } from 'tiktoken';
import OpenAI from 'openai';

export interface TokenUsage {
  currentTokens: number;
  maxTokens: number;
  percentageUsed: number;
  shouldSummarize: boolean;
}

export interface ModelInfo {
  id: string;
  contextWindow: number;
}

export class TokenManager {
  private encoder: Tiktoken;
  private maxTokens: number;
  private summarizationThreshold: number;
  private client?: OpenAI;

  constructor(
    modelName: string = 'gpt-3.5-turbo',
    maxTokens: number = 128000,
    summarizationThreshold: number = 0.9
  ) {
    // Use cl100k_base encoding which works for most modern models
    try {
      this.encoder = encoding_for_model(modelName as any);
    } catch {
      // Fallback to cl100k_base if model not recognized
      this.encoder = encoding_for_model('gpt-3.5-turbo');
    }
    this.maxTokens = maxTokens;
    this.summarizationThreshold = summarizationThreshold;
  }

  setOpenAIClient(client: OpenAI) {
    this.client = client;
  }

  /**
   * Fetch model information from the API to get actual context window size
   */
  async fetchModelInfo(modelId: string): Promise<ModelInfo | null> {
    if (!this.client) {
      return null;
    }

    try {
      const models = await this.client.models.list();
      const model = models.data.find(m => m.id === modelId);

      if (model) {
        // Try to get context window from model object if available
        // For OpenAI-compatible APIs, this might vary
        const contextWindow = (model as any).context_length ||
          (model as any).max_context_length ||
          this.maxTokens;

        return {
          id: model.id,
          contextWindow,
        };
      }
    } catch (error) {
      console.error('Failed to fetch model info:', error);
    }

    return null;
  }

  /**
   * Update max tokens based on model info
   */
  updateMaxTokens(tokens: number) {
    this.maxTokens = tokens;
  }

  /**
   * Count tokens in a single message
   */
  countMessageTokens(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): number {
    let tokens = 0;

    // Base tokens for message structure
    tokens += 4; // Every message follows <|start|>{role/name}\n{content}<|end|>\n

    // Count role
    if (message.role) {
      tokens += this.encoder.encode(message.role).length;
    }

    // Count content
    if (typeof message.content === 'string') {
      tokens += this.encoder.encode(message.content).length;
    } else if (Array.isArray(message.content)) {
      // For complex content (images, etc.)
      for (const part of message.content) {
        if (typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          tokens += this.encoder.encode(part.text).length;
        }
      }
    }

    // Count tool calls if present
    if ('tool_calls' in message && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.function) {
          tokens += this.encoder.encode(toolCall.function.name).length;
          tokens += this.encoder.encode(toolCall.function.arguments).length;
          tokens += 3; // Function call overhead
        }
      }
    }

    // Count tool call id if present
    if ('tool_call_id' in message && message.tool_call_id) {
      tokens += this.encoder.encode(message.tool_call_id).length;
    }

    return tokens;
  }

  /**
   * Count tokens in conversation history
   */
  countConversationTokens(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
    let total = 0;

    for (const message of messages) {
      total += this.countMessageTokens(message);
    }

    // Add base tokens for completion only if there are messages
    // Every reply is primed with <|start|>assistant<|message|>
    if (messages.length > 0) {
      total += 3;
    }

    return total;
  }

  /**
   * Get current token usage statistics
   */
  getUsage(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): TokenUsage {
    const currentTokens = this.countConversationTokens(messages);
    const percentageUsed = (currentTokens / this.maxTokens) * 100;
    const shouldSummarize = percentageUsed >= (this.summarizationThreshold * 100);

    return {
      currentTokens,
      maxTokens: this.maxTokens,
      percentageUsed,
      shouldSummarize,
    };
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  getAvailableCompletionTokens(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    reserveTokens: number = 1024
  ): number {
    const used = this.countConversationTokens(messages);
    const remaining = Math.max(0, this.maxTokens - used);

    if (remaining === 0) {
      return 32;
    }

    const reserve = Math.max(0, reserveTokens);
    const preferred = remaining - reserve;
    const completion = preferred > 0 ? preferred : Math.max(16, Math.floor(remaining * 0.5));

    return Math.max(16, Math.min(remaining, completion));
  }

  /**
   * Summarize conversation history to fit within token limits
   * Keeps recent messages and summarizes older ones
   */
  async summarizeConversation(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    client: OpenAI,
    keepRecentCount: number = 10
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    if (messages.length <= keepRecentCount) {
      return messages;
    }

    // Split into old and recent messages
    const oldMessages = messages.slice(0, -keepRecentCount);
    const recentMessages = messages.slice(-keepRecentCount);

    // Create summary of old messages
    const conversationText = oldMessages.map(msg => {
      const role = msg.role;
      const content = typeof msg.content === 'string' ? msg.content : '[complex content]';
      return `${role}: ${content}`;
    }).join('\n\n');

    try {
      const summaryResponse = await client.chat.completions.create({
        model: 'nhn-large:fast',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that summarizes conversations. Create a concise summary of the following conversation, preserving key information, decisions, and context. Keep it factual and comprehensive but brief.',
          },
          {
            role: 'user',
            content: `Please summarize this conversation:\n\n${conversationText}`,
          },
        ],
        max_tokens: 2000,
      });

      const summary = summaryResponse.choices[0]?.message?.content || 'Previous conversation summary unavailable.';

      // Return summary as system message plus recent messages
      return [
        {
          role: 'system',
          content: `Previous conversation summary:\n${summary}`,
        },
        ...recentMessages,
      ];
    } catch (error) {
      console.error('Failed to summarize conversation:', error);
      // Fallback: just keep recent messages
      return recentMessages;
    }
  }

  /**
   * Format token usage for display
   */
  formatUsage(usage: TokenUsage): string {
    const percentage = usage.percentageUsed.toFixed(1);
    const current = usage.currentTokens.toLocaleString();
    const max = usage.maxTokens.toLocaleString();

    return `${current} / ${max} tokens (${percentage}%)`;
  }

  /**
   * Get color for token usage (for UI)
   */
  getUsageColor(usage: TokenUsage): string {
    if (usage.percentageUsed >= 90) return 'red';
    if (usage.percentageUsed >= 70) return 'yellow';
    return 'green';
  }

  /**
   * Clean up encoder resources
   */
  dispose() {
    this.encoder.free();
  }
}
