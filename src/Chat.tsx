import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { AIAgent } from './agent.js';
import { setConfirmationCallback } from './tools/executor.js';

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

interface Task {
  id: string;
  description: string;
  completed: boolean;
}

interface ChatProps {
  agent: AIAgent;
  debugMode?: boolean;
}

const KITTY_ASCII = `
╦╔═╦═╗╔╦╗╔╦╗╦ ╦
╠╩╗║ ║ ║  ║ ╚╦╝
╩ ╩╩ ╩ ╩  ╩  ╩
`;

// Memoized components to prevent unnecessary re-renders
const Header = React.memo(() => (
  <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0}>
    <Text color="cyan" bold>{KITTY_ASCII.trim()}</Text>
    <Box justifyContent="center">
      <Text color="gray" dimColor>v1.0.0</Text>
    </Box>
  </Box>
));
Header.displayName = 'Header';

const Footer = React.memo(() => (
  <Box paddingX={2} paddingBottom={1}>
    <Text dimColor>
      ESC: Cancel • Ctrl+C (x2): Exit • /help: Commands
    </Text>
  </Box>
));
Footer.displayName = 'Footer';

const TaskListView = React.memo(({ tasks }: { tasks: Task[] }) => (
  <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1} marginX={2} marginBottom={1}>
    <Text color="blue" bold>Tasks:</Text>
    {tasks.map(task => (
      <Text key={task.id} color={task.completed ? 'green' : 'yellow'}>
        {task.completed ? '✓' : '○'} {task.description}
      </Text>
    ))}
  </Box>
));
TaskListView.displayName = 'TaskListView';

const TokenSummary = React.memo(({ sessionTokens, contextTokens, totalTokens, maxTokens, percentageUsed, tokenColor }: {
  sessionTokens: number;
  contextTokens: number;
  totalTokens: number;
  maxTokens: number;
  percentageUsed: number;
  tokenColor: string;
}) => (
  <Box flexDirection="column" borderStyle="single" borderColor={tokenColor as any} paddingX={1} marginX={2} marginBottom={1}>
    <Box justifyContent="space-between">
      <Text color={tokenColor as any}>
        Session: {sessionTokens.toLocaleString()} tokens
      </Text>
      <Text color="gray">
        Context: {contextTokens.toLocaleString()} tokens
      </Text>
    </Box>
    <Box justifyContent="space-between">
      <Text color={tokenColor as any}>
        Total: {totalTokens.toLocaleString()} / {maxTokens.toLocaleString()} ({percentageUsed.toFixed(1)}%)
      </Text>
    </Box>
  </Box>
));
TokenSummary.displayName = 'TokenSummary';

