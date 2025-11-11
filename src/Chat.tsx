import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface Task {
  id: string;
  description: string;
  completed: boolean;
}

interface ChatProps {
  agent: AIAgent;
}

const KITTY_ASCII = `
╦╔═╦═╗╔╦╗╔╦╗╦ ╦
╠╩╗║ ║ ║  ║ ╚╦╝
╩ ╩╩ ╩ ╩  ╩  ╩
`;

export function Chat({ agent }: ChatProps) {
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

  // Token speed update effect during streaming
  useEffect(() => {
    if (isProcessing) {
      const interval = setInterval(() => {
        const elapsed = (Date.now() - streamStartTime.current) / 1000;
        if (elapsed > 0) {
          const currentUsage = agent.getTokenUsage();
          const speed = currentUsage.currentTokens / elapsed;
          setTokenSpeed(speed);
        }
      }, 200);

      return () => clearInterval(interval);
    } else {
      setTokenSpeed(0);
    }
  }, [isProcessing, agent]);

  // Handle keyboard input
  useInput((input, key) => {
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
        // First Ctrl+C - set timer
        lastCtrlCTime.current = now;
        addMessage('system', 'Press Ctrl+C again within 5 seconds to exit');
      }
    }
  });

  const addMessage = useCallback((role: Message['role'], content: string) => {
    setMessages(prev => [...prev, { role, content, timestamp: Date.now() }]);
  }, []);

  const updateLastMessage = useCallback((content: string) => {
    const now = Date.now();

    // Store pending update
    pendingUpdate.current = content;

    // Throttle updates to every 100ms for smoother streaming
    if (now - lastUpdateTime.current >= 100) {
      lastUpdateTime.current = now;
      setMessages(prev => {
        if (prev.length === 0) return prev;
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          ...newMessages[newMessages.length - 1],
          content
        };
        return newMessages;
      });
      pendingUpdate.current = null;

      if (updateTimeout.current) {
        clearTimeout(updateTimeout.current);
        updateTimeout.current = null;
      }
    } else if (!updateTimeout.current) {
      // Schedule update for later
      updateTimeout.current = setTimeout(() => {
        if (pendingUpdate.current !== null) {
          lastUpdateTime.current = Date.now();
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = {
              ...newMessages[newMessages.length - 1],
              content: pendingUpdate.current!
            };
            return newMessages;
          });
          pendingUpdate.current = null;
        }
        updateTimeout.current = null;
      }, 100);
    }
  }, []);

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

          if (!assistantMessageAdded) {
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
        (step: any) => {}
      );

      // If no response was received, show a message
      if (!assistantMessageAdded) {
        addMessage('system', 'No response received from AI');
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
        addMessage('system', `Error: ${errorMsg}`);

        // Log full error to help debug
        console.error('Chat error:', error);
      }
    } finally {
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

  // Format message content with markdown
  const formatMessage = (msg: Message): string => {
    if (msg.role === 'assistant') {
      try {
        return marked(msg.content) as string;
      } catch {
        return msg.content;
      }
    }
    return msg.content;
  };

  // Get token usage
  const usage = agent.getTokenUsage();
  const contextTokens = agent.getProjectContext()?.content
    ? agent.getTokenManager().countMessageTokens({
        role: 'system',
        content: agent.getProjectContext()?.content || ''
      })
    : 0;

  const sessionTokens = usage.currentTokens;
  const totalTokens = sessionTokens + contextTokens;
  const percentageUsed = (totalTokens / usage.maxTokens) * 100;

  // Token color based on usage
  let tokenColor = 'green';
  if (percentageUsed >= 90) tokenColor = 'red';
  else if (percentageUsed >= 70) tokenColor = 'yellow';

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
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0}>
        <Text color="cyan" bold>{KITTY_ASCII.trim()}</Text>
        <Box justifyContent="center">
          <Text color="gray" dimColor>v1.0.0</Text>
        </Box>
      </Box>

      {/* Messages area - scrollable */}
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        {messages.length === 0 ? (
          <Box flexDirection="column">
            <Text color="cyan">Welcome to KITTY! 🐱</Text>
            <Text dimColor>Type your message below or /help for commands</Text>
          </Box>
        ) : (
          messages.slice(-15).map((msg, idx) => (
            <Box key={idx} flexDirection="column" marginBottom={1}>
              <Text color={msg.role === 'user' ? 'cyan' : msg.role === 'assistant' ? 'green' : 'yellow'} bold>
                {msg.role === 'user' ? '› ' : msg.role === 'assistant' ? '◆ ' : '• '}
                {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'KITTY' : 'System'}
              </Text>
              <Text>{formatMessage(msg)}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* Task view - positioned above input */}
      {tasks.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1} marginX={2} marginBottom={1}>
          <Text color="blue" bold>Tasks:</Text>
          {tasks.map(task => (
            <Text key={task.id} color={task.completed ? 'green' : 'yellow'}>
              {task.completed ? '✓' : '○'} {task.description}
            </Text>
          ))}
        </Box>
      )}

      {/* Token summary */}
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
          <Box>
            <Text color={tokenColor as any}>
              Total: {totalTokens.toLocaleString()} / {usage.maxTokens.toLocaleString()}
            </Text>
            <Text color={tokenColor as any}> ({percentageUsed.toFixed(1)}%)</Text>
          </Box>
          {tokenSpeed > 0 && (
            <Text color="cyan"> {tokenSpeed.toFixed(1)} tok/s</Text>
          )}
        </Box>
      </Box>

      {/* Input field */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginX={2} marginBottom={1}>
        <Text color="cyan" bold>› </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isProcessing ? "Processing..." : "Type your message..."}
          showCursor={!isProcessing}
        />
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
