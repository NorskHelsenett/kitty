import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp, useStdout, Static } from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { AIAgent } from './agent.js';
import type { ThinkingStep } from './orchestrator.js';

// Configure marked for terminal output
marked.use(markedTerminal({
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  html: chalk.gray,
  heading: chalk.green.bold,
  firstHeading: chalk.magenta.bold,
  hr: chalk.reset,
  listitem: chalk.reset,
  table: chalk.reset,
  paragraph: chalk.reset,
  strong: chalk.bold,
  em: chalk.italic,
  codespan: chalk.yellow,
  del: chalk.dim.strikethrough,
  link: chalk.blue,
  href: chalk.blue.underline,
}) as any);

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'tool_result' | 'error' | 'thinking';
  content: string;
}

interface ChatProps {
  agent: AIAgent;
  debugMode?: boolean;
}

export function Chat({ agent, debugMode = false }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [thinkingStep, setThinkingStep] = useState<ThinkingStep | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [tokenSpeed, setTokenSpeed] = useState<number>(0);
  const [lastTokenSpeed, setLastTokenSpeed] = useState<number>(0);
  const [streamStartTime, setStreamStartTime] = useState<number>(0);
  const [streamTokenCount, setStreamTokenCount] = useState<number>(0);
  const [catFrame, setCatFrame] = useState(0);
  const { exit } = useApp();
  const { stdout } = useStdout();
  
  // Use refs for throttling to reduce flickering
  const lastUpdateTimeRef = useRef<number>(0);
  const pendingUpdateRef = useRef<string | null>(null);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokenUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cat animation effect - only when processing
  useEffect(() => {
    if (isProcessing) {
      const interval = setInterval(() => {
        setCatFrame(prev => (prev + 1) % 4);
      }, 400);
      
      return () => clearInterval(interval);
    }
  }, [isProcessing]);

  // Token speed update effect - runs during processing
  useEffect(() => {
    if (isProcessing) {
      tokenUpdateIntervalRef.current = setInterval(() => {
        const elapsed = (Date.now() - streamStartTime) / 1000;
        if (elapsed > 0) {
          const currentUsage = agent.getTokenUsage();
          setStreamTokenCount(currentUsage.currentTokens);
          const speed = currentUsage.currentTokens / elapsed;
          setTokenSpeed(speed);
        }
      }, 200); // Update every 200ms
      
      return () => {
        if (tokenUpdateIntervalRef.current) {
          clearInterval(tokenUpdateIntervalRef.current);
          tokenUpdateIntervalRef.current = null;
        }
      };
    } else {
      if (tokenUpdateIntervalRef.current) {
        clearInterval(tokenUpdateIntervalRef.current);
        tokenUpdateIntervalRef.current = null;
      }
      // Save the last speed before resetting
      if (tokenSpeed > 0) {
        setLastTokenSpeed(tokenSpeed);
      }
      setTokenSpeed(0);
    }
  }, [isProcessing, streamStartTime, agent]);

  useEffect(() => {
    (async () => {
      await agent.initialize();
      const context = agent.getProjectContext();
      
      const welcomeMsg = 'Welcome to AI Chat Agent! 🤖\n\nI can help you with:\n• File operations (ls, cat, grep, find)\n• Git commands\n• Code analysis\n• And general questions!\n\nType your message and press Enter. Press Esc or Ctrl+C to exit.\nType /help for available commands.';
      
      if (context?.hasKittyMd) {
        setMessages([
          { role: 'system', content: '✅ Loaded project context from KITTY.md' },
          { role: 'system', content: welcomeMsg }
        ]);
      } else {
        setMessages([
          { role: 'system', content: 'ℹ️  No KITTY.md found. Type \'/init\' to create one for better project-aware assistance.' },
          { role: 'system', content: welcomeMsg }
        ]);
      }
      setInitialized(true);
    })();
  }, []);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  const addMessage = useCallback((role: Message['role'], content: string) => {
    setMessages(prev => [...prev, { role, content }]);
  }, []);

  const updateLastMessage = useCallback((content: string) => {
    const now = Date.now();
    
    // Store the pending update
    pendingUpdateRef.current = content;
    
    // If enough time has passed, update immediately
    if (now - lastUpdateTimeRef.current >= 100) {
      lastUpdateTimeRef.current = now;
      setMessages(prev => {
        if (prev.length === 0) return prev;
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].content = content;
        return newMessages;
      });
      pendingUpdateRef.current = null;
      
      // Clear any pending timeout
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
    } else if (!updateTimeoutRef.current) {
      // Schedule an update for later
      updateTimeoutRef.current = setTimeout(() => {
        if (pendingUpdateRef.current !== null) {
          lastUpdateTimeRef.current = Date.now();
          setMessages(prev => {
            if (prev.length === 0) return prev;
            const newMessages = [...prev];
            newMessages[newMessages.length - 1].content = pendingUpdateRef.current!;
            return newMessages;
          });
          pendingUpdateRef.current = null;
        }
        updateTimeoutRef.current = null;
      }, 100);
    }
  }, []);

  const updateMessageAtIndex = useCallback((index: number, content: string) => {
    setMessages(prev => {
      const newMessages = [...prev];
      if (newMessages[index]) {
        newMessages[index].content = content;
      }
      return newMessages;
    });
  }, []);

  const handleCommand = async (command: string): Promise<void> => {
    const cmd = command.toLowerCase().trim();

    if (cmd === '/init' || cmd === '/reinit') {
      const { kittyMdExists } = await import('./project-context.js');
      const exists = kittyMdExists();
      
      if (exists && cmd === '/init') {
        addMessage('system', '⚠️  KITTY.md already exists. Use /reinit to regenerate it.');
        return;
      }

      if (cmd === '/reinit' && exists) {
        addMessage('system', '🔄 Regenerating KITTY.md (deleting old version)...');
        try {
          const fs = await import('fs');
          const path = await import('path');
          const kittyPath = path.default.join(process.cwd(), 'KITTY.md');
          fs.default.unlinkSync(kittyPath);
          addMessage('system', '🗑️  Old KITTY.md deleted. Starting fresh analysis...');
        } catch (e) {
          addMessage('system', `⚠️  Could not delete old KITTY.md: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        addMessage('system', '📝 Generating KITTY.md by analyzing your project...');
      }

      const analysisPrompt = `Analyze this project and create a KITTY.md file that documents it.

KITTY.md should include:
1. Project Overview (name, description, tech stack)
2. Commands (from package.json scripts)
3. File Boundaries (what's safe to edit vs. never touch)
4. Coding Rules (from configs like tsconfig.json)
5. Code Examples (snippets showing good patterns)

Read the necessary files (package.json, README.md, src files, configs), then write KITTY.md with all the information.

Important: Use the write_file tool to create KITTY.md with complete content, not placeholders.`;

      setIsProcessing(true);
      setStatus('Processing...');
      setStreamStartTime(Date.now());
      setStreamTokenCount(0);

      try {
        let fullResponse = '';
        let assistantMessageAdded = false;

        await agent.chat(
          analysisPrompt,
          (text: string) => {
            fullResponse += text;
            if (!assistantMessageAdded) {
              addMessage('assistant', fullResponse);
              assistantMessageAdded = true;
              setStreamStartTime(Date.now());
            } else {
              updateLastMessage(fullResponse);
            }
          },
          (tool: any) => {
            if (tool.name === 'write_file' && tool.input?.path === 'KITTY.md') {
              addMessage('system', `📝 Writing KITTY.md with ${tool.input.content?.length || 0} characters...`);
            } else if (debugMode) {
              addMessage('tool', `🔧 Using tool: ${tool.name}\n${JSON.stringify(tool.input, null, 2)}`);
            }
            setStatus(`Executing tool: ${tool.name}...`);
          },
          (result: any) => {
            setStatus('Processing tool results...');
            
            try {
              const parsed = typeof result === 'string' ? JSON.parse(result) : result;
              if (parsed.tool === 'write_file' && parsed.markdown?.includes('KITTY.md')) {
                addMessage('system', `✅ ${parsed.markdown}`);
              } else if (debugMode) {
                const preview = typeof result === 'string' 
                  ? result.slice(0, 200) + (result.length > 200 ? '...' : '')
                  : JSON.stringify(result, null, 2);
                addMessage('tool_result', `✅ Tool result:\n${preview}`);
              }
            } catch (e) {
              if (debugMode) {
                const preview = typeof result === 'string' 
                  ? result.slice(0, 200) + (result.length > 200 ? '...' : '')
                  : JSON.stringify(result, null, 2);
                addMessage('tool_result', `✅ Tool result:\n${preview}`);
              }
            }
          },
          () => {
            setStatus('Waiting for AI to analyze results...');
          },
          (step) => {
            if (debugMode) {
              const emoji = step.type === 'planning' ? '🤔' : step.type === 'reflection' ? '🔍' : '💡';
              addMessage('thinking', `${emoji} ${step.type.toUpperCase()}: ${step.content}`);
            }
            setThinkingStep(step);
          }
        );

        await agent.initialize();
        const context = agent.getProjectContext();
        if (context?.hasKittyMd) {
          addMessage('system', '✅ KITTY.md created and loaded! The AI now has project context.');
        } else {
          addMessage('system', '⚠️  KITTY.md may not have been created. Check the AI response above.');
        }

      } catch (error: any) {
        addMessage('error', `Failed to generate KITTY.md: ${error.message}`);
      } finally {
        setIsProcessing(false);
        setStatus('Ready');
        setThinkingStep(null);
        setTokenSpeed(0);
      }

    } else if (cmd === '/help') {
      addMessage('system', `Available Commands:
- /init - Create a KITTY.md file for project context
- /reinit - Regenerate KITTY.md (overwrites existing)
- /help - Show this help message
- /clear - Clear conversation history

About KITTY.md:
This file provides persistent project context to the AI agent.`);
    } else if (cmd === '/clear') {
      agent.clearHistory();
      setMessages([]);
      addMessage('system', '🗑️  Conversation history cleared.');
    } else {
      addMessage('system', `Unknown command: ${command}\nType '/help' for available commands.`);
    }
  };

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isProcessing) return;

    setInput('');
    setIsProcessing(true);
    setStatus('Processing...');
    setStreamStartTime(Date.now());
    setStreamTokenCount(0);

    addMessage('user', trimmed);

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed);
      setIsProcessing(false);
      setStatus('Ready');
      return;
    }

    try {
      let fullResponse = '';
      let toolCalls: any[] = [];
      let assistantMessageAdded = false;

      await agent.chat(
        trimmed,
        (text: string) => {
          fullResponse += text;
          
          if (!assistantMessageAdded) {
            addMessage('assistant', fullResponse);
            assistantMessageAdded = true;
            setStreamStartTime(Date.now());
          } else {
            updateLastMessage(fullResponse);
          }
          
          setStatus('AI responding...');
        },
        (tool: any) => {
          toolCalls.push(tool);
          if (debugMode) {
            addMessage('tool', `� Using tool: ${tool.name}\n${JSON.stringify(tool.input, null, 2)}`);
          }
          setStatus(`tool: ${tool.name}`);
        },
        (result: any) => {
          setStatus('Processing tool results...');
          
          if (!debugMode) return;
          
          try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            if (parsed.markdown) {
              addMessage('tool_result', `✅ Tool result (${parsed.tool}):\n\n${parsed.markdown}`);
            } else {
              const preview = typeof result === 'string' 
                ? result.slice(0, 200) + (result.length > 200 ? '...' : '')
                : JSON.stringify(result, null, 2);
              addMessage('tool_result', `✅ Tool result:\n${preview}`);
            }
          } catch (e) {
            const preview = typeof result === 'string' 
              ? result.slice(0, 200) + (result.length > 200 ? '...' : '')
              : JSON.stringify(result, null, 2);
            addMessage('tool_result', `✅ Tool result:\n${preview}`);
          }
        },
        () => {
          setStatus('Waiting for AI to analyze results...');
        },
        (step: ThinkingStep) => {
          if (debugMode) {
            const emoji = step.type === 'planning' ? '🤔' : step.type === 'reflection' ? '🔍' : '💡';
            addMessage('thinking', `${emoji} ${step.type.toUpperCase()}: ${step.content}`);
          }
          setThinkingStep(step);
        }
      );

      if (!fullResponse && toolCalls.length > 0) {
        addMessage('assistant', '✓ Task completed using tools.');
      }

    } catch (error: any) {
      addMessage('error', `Error: ${error.message}`);
    } finally {
      setIsProcessing(false);
      setStatus('Ready');
      setThinkingStep(null);
      setTokenSpeed(0);
    }
  };

  // Format messages - only show last 20
  const formattedMessages = messages.slice(-20).map((msg) => {
    if (msg.role === 'assistant') {
      try {
        return { ...msg, formatted: marked(msg.content) as string };
      } catch (e) {
        return { ...msg, formatted: msg.content };
      }
    }
    return { ...msg, formatted: msg.content };
  });

  // Get token usage info
  const usage = agent.getTokenUsage();
  const tokenManager = agent.getTokenManager();
  const usageText = tokenManager.formatUsage(usage);
  const usageColor = tokenManager.getUsageColor(usage);
  
  let tokenIcon = '●';
  if (usage.percentageUsed >= 90) {
    tokenIcon = '⚠';
  } else if (usage.percentageUsed >= 70) {
    tokenIcon = '◐';
  }

  const getKittyAnimation = () => {
    const animations = [
      '=^._.^= ∫',
      '=^._.^=ノ',
      '=^•ﻌ•^=',
      '=^..^=',
    ];
    return animations[catFrame];
  };

  const getActivityDescription = (step: { type: string; content: string }): string => {
    const { type, content } = step;
    
    if (type === 'planning') {
      if (content.includes('task planning')) return 'deciding approach';
      if (content.includes('Creating a task plan')) return 'planning tasks';
      return 'thinking';
    }
    
    if (type === 'reflection') {
      if (content.includes('Analyzing task results')) return 'reviewing results';
      return 'reflecting';
    }
    
    if (type === 'decision') {
      if (content.includes('Not complete yet')) return 'adapting plan';
      if (content.includes('complete')) return 'finalizing';
      return 'deciding';
    }
    
    return type;
  };

  const getStatusText = () => {
    const kitty = getKittyAnimation();
    
    if (isProcessing) {
      if (thinkingStep) {
        const activity = getActivityDescription(thinkingStep);
        return `${kitty} ${activity}`;
      } else {
        if (status.includes('tool:')) {
          const toolName = status.split(':')[1]?.trim() || '';
          return `${kitty} using ${toolName}`;
        } else if (status.toLowerCase().includes('processing')) {
          return `${kitty} processing`;
        } else if (status.toLowerCase().includes('responding')) {
          return `${kitty} responding`;
        } else {
          return `${kitty} ${status.toLowerCase()}`;
        }
      }
    } else {
      return `${kitty} ${status}`;
    }
  };

  const getMessageColor = (role: string) => {
    switch (role) {
      case 'user': return 'cyan';
      case 'assistant': return 'magenta';
      case 'system': return 'yellow';
      case 'tool': return 'blue';
      case 'tool_result': return 'green';
      case 'thinking': return 'gray';
      case 'error': return 'red';
      default: return 'white';
    }
  };

  const getMessagePrefix = (role: string) => {
    switch (role) {
      case 'user': return 'You: ';
      case 'assistant': return 'AI: ';
      case 'system': return 'System: ';
      case 'error': return 'Error: ';
      default: return '';
    }
  };

  const terminalHeight = stdout?.rows || 24;

  if (!initialized) {
    return (
      <Box padding={1}>
        <Text>Initializing...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Messages area - use Static for completed messages to reduce re-renders */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {formattedMessages.length > 1 && (
          <Static items={formattedMessages.slice(0, -1)}>
            {(msg, idx) => (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                {getMessagePrefix(msg.role) && (
                  <Text bold color={getMessageColor(msg.role)}>
                    {getMessagePrefix(msg.role)}
                  </Text>
                )}
                <Text color={getMessageColor(msg.role)}>
                  {msg.formatted}
                </Text>
              </Box>
            )}
          </Static>
        )}
        
        {/* Render the last (potentially streaming) message separately */}
        {formattedMessages.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            {getMessagePrefix(formattedMessages[formattedMessages.length - 1].role) && (
              <Text bold color={getMessageColor(formattedMessages[formattedMessages.length - 1].role)}>
                {getMessagePrefix(formattedMessages[formattedMessages.length - 1].role)}
              </Text>
            )}
            <Text color={getMessageColor(formattedMessages[formattedMessages.length - 1].role)}>
              {formattedMessages[formattedMessages.length - 1].formatted}
            </Text>
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexShrink={0}>
        <Text color={isProcessing ? 'yellow' : 'green'}>
          {getStatusText()}
        </Text>
      </Box>

      {/* Token usage bar */}
      <Box paddingX={1} flexShrink={0}>
        <Text color={usageColor as any}>
          {tokenIcon} Tokens: {usageText}
          {(tokenSpeed > 0 || lastTokenSpeed > 0) && (
            <Text color="cyan"> • {(tokenSpeed > 0 ? tokenSpeed : lastTokenSpeed).toFixed(1)} tok/s</Text>
          )}
        </Text>
      </Box>

      {/* Input box - always at bottom */}
      <Box borderStyle="round" borderColor="green" paddingX={1} flexShrink={0}>
        <Text bold color="greenBright">You: </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Type your message..."
        />
      </Box>

      {/* Help text */}
      <Box paddingX={1} flexShrink={0}>
        <Text dimColor>Press Esc or Ctrl+C to exit • Type /help for commands</Text>
      </Box>
    </Box>
  );
}
