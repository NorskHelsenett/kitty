import React, { useState, useEffect, useCallback, useRef, useMemo, useReducer } from 'react';
import { Box, Text, useInput, useApp, Static } from 'ink';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { AIAgent } from './agent.js';
import { setConfirmationCallback } from './tools/executor.js';
import { CommandInput } from './components/CommandInput.js';
import { TaskList, Task as TaskType } from './components/TaskList.js';

// Configure marked for terminal output
marked.use(markedTerminal({
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  heading: chalk.cyan.bold,
  strong: chalk.bold,
  em: chalk.italic,
  codespan: chalk.yellow,
  link: chalk.blue.underline,
}) as any);

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'thinking' | 'none';
  content: string;
  timestamp: number;
  thinkingType?: 'planning' | 'reflection' | 'decision';
}

interface ChatProps {
  agent: AIAgent;
  debugMode?: boolean;
}

// Message actions for reducer
type MessageAction =
  | { type: 'ADD'; message: Message }
  | { type: 'UPDATE_LAST'; content: string }
  | { type: 'CLEAR' };

// Reducer for messages - avoids array spreading in hot path
const messagesReducer = (state: Message[], action: MessageAction): Message[] => {
  switch (action.type) {
    case 'ADD':
      return [...state, action.message];
    case 'UPDATE_LAST':
      if (state.length === 0 || state[state.length - 1].role !== 'assistant') {
        return state;
      }
      const updated = state.slice(0, -1);
      return [...updated, { ...state[state.length - 1], content: action.content }];
    case 'CLEAR':
      return [];
    default:
      return state;
  }
};

// Memoized message component to prevent re-rendering on input changes
const MessageItem = React.memo(({ msg, debugMode }: { msg: Message; debugMode: boolean }) => {
  if (msg.role === 'none') {
    return <Text>{msg.content}</Text>;
  }

  // Normalize content: replace 3+ consecutive newlines with just 2 newlines (one blank line)
  const content = (msg.content || '').replace(/\n{3,}/g, '\n\n');
  const isThinking = msg.role === 'thinking';
  const color = msg.role === 'user' ? 'cyan' :
    msg.role === 'assistant' ? 'green' :
      msg.role === 'thinking' ? 'gray' :
        'yellow';
  const prefix = msg.role === 'user' ? '› ' :
    msg.role === 'assistant' ? '● ' :
      msg.role === 'thinking' ? '○○○ ' :
        '• ';
  const label = msg.role === 'user' ? 'You' :
    msg.role === 'assistant' ? 'KITTY' :
      msg.role === 'thinking' ? `Thinking (${msg.thinkingType || 'processing'})` :
        'System';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold={!isThinking} dimColor={isThinking}>
        {prefix}{label}
      </Text>
      {content && content.trim().length > 0 ? (
        <Text color={color} dimColor={isThinking} wrap="wrap">{content}</Text>
      ) : (
        debugMode && <Text dimColor>(no content - {content.length} chars)</Text>
      )}
    </Box>
  );
});
MessageItem.displayName = 'MessageItem';