export function Chat({ agent, debugMode = false }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [tokenSpeed, setTokenSpeed] = useState<number>(0);
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

  // Token speed update effect - disabled to reduce flickering
  // useEffect(() => {
  //   if (isProcessing) {
  //     const interval = setInterval(() => {
  //       const elapsed = (Date.now() - streamStartTime.current) / 1000;
  //       if (elapsed > 0) {
  //         const currentUsage = agent.getTokenUsage();
  //         const speed = currentUsage.currentTokens / elapsed;
  //         setTokenSpeed(speed);
  //       }
  //     }, 200);

  //     return () => clearInterval(interval);
  //   } else {
  //     setTokenSpeed(0);
  //   }
  // }, [isProcessing, agent]);

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
        // First Ctrl+C - clear input and set timer
        lastCtrlCTime.current = now;
        setInput(''); // Clear the input field
        addMessage('system', 'Input cleared. Press Ctrl+C again within 5 seconds to exit');
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

    // Guard against null/undefined content
    const safeContent = content || '';

    // Don't process empty updates
    if (safeContent.length === 0) {
      logToFile('UPDATE_LAST_MESSAGE: Ignoring empty update');
      return;
    }

    logToFile(`UPDATE_LAST_MESSAGE: contentLength=${safeContent.length}`);

    // Store pending update
    pendingUpdate.current = safeContent;

    // Throttle updates to every 100ms for smoother streaming
    if (now - lastUpdateTime.current >= 100) {
      lastUpdateTime.current = now;
      setMessages(prev => {
        if (prev.length === 0) {
          logToFile('UPDATE_LAST_MESSAGE: No messages to update!');
          return prev;
        }
        const newMessages = [...prev];

        // Find the last assistant message (skip thinking messages)
        let lastAssistantIdx = -1;
        for (let i = newMessages.length - 1; i >= 0; i--) {
          if (newMessages[i].role === 'assistant') {
            lastAssistantIdx = i;
            break;
          }
        }

        if (lastAssistantIdx === -1) {
          logToFile('UPDATE_LAST_MESSAGE: No assistant message found to update!');
          return prev;
        }

        newMessages[lastAssistantIdx] = {
          ...newMessages[lastAssistantIdx],
          content: safeContent
        };
        logToFile(`UPDATE_LAST_MESSAGE: Updated assistant msg at ${lastAssistantIdx}, newLength=${safeContent.length}`);
        return newMessages;
      });
      pendingUpdate.current = null;

      if (updateTimeout.current) {
        clearTimeout(updateTimeout.current);
        updateTimeout.current = null;
      }
    } else if (!updateTimeout.current) {
      // Capture the content value in the closure to avoid race conditions
      const contentToUpdate = safeContent;

      // Schedule update for later
      updateTimeout.current = setTimeout(() => {
        if (contentToUpdate && contentToUpdate.length > 0) {
          lastUpdateTime.current = Date.now();
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const newMessages = [...prev];

            // Find the last assistant message (skip thinking messages)
            let lastAssistantIdx = -1;
            for (let i = newMessages.length - 1; i >= 0; i--) {
              if (newMessages[i].role === 'assistant') {
                lastAssistantIdx = i;
                break;
              }
            }

            if (lastAssistantIdx === -1) return prev;

            newMessages[lastAssistantIdx] = {
              ...newMessages[lastAssistantIdx],
              content: contentToUpdate
            };
            logToFile(`UPDATE_LAST_MESSAGE(delayed): Updated assistant msg at ${lastAssistantIdx}, newLength=${contentToUpdate.length}`);
            return newMessages;
          });
          pendingUpdate.current = null;
        }
        updateTimeout.current = null;
      }, 100);
    }
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

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

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
        () => {},
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
  };

  const handleCommand = async (command: string) => {
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
  };

  // Format message content
  // TODO: Add proper markdown rendering with Ink components later
  const formatMessage = (msg: Message): string => {
    return msg.content || '';
  };

  // Get token usage - only calculate once at startup to prevent flickering
  const initialUsage = useRef(agent.getTokenUsage());

  // Calculate context tokens once
  const getInitialContextTokens = () => {
    const context = agent.getProjectContext();
    return context?.content
      ? agent.getTokenManager().countMessageTokens({
          role: 'system',
          content: context.content
        })
      : 0;
  };
  const initialContextTokens = useRef(getInitialContextTokens());

  const sessionTokens = initialUsage.current.currentTokens;
  const totalTokens = sessionTokens + initialContextTokens.current;
  const percentageUsed = (totalTokens / initialUsage.current.maxTokens) * 100;

  // Token color based on usage
  const tokenColor = percentageUsed >= 90 ? 'red' : percentageUsed >= 70 ? 'yellow' : 'green';


  if (!initialized) {
    return (
      <Box padding={1}>
        <Text>Initializing...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header with KITTY ASCII art and version */}
      <Header />

      {/* Messages area - scrollable */}
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1} overflow="hidden">
        {messages.length === 0 ? (
          <Box flexDirection="column">
            <Text color="cyan">Welcome to KITTY! 🐱</Text>
            <Text dimColor>Type your message below or /help for commands</Text>
          </Box>
        ) : (
          messages.slice(-50).map((msg) => {
            const content = formatMessage(msg);
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
              <Box key={msg.id} flexDirection="column" marginBottom={1}>
                <Text color={color} bold={!isThinking} dimColor={isThinking}>
                  {prefix}{label}
                </Text>
                {content && content.trim().length > 0 ? (
                  <Text color={color} dimColor={isThinking}>{content}</Text>
                ) : (
                  debugMode && <Text dimColor>(no content - {msg.content?.length || 0} chars)</Text>
                )}
              </Box>
            );
          })
        )}
      </Box>

      {/* Task view - positioned above input - memoized */}
      {tasks.length > 0 && (
        <TaskListView tasks={tasks} />
      )}

      {/* Token summary - static to prevent flickering */}
      <TokenSummary
        sessionTokens={sessionTokens}
        contextTokens={initialContextTokens.current}
        totalTokens={totalTokens}
        maxTokens={initialUsage.current.maxTokens}
        percentageUsed={percentageUsed}
        tokenColor={tokenColor}
      />

      {/* Input field */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginX={2} marginBottom={1}>
        <Text color="cyan" bold>› </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isProcessing ? "Processing..." : "Type your message..."}
          showCursor={!isProcessing}
          focus={true}
        />
      </Box>

      {/* Footer help text */}
      <Footer />
    </Box>
  );
}
