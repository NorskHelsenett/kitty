import React, { useState, useEffect, useCallback, useRef, useMemo, useReducer } from 'react';
import { Box, Text, useInput, useApp, Static, useStdout } from 'ink';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import wordWrap from 'word-wrap';
import type { AIAgent } from './agent.js';
import { setConfirmationCallback } from './tools/executor.js';
import { CommandInput } from './components/CommandInput.js';
import { TaskList, Task as TaskType } from './components/TaskList.js';
import { SelectionMenu, SelectionItem } from './components/SelectionMenu.js';
import { ErrorDialog, ErrorDialogProps, getErrorDialogProps } from './components/ErrorDialog.js';
import { WarningDialog } from './components/WarningDialog.js';
import { ConfirmationPrompt } from './components/ConfirmationPrompt.js';


// Configure marked for terminal output - will be reconfigured per message with terminal width
// This is the default configuration
const getMarkedTerminalConfig = (width: number = 80) => ({
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  heading: chalk.cyan.bold,
  strong: chalk.bold,
  em: chalk.italic,
  codespan: chalk.yellow,
  link: chalk.blue.underline,
  width: width - 6, // Account for padding and prefix
  reflowText: true,
  // Compact paragraph spacing - single newline instead of double
  paragraph: (text: string) => text + '\n',
  // Simpler list formatting
  list: (body: string) => body,
  listitem: (text: string) => '  • ' + text.trimEnd() + '\n',
});

/**
 * Preprocesses markdown to ensure proper spacing:
 * - Adds newline before headers (if not already present)
 * - Removes newlines between list items
 */
function preprocessMarkdown(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : '';

    // Check if current line is a header (starts with #)
    const isHeader = /^#{1,6}\s/.test(line);

    // Add newline before headers if previous line is not empty and not already spaced
    if (isHeader && prevLine.trim() !== '' && result.length > 0) {
      // Check if we already added a blank line
      if (result[result.length - 1].trim() !== '') {
        result.push('');
      }
    }

    // Add the current line
    result.push(line);
  }

  return result.join('\n');
}

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

// Version string - updated automatically by release workflow
const APP_VERSION = 'v0.1.0';

