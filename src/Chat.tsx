import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  role: 'user' | 'assistant' | 'system' | 'thinking';
  content: string;
  timestamp: number;
  thinkingType?: 'planning' | 'reflection' | 'decision';
}

interface ChatProps {
  agent: AIAgent;
  debugMode?: boolean;
}

// Memoized message component to prevent re-rendering on input changes
const MessageItem = React.memo(({ msg, debugMode }: { msg: Message; debugMode: boolean }) => {
  const content = msg.content || '';
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
        <Text color={color} dimColor={isThinking}>{content}</Text>
      ) : (
        debugMode && <Text dimColor>(no content - {content.length} chars)</Text>
      )}
    </Box>
  );
});
MessageItem.displayName = 'MessageItem';

export function Chat({ agent, debugMode = false }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Welcome to KITTY! 🐱\nType your message below or /help for commands',
      timestamp: Date.now(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [tokenSpeed, setTokenSpeed] = useState<number>(0);
  const [lastTokenCount, setLastTokenCount] = useState<{ session: number; total: number }>({ session: 0, total: 0 });
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
        input && setInput("");
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

    setMessages(prev => {
      const updated = [...prev, newMsg];
      logToFile(`MESSAGES_STATE: count=${updated.length}, last=${updated[updated.length - 1]?.role}`);
      return updated;
    });
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

    if (now - lastUpdateTime.current < 120) {
      if (!updateTimeout.current) {
        updateTimeout.current = setTimeout(() => {
          const pendingContent = pendingUpdate.current;
          if (pendingContent) {
            setMessages(prev => {
              if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') {
                return prev;
              }
              const newMessages = [...prev];
              newMessages[newMessages.length - 1] = {
                ...newMessages[newMessages.length - 1],
                content: pendingContent,
              };
              return newMessages;
            });
          }
          updateTimeout.current = null;
        }, 120);
      }
      return;
    }

    lastUpdateTime.current = now;
    if (updateTimeout.current) {
      clearTimeout(updateTimeout.current);
      updateTimeout.current = null;
    }

    setMessages(prev => {
      if (prev.length === 0 || prev[prev.length - 1].role !== 'assistant') {
        logToFile('UPDATE_LAST_MESSAGE: No assistant message to update.');
        return prev;
      }
      const newMessages = [...prev];
      newMessages[newMessages.length - 1] = {
        ...newMessages[newMessages.length - 1],
        content: safeContent,
      };
      logToFile(`UPDATE_LAST_MESSAGE: Updated last message with content length ${safeContent.length}`);
      return newMessages;
    });
  }, [logToFile]);

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
      setMessages([]);
      addMessage('system', 'Conversation cleared');
    } else {
      addMessage('system', `Unknown command: ${command}`);
    }
  }, [agent, addMessage, setMessages]);

  const handleSubmit = useCallback(async (value: string) => {

    const trimmed = value.trim();

    if (!trimmed || isProcessing) return;



    // Clear input immediately

    setInput('');



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



      await agent.chat(

        trimmed,

        // Text streaming callback

        (text: string) => {

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

          setMessages(prev => {

            const newMessages = [...prev];

            let lastAssistantIdx = -1;

            for (let i = newMessages.length - 1; i >= 0; i--) {

              if (newMessages[i].role === 'assistant') {

                lastAssistantIdx = i;

                break;

              }

            }

            if (lastAssistantIdx !== -1) {

              newMessages[lastAssistantIdx] = {

                ...newMessages[lastAssistantIdx],

                content: fullResponse

              };

              logToFile(`FINAL_UPDATE: Forced final update with ${fullResponse.length} chars`);

            }

            return newMessages;

          });

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

        // Show full error details for debugging

        const errorMsg = error.message || String(error);

        const errorStack = error.stack || '';

        logToFile(`ERROR: ${errorMsg}\nStack: ${errorStack}`);

        addMessage('system', `Error: ${errorMsg}`);



        // Log full error to help debug

        console.error('Chat error:', error);

      } else {

        logToFile('CHAT_ABORTED: User cancelled the request');

      }

    } finally {

      logToFile(`CHAT_END: isProcessing=${isProcessing}, messages.length=${messages.length}`);



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

  // Limit visible messages to last 50
  const visibleMessages = useMemo(() => messages.slice(-50), [messages]);
  // Memoize sliced messages to prevent re-renders
  const staticMessages = useMemo(() => visibleMessages.slice(0, -1), [visibleMessages]);
  const lastMessage = useMemo(() => visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1] : null, [visibleMessages]);

  if (!initialized) {
    return (
      <Box padding={1}>
        <Text>Initializing...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1}>
        {/* Messages area */}
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <>
            {/* Render all completed messages (all but last) with Static to prevent re-renders */}
            {staticMessages.length > 0 && (
              <Static items={staticMessages}>
                {(msg) => (
                  <Box key={msg.id} flexDirection="column" marginBottom={1}>
                    <MessageItem msg={msg} debugMode={debugMode} />
                  </Box>
                )}
              </Static>
            )}
            {/* Render the last (potentially streaming) message separately */}
            {lastMessage && (
              <Box flexDirection="column" marginBottom={1}>
                <MessageItem msg={lastMessage} debugMode={debugMode} />
              </Box>
            )}
          </>
        </Box>
      </Box>

      {/* Task view - positioned above input */}
      {tasks.length > 0 && debugMode && (
        <Box marginX={2} marginBottom={1}>
          <TaskList tasks={tasks} />
        </Box>
      )}

      {/* Input field using CommandInput component */}
      <CommandInput
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        placeholder={isProcessing ? "Processing..." : "Type your message..."}
      />

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
  );
}