export function Chat({ agent, debugMode = false }: ChatProps) {
  const [messages, dispatch] = useReducer(messagesReducer, [
    {
      id: 'header',
      role: 'none',
      content: `

██╗  ██╗██╗████████╗████████╗██╗   ██╗
██║ ██╔╝██║╚══██╔══╝╚══██╔══╝╚██╗ ██╔╝
█████╔╝ ██║   ██║      ██║    ╚████╔╝ 
██╔═██╗ ██║   ██║      ██║     ╚██╔╝  
██║  ██╗██║   ██║      ██║      ██║   
╚═╝  ╚═╝╚═╝   ╚═╝      ╚═╝      ╚═╝   
Welcome to KITTY - Your AI-powered assistant!  
                v0.1.0                                  
                                                  
                                                  `,
      timestamp: Date.now(),
    },
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Welcome to KITTY! 🐱\nType your message below or /help for commands',
      timestamp: Date.now(),
    }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [tokenSpeed, setTokenSpeed] = useState<number>(0);
  const [lastTokenCount, setLastTokenCount] = useState<{ session: number; total: number }>({ session: 0, total: 0 });
  const [layoutKey, setLayoutKey] = useState(0);
  const { exit } = useApp();

  // Keyboard control state
  const lastCtrlCTime = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Token tracking for streaming
  const streamStartTime = useRef<number>(0);
  const streamTokenCount = useRef<number>(0);

  // Throttling for message updates
  const lastUpdateTime = useRef<number>(0);
  const pendingUpdate = useRef<string | null>(null);
  const updateTimeout = useRef<NodeJS.Timeout | null>(null);

  // Message ID counter to ensure unique keys
  const messageIdCounter = useRef<number>(0);

  // Debug logging
  const debugLogFile = useRef<string | null>(null);
  const logToFile = useCallback(async (message: string) => {
    if (!debugMode) return;

    try {
      const fs = await import('fs');
      const path = await import('path');

      if (!debugLogFile.current) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        debugLogFile.current = path.default.join(process.cwd(), `kitty-debug-${timestamp}.log`);
      }

      const logEntry = `[${new Date().toISOString()}] ${message}\n`;
      fs.default.appendFileSync(debugLogFile.current, logEntry);
    } catch (error) {
      console.error('Failed to write debug log:', error);
    }
  }, [debugMode]);

  useEffect(() => {
    (async () => {
      await agent.initialize();

      // Set up tool confirmation callback
      setConfirmationCallback(async (toolName: string, input: any, details?: string) => {
        // For now, auto-approve all tools (we can add a confirmation UI later)
        return true;
      });

      setInitialized(true);
    })();
  }, []);

  // Handle keyboard input
  useInput((input, key) => {
    // Don't interfere with text input
    if (key.escape) {
      if (isProcessing && abortControllerRef.current) {
        // Cancel ongoing request
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        setIsProcessing(false);
        addMessage('system', '⚠️  Request cancelled');
      }
    } else if (key.ctrl && input === 'c') {
      const now = Date.now();
      if (now - lastCtrlCTime.current < 5000) {
        // Second Ctrl+C within 5 seconds - exit
        exit();
      } else {
        // First Ctrl+C - set timer (input field manages its own state now)
        lastCtrlCTime.current = now;
        addMessage('system', 'Press Ctrl+C again within 5 seconds to exit');
      }
    }
  });

  const addMessage = useCallback((role: Message['role'], content: string, thinkingType?: 'planning' | 'reflection' | 'decision') => {
    // Guard against null/undefined content
    const safeContent = content || '';
    const id = `msg-${Date.now()}-${messageIdCounter.current++}`;
    const newMsg = { id, role, content: safeContent, timestamp: Date.now(), thinkingType };

    logToFile(`ADD_MESSAGE: id=${id}, role=${role}, contentLength=${safeContent.length}, thinkingType=${thinkingType || 'none'}`);

    dispatch({ type: 'ADD', message: newMsg });
  }, [logToFile]);

  // Flush pending updates helper
  const flushPendingUpdate = useCallback(() => {
    if (!pendingUpdate.current) return;

    const content = pendingUpdate.current;
    pendingUpdate.current = null;

    dispatch({ type: 'UPDATE_LAST', content });

    logToFile(`UPDATE_LAST_MESSAGE: Flushed update with content length ${content.length}`);
  }, [logToFile]);

  const updateLastMessage = useCallback((content: string) => {
    const now = Date.now();
    const safeContent = content || '';

    if (safeContent.length === 0) {
      logToFile('UPDATE_LAST_MESSAGE: Ignoring empty update');
      return;
    }

    logToFile(`UPDATE_LAST_MESSAGE: contentLength=${safeContent.length}`);

    pendingUpdate.current = safeContent;

    // Throttle to 300ms for smooth terminal rendering
    const THROTTLE_DELAY = 300;

    if (now - lastUpdateTime.current < THROTTLE_DELAY) {
      if (!updateTimeout.current) {
        updateTimeout.current = setTimeout(() => {
          flushPendingUpdate();
          updateTimeout.current = null;
        }, THROTTLE_DELAY);
      }
      return;
    }

    lastUpdateTime.current = now;
    if (updateTimeout.current) {
      clearTimeout(updateTimeout.current);
      updateTimeout.current = null;
    }

    flushPendingUpdate();
  }, [logToFile, flushPendingUpdate]);

  const addTask = useCallback((description: string): string => {
    const id = `task-${Date.now()}-${Math.random()}`;
    setTasks(prev => [...prev, { id, description, completed: false }]);
    return id;
  }, []);

  const completeTask = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: true } : t));
  }, []);

  const clearTasks = useCallback(() => {
    setTasks([]);
  }, []);

  const handleCommand = useCallback(async (command: string) => {
    const cmd = command.toLowerCase().trim();

    if (cmd === '/help') {
      addMessage('system', `Available Commands:
/help - Show this help message
/clear - Clear conversation history
/models - List available models
/agents - Manage agents
/plugins - Manage plugins

Keyboard Shortcuts:
ESC - Cancel ongoing request
Ctrl+C (twice) - Exit application`);
    } else if (cmd === '/clear') {
      agent.clearHistory();
      dispatch({ type: 'CLEAR' });
      addMessage('system', 'Conversation cleared');
    } else {
      addMessage('system', `Unknown command: ${command}`);
    }
  }, [agent, addMessage]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isProcessing) return;

    setIsProcessing(true);
    streamStartTime.current = Date.now();
    streamTokenCount.current = 0;

    addMessage('user', trimmed);
    logToFile(`USER: ${trimmed}`);

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed);
      setIsProcessing(false);
      return;
    }

    try {
      let fullResponse = '';
      let assistantMessageAdded = false;
      let currentTaskId: string | null = null;

      abortControllerRef.current = new AbortController();

      const chatPromise = agent.chat(
        trimmed,
        // Text streaming callback
        (text: string) => {
          if (!text) return; // Do not process empty chunks
          fullResponse += text;
          logToFile(`STREAM_CHUNK: +${text.length} chars, total=${fullResponse.length}`);

          if (!assistantMessageAdded) {
            logToFile(`ASSISTANT_FIRST_MSG: Creating assistant message with ${fullResponse.length} chars`);
            addMessage('assistant', fullResponse);
            assistantMessageAdded = true;
          } else {
            updateLastMessage(fullResponse);
          }
        },
        // Tool call callback
        (tool: any) => {
          const taskDesc = `${tool.name}${tool.input?.path ? `: ${tool.input.path}` : ''}`;
          currentTaskId = addTask(taskDesc);
        },
        // Tool result callback
        (result: any) => {
          if (currentTaskId) {
            completeTask(currentTaskId);
            currentTaskId = null;
          }
        },
        // Waiting callback
        () => { },
        // Thinking callback
        (step: any) => {
          if (step && step.content) {
            logToFile(`THINKING: type=${step.type}, content="${step.content.substring(0, 100)}"`);
            addMessage('thinking', step.content, step.type);
          }
        }
      );

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out after 60 seconds')), 60000)
      );

      await Promise.race([chatPromise, timeoutPromise]);

      // If no response was received, show a message
      if (!assistantMessageAdded) {
        logToFile('CHAT_COMPLETE: No response was received from AI');
        addMessage('system', 'No response received from AI');
      } else {
        logToFile(`CHAT_COMPLETE: Response completed, final length: ${fullResponse.length}`);
        logToFile(`FINAL_RESPONSE: ${fullResponse}`);

        // Force one final update to ensure we have the complete response
        // This bypasses throttling to guarantee the last content is shown
        if (fullResponse.length > 0) {
          dispatch({ type: 'UPDATE_LAST', content: fullResponse });
          logToFile(`FINAL_UPDATE: Forced final update with ${fullResponse.length} chars`);
        }

        // Update token count after response completes
        const finalUsage = agent.getTokenUsage();
        const contextTokenCount = agent.getProjectContext()?.content
          ? agent.getTokenManager().countMessageTokens({
            role: 'system',
            content: agent.getProjectContext()?.content || ''
          })
          : 0;
        setLastTokenCount({
          session: finalUsage.currentTokens,
          total: finalUsage.currentTokens + contextTokenCount
        });
      }

      // Clear tasks after a delay
      if (tasks.length > 0) {
        setTimeout(() => clearTasks(), 2000);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        const errorMsg = error.message || String(error);
        const errorStack = error.stack || '';
        logToFile(`ERROR: ${errorMsg}\nStack: ${errorStack}`);
        addMessage('system', `Error: ${errorMsg}`);
        console.error('Chat error:', error);
      } else {
        logToFile('CHAT_ABORTED: User cancelled the request');
      }
    } finally {
      logToFile(`CHAT_END: isProcessing=${isProcessing}, messages.length=${messages.length}`);

      // Flush any pending updates to ensure the last chunk is rendered
      flushPendingUpdate();

      // Clear any pending update timeouts
      if (updateTimeout.current) {
        clearTimeout(updateTimeout.current);
        updateTimeout.current = null;
        logToFile('CLEANUP: Cleared pending update timeout');
      }

      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  }, [isProcessing, messages.length, agent, addMessage, updateLastMessage, logToFile, addTask, completeTask, clearTasks, tasks.length, handleCommand]);

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const isStreaming = isProcessing && lastMessage?.role === 'assistant';

  const staticMessages = useMemo(() => {
    const msgs = messages.slice(-50);
    return isStreaming ? msgs.slice(0, -1) : msgs;
  }, [messages, isStreaming]);

  const streamingMessage = useMemo(() => {
    return isStreaming ? lastMessage : null;
  }, [isStreaming, lastMessage]);


  if (!initialized) {
    return (
      <Box padding={1}>
        <Text>Initializing...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {/* Messages area */}
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          {/* Render static messages */}
          {staticMessages.length > 0 && (
            <Static items={staticMessages}>
              {(msg) => (
                <Box key={msg.id} flexDirection="column" marginBottom={1}>
                  <MessageItem msg={msg} debugMode={debugMode} />
                </Box>
              )}
            </Static>
          )}
          {/* Render streaming message */}
          {streamingMessage && (
            <Box key={streamingMessage.id} flexDirection="column" marginBottom={1}>
              <MessageItem msg={streamingMessage} debugMode={debugMode} />
            </Box>
          )}
        </Box>
      </Box>

      <Box flexDirection="column" flexShrink={0}>
        {/* Task view - positioned above input */}
        {tasks.length > 0 && debugMode && (
          <Box marginX={2} marginBottom={1}>
            <TaskList tasks={tasks} />
          </Box>
        )}

        {/* Input field using CommandInput component */}
        <Box key={`input-${layoutKey}`}>
          <CommandInput
            onSubmit={handleSubmit}
            placeholder={isProcessing ? "Processing..." : "Type your message..."}
            isDisabled={isProcessing}
          />
        </Box>

        {/* Token count under input field */}
        <Box paddingX={2} paddingBottom={1}>
          <Text dimColor color="gray">
            Session: {lastTokenCount.session.toLocaleString()} tokens • Total: {lastTokenCount.total.toLocaleString()} tokens
          </Text>
        </Box>

        {/* Footer help text */}
        <Box paddingX={2} paddingBottom={1}>
          <Text dimColor>
            ESC: Cancel • Ctrl+C (x2): Exit • /help: Commands
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