// Initial messages shown on startup and after clear
const getInitialMessages = (modelName: string = 'Loading...', currentPath: string = ''): Message[] => [
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
Welcome to KITTY -  Your KI-powered assistant!
    ${APP_VERSION}       •        ${modelName}
${currentPath}
                                                  `,
    timestamp: Date.now(),
  },
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Welcome to KITTY! 🐱\nType your message below or /help for commands',
    timestamp: Date.now(),
  }
];

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
  const { stdout } = useStdout();
  const terminalWidth = stdout ? stdout.columns : 80;
  const contentWidth = terminalWidth - 6; // 2 paddingX on each side + 2 for prefix

  // Configure marked for this specific message with proper terminal width
  React.useEffect(() => {
    marked.use(markedTerminal(getMarkedTerminalConfig(terminalWidth)) as any);
  }, [terminalWidth]);

  if (msg.role === 'none') {
    return <Text>{msg.content}</Text>;
  }

  // Handle thinking messages separately for custom formatting
  if (msg.role === 'thinking') {
    const thinkingTags = ['think', 'reasoning', 'reason'];
    const tagPattern = new RegExp(`</?(${thinkingTags.join('|')})>`, 'g');
    const cleanContent = (msg.content || '').replace(tagPattern, '').trim();
    const wrappedContent = wordWrap(cleanContent, { width: contentWidth, indent: '' });

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="magenta" dimColor>
          ○○○ Thinking ({msg.thinkingType || 'processing'})
        </Text>
        {cleanContent && cleanContent.trim().length > 0 ? (
          <Text color="magenta" dimColor>{wrappedContent}</Text>
        ) : (
          debugMode && <Text dimColor>(no content - {msg.content.length} chars)</Text>
        )}
      </Box>
    );
  }

  // Handle assistant messages with <think> blocks and markdown formatting
  if (msg.role === 'assistant') {
    const content = (msg.content || '');

    // The welcome message is plain text and should not be parsed as Markdown.
    if (msg.id === 'welcome') {
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>● KITTY</Text>
          <Text>{content}</Text>
        </Box>
      );
    }

    // Only apply special parsing if tags are present
    if (content.includes('<think>') || content.includes('</think>')) {
      const parts = content.split(/(<\/?think>)/); // Capture delimiters
      let inThinkBlock = false; // State variable

      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>● KITTY</Text>
          <Box flexDirection="column">
            {parts.map((part, index) => {
              if (part === '<think>') {
                inThinkBlock = true;
                return null; // Hide the tag itself
              }
              if (part === '</think>') {
                inThinkBlock = false;
                return null; // Hide the tag itself
              }
              if (!part) return null; // Handle empty parts from split

              // For thinking parts, don't apply markdown - just wrap and dim
              if (inThinkBlock) {
                const wrappedPart = wordWrap(part, { width: contentWidth, indent: '' });
                return <Text key={index} color="green" dimColor>{wrappedPart}</Text>;
              }

              // For non-thinking parts, apply markdown formatting
              const processedPart = preprocessMarkdown(part);
              const renderedPart = marked.parse(processedPart, { async: false }) as string;
              return <Text key={index}>{renderedPart}</Text>;
            })}
          </Box>
        </Box>
      );
    }

    // For assistant messages without <think> blocks, apply markdown formatting
    const processedContent = preprocessMarkdown(content);
    const renderedContent = marked.parse(processedContent, { async: false }) as string;

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="green" bold>● KITTY</Text>
        {renderedContent && renderedContent.trim().length > 0 ? (
          <Text>{renderedContent}</Text>
        ) : (
          debugMode && <Text dimColor>(no content - {content.length} chars)</Text>
        )}
      </Box>
    );
  }

  // Handle user and system messages (assistant messages are handled above)
  const content = (msg.content || '').replace(/\n+/g, '\n');
  const wrappedContent = wordWrap(content, { width: contentWidth, indent: '' });
  const color = msg.role === 'user' ? 'cyan' : 'yellow';
  const prefix = msg.role === 'user' ? '› ' : '• ';
  const label = msg.role === 'user' ? 'You' : 'System';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {prefix}{label}
      </Text>
      {content && content.trim().length > 0 ? (
        <Text color={color}>{wrappedContent}</Text>
      ) : (
        debugMode && <Text dimColor>(no content - {content.length} chars)</Text>
      )}
    </Box>
  );
});
MessageItem.displayName = 'MessageItem';

export function Chat({ agent, debugMode = false }: ChatProps) {
  const [messages, dispatch] = useReducer(messagesReducer, getInitialMessages());
  const [isProcessing, setIsProcessing] = useState(false);
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [tokenSpeed, setTokenSpeed] = useState<number>(0);
  const [lastTokenCount, setLastTokenCount] = useState<{ session: number; total: number }>({ session: 0, total: 0 });
  const [layoutKey, setLayoutKey] = useState(0);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelItems, setModelItems] = useState<SelectionItem[]>([]);
  const [messagesInitialized, setMessagesInitialized] = useState(false);
  const [clearInputField, setClearInputField] = useState(false);
  const [errorDialog, setErrorDialog] = useState<ErrorDialogProps | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<any>(null);
  const [allowedCommands, setAllowedCommands] = useState(new Set<string>());
  const { exit } = useApp();

  // Keyboard control state
  const lastCtrlCTime = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showExitPrompt, setShowExitPrompt] = useState(false);

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
      try {
        const result = await agent.initialize();

        // Set up tool confirmation callback
        setConfirmationCallback(async (toolName: string, input: any, details?: string) => {
          const commandKey = `${toolName}:${JSON.stringify(input)}`;
          if (allowedCommands.has(commandKey)) {
            return true;
          }

          return new Promise<boolean>((resolve) => {
            const message = `The AI is requesting to execute the following tool:`;
            const fullDetails = `Tool: ${toolName}\nInput: ${JSON.stringify(input, null, 2)}\n\n${details || ''}`;

            setConfirmation({
              title: 'Tool Execution Request ',
              message,
              details: fullDetails,
              onAllow: () => {
                setConfirmation(null);
                resolve(true);
              },
              onAllowAndRemember: () => {
                setConfirmation(null);
                setAllowedCommands(prev => new Set(prev).add(commandKey));
                resolve(true);
              },
              onExplain: () => {
                setConfirmation(null);
                addMessage('system', `The AI wanted to run the tool '${toolName}'. You can now guide the AI to do something different.`);
                resolve(false);
              },
              onDeny: () => {
                setConfirmation(null);
                resolve(false);
              },
            });
          });
        });

        // Update the header message with actual model name and current path
        if (!messagesInitialized) {
          const modelName = agent.getCurrentModel();
          const currentPath = process.cwd();

          const updatedMessages = getInitialMessages(modelName, currentPath);

          // Clear existing messages and add the new ones with proper information
          dispatch({ type: 'CLEAR' });
          updatedMessages.forEach(msg => {
            dispatch({ type: 'ADD', message: msg });
          });

          // Show any initialization warnings in a floating dialog
          if (result.warnings && result.warnings.length > 0) {
            // Combine all warnings into one message
            const warningText = result.warnings.join('\n\n');
            setWarningMessage(warningText);
          }

          setMessagesInitialized(true);
        }

        setInitialized(true);
      } catch (error) {
        // Show error dialog if initialization fails completely
        const errorProps = getErrorDialogProps(error);
        errorProps.onClose = () => {
          setErrorDialog(null);
          // Exit the app after closing the error dialog on initialization failure
          exit();
        };
        setErrorDialog(errorProps);
        setInitialized(true); // Set to true to render the error dialog
      }
    })();
  }, [messagesInitialized, exit]);

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
      if (now - lastCtrlCTime.current < 2000) {
        // Second Ctrl+C within 2 seconds - exit the app
        exit();
        // Also explicitly exit the process to ensure clean shutdown
        setTimeout(() => process.exit(0), 50);
      } else {
        // First Ctrl+C - set timer, show prompt, and clear input field
        lastCtrlCTime.current = now;
        setShowExitPrompt(true);
        setClearInputField(true);
        // Reset the clear flag after a moment
        setTimeout(() => setClearInputField(false), 100);
      }
    }
  });

  // Effect to auto-hide exit prompt after 5 seconds
  useEffect(() => {
    if (showExitPrompt) {
      const timeout = setTimeout(() => {
        setShowExitPrompt(false);
      }, 2000);

      return () => clearTimeout(timeout);
    }
  }, [showExitPrompt]);

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

  const handleModelSelection = useCallback(async (selectedIds: string[]) => {
    if (selectedIds.length > 0) {
      const selectedModel = selectedIds[0];
      try {
        await agent.setModel(selectedModel);
        addMessage('system', `Model changed to: ${selectedModel}`);
      } catch (error) {
        const errorProps = getErrorDialogProps(error);
        errorProps.onClose = () => setErrorDialog(null);
        setErrorDialog(errorProps);
      }
    }
    setShowModelMenu(false);
  }, [agent, addMessage]);

  const handleModelMenuCancel = useCallback(() => {
    setShowModelMenu(false);
  }, []);

  const handleCommand = useCallback(async (command: string) => {
    const cmd = command.toLowerCase().trim();

    if (cmd === '/help') {
      addMessage('system', `Available Commands:
/help - Show this help message
/model - Select AI model to use
/agents - Manage agents
/plugins - Manage plugins

Keyboard Shortcuts:
ESC - Cancel ongoing request
Ctrl+C (twice) - Exit application`);
    } else if (cmd === '/model') {
      // Fetch available models
      try {
        const models = await agent.listAvailableModels();
        const currentModel = agent.getCurrentModel();
        const items: SelectionItem[] = models.map(model => ({
          id: model.id,
          name: model.id,
          description: model.owned_by || 'AI Model',
          enabled: model.id === currentModel
        }));
        setModelItems(items);
        setShowModelMenu(true);
      } catch (error) {
        const errorProps = getErrorDialogProps(error);
        errorProps.onClose = () => setErrorDialog(null);
        setErrorDialog(errorProps);
      }
    } else {
      addMessage('system', `Unknown command: ${command}`);
    }
  }, [agent, addMessage]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isProcessing) return;

    // Hide exit prompt if user submits a new prompt
    setShowExitPrompt(false);

    // Clear completed tasks when starting a new query
    const allTasksCompleted = tasks.length > 0 && tasks.every(t => t.completed);
    if (allTasksCompleted) {
      clearTasks();
    }

    setIsProcessing(true);
    streamStartTime.current = Date.now();
    streamTokenCount.current = 0;

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      logToFile(`COMMAND: ${trimmed}`);
      await handleCommand(trimmed);
      setIsProcessing(false);
      return;
    }

    addMessage('user', trimmed);
    logToFile(`USER: ${trimmed}`);

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
          // Create more descriptive task names
          let taskDesc = '';
          const input = tool.input || {};

          if (tool.name === 'execute_command') {
            taskDesc = `Running: ${input.command || 'command'}`;
          } else if (tool.name === 'read_file') {
            taskDesc = `Reading: ${input.path || 'file'}`;
          } else if (tool.name === 'write_file') {
            taskDesc = `Writing: ${input.path || 'file'}`;
          } else if (tool.name === 'search') {
            taskDesc = `Searching: ${input.query || input.pattern || 'code'}`;
          } else if (input.path) {
            taskDesc = `${tool.name}: ${input.path}`;
          } else if (input.command) {
            taskDesc = `${tool.name}: ${input.command}`;
          } else {
            taskDesc = tool.name;
          }

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

        // Show error dialog instead of just adding a system message
        const errorProps = getErrorDialogProps(error);
        errorProps.onClose = () => setErrorDialog(null);
        setErrorDialog(errorProps);

        // Don't log to console - error is shown in the UI dialog
        // console.error('Chat error:', error);
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
  }, [isProcessing, messages.length, agent, addMessage, updateLastMessage, logToFile, addTask, completeTask, clearTasks, tasks, handleCommand]);

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

  // Show warning dialog if there's a warning
  if (warningMessage) {
    return (
      <WarningDialog
        title="Connection Warning"
        message={warningMessage}
        onClose={() => setWarningMessage(null)}
      />
    );
  }

  // Show confirmation prompt if there's a confirmation request
  if (confirmation) {
    return <ConfirmationPrompt {...confirmation} />;
  }

  // Show error dialog if there's an error
  if (errorDialog) {
    return <ErrorDialog {...errorDialog} />;
  }

  // Show model selection menu if requested
  if (showModelMenu) {
    return (
      <SelectionMenu
        title="Select AI Model"
        items={modelItems}
        onSubmit={handleModelSelection}
        onCancel={handleModelMenuCancel}
        singleSelect={true}
      />
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
        {tasks.length > 0 && (
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
            clearInput={clearInputField}
          />
        </Box>

        {/* Exit prompt - shown when Ctrl+C is pressed once */}
        {showExitPrompt && (
          <Box paddingX={2} paddingBottom={1}>
            <Text color="yellow">
              Press Ctrl+C again within 2 seconds to exit
            </Text>
          </Box>
        )}

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
