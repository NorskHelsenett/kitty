import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp, useStdout, Static } from 'ink';
import chalk from 'chalk';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { AIAgent } from './agent.js';
import type { ThinkingStep } from './orchestrator.js';
import { SelectionMenu, SelectionItem } from './components/SelectionMenu.js';
import { ConfirmationPrompt } from './components/ConfirmationPrompt.js';
import { CommandInput } from './components/CommandInput.js';
import { TaskList, Task } from './components/TaskList.js';
import { setConfirmationCallback } from './tools/executor.js';

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

interface AgentActivity {
  agentName?: string;
  pluginName?: string;
  summary?: string;
  planning?: string;
  decision?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'tool_result' | 'error' | 'thinking' | 'agent_activity';
  content: string;
  agentActivity?: AgentActivity;
  suppressOutput?: boolean; // For commands like /plugins
}

interface ChatProps {
  agent: AIAgent;
  debugMode?: boolean;
}

type FormattedMessage = Message & { formatted: string };

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const { exit } = useApp();
  const { stdout } = useStdout();

  // New state for UI modes
  const [uiMode, setUiMode] = useState<'chat' | 'agent-selection' | 'plugin-selection' | 'model-selection' | 'confirmation'>('chat');
  const [selectionItems, setSelectionItems] = useState<SelectionItem[]>([]);
  const [confirmationData, setConfirmationData] = useState<{
    title: string;
    message: string;
    details?: string;
    onConfirm: () => void;
    onReject: () => void;
  } | null>(null);

  // Ref to store abort controller for cancelling requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Use refs for throttling to reduce flickering
  const lastUpdateTimeRef = useRef<number>(0);
  const pendingUpdateRef = useRef<string | null>(null);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokenUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastToolMessageRef = useRef<string | null>(null);

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

      // Set up confirmation callback
      setConfirmationCallback(async (toolName: string, input: any, details?: string) => {
        return new Promise<boolean>((resolve) => {
          setConfirmationData({
            title: `Confirm ${toolName}`,
            message: `Allow ${toolName} to execute?`,
            details,
            onConfirm: () => {
              setConfirmationData(null);
              setUiMode('chat');
              resolve(true);
            },
            onReject: () => {
              setConfirmationData(null);
              setUiMode('chat');
              resolve(false);
            }
          });
          setUiMode('confirmation');
        });
      });

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
    // Only handle global keys when in chat mode
    if (uiMode === 'chat') {
      if (key.escape) {
        if (isProcessing) {
          // Cancel ongoing request
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          }
          setIsProcessing(false);
          setStatus('Cancelled');
          addMessage('system', '⚠️  Request cancelled by user');
        } else {
          // Exit application
          exit();
        }
      } else if (key.ctrl && input === 'c') {
        exit();
      }
    }
  });

  const addMessage = useCallback((role: Message['role'], content: string, agentActivity?: AgentActivity) => {
    setMessages(prev => [...prev, { role, content, agentActivity }]);
    if (role === 'tool') {
      lastToolMessageRef.current = content;
    } else if (role !== 'tool_result') {
      lastToolMessageRef.current = null;
    }
  }, []);

  const addToolMessage = useCallback((content: string) => {
    if (lastToolMessageRef.current === content) return;
    addMessage('tool', content);
  }, [addMessage]);

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

  const updateLastMessage = useCallback((content: string) => {
    const now = Date.now();

    // Store the pending update
    pendingUpdateRef.current = content;

    // If enough time has passed, update immediately (250ms throttle to allow text selection)
    if (now - lastUpdateTimeRef.current >= 250) {
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
      }, 250);
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

    if (cmd === '/models') {
      // Show model selection menu
      addMessage('system', '🔍 Fetching available models from endpoint...');

      try {
        const models = await agent.listAvailableModels();

        if (models.length === 0) {
          addMessage('system', '⚠️  No models found. Check your API endpoint configuration.');
          return;
        }

        const currentModel = agent.getCurrentModel();

        const items: SelectionItem[] = models.map(m => ({
          id: m.id,
          name: m.id,
          description: m.owned_by ? `Owner: ${m.owned_by}` : 'Available model',
          enabled: m.id === currentModel
        }));

        setSelectionItems(items);
        setUiMode('model-selection');
      } catch (error: any) {
        addMessage('error', `Failed to fetch models: ${error.message}`);
      }
      return;
    }

    if (cmd === '/agents') {
      // Show agent selection menu
      const agentManager = agent.getAgentManager();
      const installedAgents = await agentManager.listInstalled();

      const items: SelectionItem[] = installedAgents.map((a: any) => ({
        id: a.name,
        name: a.name,
        description: a.description,
        enabled: a.enabled
      }));

      if (items.length === 0) {
        addMessage('system', 'No agents installed. Install agents to use this feature.');
        return;
      }

      setSelectionItems(items);
      setUiMode('agent-selection');
      return;
    }

    if (cmd === '/plugins') {
      // Show plugin selection menu
      const pluginManager = agent.getPluginManager();
      const installedPlugins = await pluginManager.listInstalled();

      const items: SelectionItem[] = installedPlugins.map(p => ({
        id: p.name,
        name: p.name,
        description: p.description,
        enabled: p.enabled
      }));

      if (items.length === 0) {
        addMessage('system', 'No plugins installed. Install plugins to use this feature.');
        return;
      }

      setSelectionItems(items);
      setUiMode('plugin-selection');
      return;
    }

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
              addToolMessage(`🔧 Using tool: ${tool.name}\n${JSON.stringify(tool.input, null, 2)}`);
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
- /models - Select which AI model to use
- /agents - Select which agents to enable/disable
- /plugins - Select which plugins to enable/disable
- /init - Create a KITTY.md file for project context
- /reinit - Regenerate KITTY.md (overwrites existing)
- /help - Show this help message
- /clear - Clear conversation history

During agent execution:
- Press ESC to cancel ongoing requests

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
      let currentTaskId: string | null = null;
      let currentAgentActivity: AgentActivity = {};

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

          // Create a task for this tool usage
          const taskDesc = `${tool.name}: ${tool.input?.path || tool.input?.command || tool.input?.query || tool.input?.url || 'executing'}`;
          currentTaskId = addTask(taskDesc);

          // Only show agent activity in non-debug mode (debug mode shows detailed tool info)
          if (!debugMode) {
            currentAgentActivity.pluginName = tool.name;
            currentAgentActivity.summary = `Using ${tool.name}`;
            addMessage('agent_activity', '', currentAgentActivity);
          } else {
            // Debug mode: show detailed tool information
            addToolMessage(`🔧 Using tool: ${tool.name}\n${JSON.stringify(tool.input, null, 2)}`);
          }

          setStatus(`tool: ${tool.name}`);
        },
        (result: any) => {
          // Complete the current task
          if (currentTaskId) {
            completeTask(currentTaskId);
            currentTaskId = null;
          }

          setStatus('Processing tool results...');

          if (!debugMode) return;

          // Show tool results in debug mode
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
            // If parsing failed, show raw result
            const preview = typeof result === 'string'
              ? result.slice(0, 200) + (result.length > 200 ? '...' : '')
              : String(result).slice(0, 200);
            addMessage('tool_result', `✅ Tool result:\n${preview}`);
          }
        },
        () => {
          setStatus('Waiting for AI to analyze results...');
        },
        (step: ThinkingStep) => {
          // Update agent activity based on thinking step
          if (step.type === 'planning') {
            currentAgentActivity.planning = step.content;
            if (!debugMode) {
              // In non-debug mode, only show meaningful planning steps
              if (!step.content.includes('Analyzing if this request') &&
                !step.content.includes('Creating a task plan')) {
                addMessage('agent_activity', '', { ...currentAgentActivity });
              }
            }
          } else if (step.type === 'decision') {
            currentAgentActivity.decision = step.content;
            if (!debugMode) {
              // Only show final decisions, not intermediate ones
              if (step.content.includes('complete') || step.content.includes('fulfilled')) {
                addMessage('agent_activity', '', { ...currentAgentActivity });
              }
            }
          }

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

      // Clear tasks after completion
      if (tasks.length > 0) {
        setTimeout(() => clearTasks(), 2000);
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
  // Filter out system messages and verbose messages unless in debug mode
  // Also filter out user messages that are commands (start with '/') unless in debug mode
  const filteredMessages = debugMode
    ? messages
    : messages.filter(msg => {
      if (msg.role === 'system' || msg.role === 'tool' || msg.role === 'tool_result') {
        return false;
      }
      if (msg.role === 'user' && msg.content.trim().startsWith('/')) return false;
      return true;
    });

  const formattedMessages: FormattedMessage[] = filteredMessages.slice(-20).map((msg) => {
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
  const currentModel = agent.getCurrentModel();

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
      case 'agent_activity': return 'blue';
      case 'error': return 'red';
      default: return 'white';
    }
  };

  const getMessagePrefix = (role: string) => {
    switch (role) {
      case 'user': return 'You: ';
      case 'assistant': return 'KITTY: ';
      case 'system': return 'System: ';
      case 'error': return 'Error: ';
      case 'agent_activity': return ''; // No prefix for agent activity
      default: return '';
    }
  };

  const renderAgentActivity = (activity: AgentActivity) => {
    const parts: string[] = [];

    if (activity.agentName) {
      parts.push(`Agent: ${activity.agentName}`);
    }

    if (activity.pluginName) {
      parts.push(`  Plugin: ${activity.pluginName}`);
    }

    if (activity.summary) {
      parts.push(`    Summary: ${activity.summary}`);
    }

    if (activity.planning) {
      parts.push(`  Planning: ${activity.planning}`);
    }

    if (activity.decision) {
      parts.push(`  Decision: ${activity.decision}`);
    }

    return parts.join('\n');
  };

  const renderDebugMessage = (msg: FormattedMessage) => {
    if (msg.role === 'agent_activity' && msg.agentActivity) {
      return (
        <Text color="blue" dimColor>
          {renderAgentActivity(msg.agentActivity)}
        </Text>
      );
    }

    const prefix = getMessagePrefix(msg.role);
    const color = getMessageColor(msg.role);

    return (
      <>
        {prefix && (
          <Text bold color={color}>
            {prefix}
          </Text>
        )}
        <Text color={color}>
          {msg.formatted}
        </Text>
      </>
    );
  };

  const renderCompactMessage = (msg: FormattedMessage) => {
    if (msg.role === 'agent_activity' && msg.agentActivity) {
      const { agentName, pluginName, summary, planning, decision } = msg.agentActivity;
      const titleParts: string[] = [];
      if (pluginName) titleParts.push(pluginName);
      if (agentName) titleParts.push(`agent: ${agentName}`);
      const header = titleParts.length > 0 ? `Task - ${titleParts.join(' | ')}` : 'Task';

      const detailLines: Array<{ text: string; dim?: boolean; bullet?: boolean }> = [];
      if (summary) {
        const summaryLines = summary.split('\n');
        summaryLines.forEach((line, idx) => {
          detailLines.push({ text: line, bullet: idx === 0 });
        });
      }
      if (planning) {
        const planLines = planning.split('\n');
        const first = planLines[0] ?? '';
        const planHeader = first.trim().toLowerCase().startsWith('plan')
          ? first
          : `Plan: ${first}`;
        detailLines.push({ text: planHeader, dim: true, bullet: true });
        planLines.slice(1).forEach(line => detailLines.push({ text: line, dim: true }));
      }
      if (decision) {
        const decisionLines = decision.split('\n');
        const first = decisionLines[0] ?? '';
        const decisionHeader = first.trim().toLowerCase().startsWith('decision')
          ? first
          : `Decision: ${first}`;
        detailLines.push({ text: decisionHeader, bullet: true });
        decisionLines.slice(1).forEach(line => detailLines.push({ text: line }));
      }
      if (detailLines.length === 0) {
        detailLines.push({ text: 'Working...', bullet: true });
      }

      return (
        <Box flexDirection="column">
          <Text color="blue">
            {`• ${header}`}
          </Text>
          {detailLines.map((line, idx) => (
            <Text key={idx} color="blue" dimColor={line.dim}>
              {line.bullet ? `  - ${line.text}` : `    ${line.text}`}
            </Text>
          ))}
        </Box>
      );
    }

    const color = getMessageColor(msg.role);
    const prefix = getMessagePrefix(msg.role);
    const rawLines = String(msg.formatted)
      .split('\n')
      .map(line => line.replace(/\r$/, ''));

    const firstContentIdx = rawLines.findIndex(line => line.trim().length > 0);
    if (firstContentIdx === -1) {
      return null;
    }

    const messageLines = rawLines.slice(firstContentIdx);
    const renderedLines = messageLines.length > 0 ? messageLines : [''];
    const prefixedLines = renderedLines.map((line, idx) =>
      idx === 0 ? `• ${prefix ?? ''}${line}` : line
    );

    return (
      <Text color={color}>
        {prefixedLines.join('\n')}
      </Text>
    );
  };

  const renderMessageBody = (msg: FormattedMessage) => (
    debugMode ? renderDebugMessage(msg) : renderCompactMessage(msg)
  );

  const getMessageMarginBottom = (index: number) => {
    if (debugMode) return 1;
    const current = formattedMessages[index];
    const next = formattedMessages[index + 1];
    if (current?.role === 'assistant' && next?.role === 'user') {
      return 1;
    }
    return 0;
  };

  if (!initialized) {
    return (
      <Box padding={1}>
        <Text>Initializing...</Text>
      </Box>
    );
  }

  // Handle selection menus
  if (uiMode === 'agent-selection') {
    return (
      <SelectionMenu
        title="Select Agents to Enable"
        items={selectionItems}
        onSubmit={async (selectedIds: string[]) => {
          const agentManager = agent.getAgentManager();
          const allAgents = await agentManager.listInstalled();

          // Enable selected, disable unselected
          for (const a of allAgents) {
            if (selectedIds.includes(a.name) && !a.enabled) {
              await agentManager.enable(a.name);
              addMessage('system', `✅ Enabled agent: ${a.name}`);
            } else if (!selectedIds.includes(a.name) && a.enabled) {
              await agentManager.disable(a.name);
              addMessage('system', `❌ Disabled agent: ${a.name}`);
            }
          }

          setUiMode('chat');
        }}
        onCancel={() => {
          setUiMode('chat');
        }}
      />
    );
  }

  if (uiMode === 'plugin-selection') {
    return (
      <SelectionMenu
        title="Select Plugins to Enable"
        items={selectionItems}
        onSubmit={async (selectedIds: string[]) => {
          const pluginManager = agent.getPluginManager();
          const allPlugins = await pluginManager.listInstalled();

          // Enable selected, disable unselected
          for (const p of allPlugins) {
            if (selectedIds.includes(p.name) && !p.enabled) {
              await pluginManager.enable(p.name);
              addMessage('system', `✅ Enabled plugin: ${p.name}`);
            } else if (!selectedIds.includes(p.name) && p.enabled) {
              await pluginManager.disable(p.name);
              addMessage('system', `❌ Disabled plugin: ${p.name}`);
            }
          }

          setUiMode('chat');
        }}
        onCancel={() => {
          setUiMode('chat');
        }}
      />
    );
  }

  if (uiMode === 'model-selection') {
    return (
      <SelectionMenu
        title="Select AI Model"
        items={selectionItems}
        singleSelect={true}
        onSubmit={async (selectedIds: string[]) => {
          if (selectedIds.length > 0) {
            const selectedModel = selectedIds[0];
            const currentModel = agent.getCurrentModel();

            if (selectedModel !== currentModel) {
              addMessage('system', `🔄 Switching model from ${currentModel} to ${selectedModel}...`);

              try {
                await agent.setModel(selectedModel);
                addMessage('system', `✅ Model changed to ${selectedModel}`);
              } catch (error: any) {
                addMessage('error', `Failed to switch model: ${error.message}`);
              }
            } else {
              addMessage('system', `Already using ${selectedModel}`);
            }
          }

          setUiMode('chat');
        }}
        onCancel={() => {
          setUiMode('chat');
        }}
      />
    );
  }

  if (uiMode === 'confirmation' && confirmationData) {
    return (
      <ConfirmationPrompt
        title={confirmationData.title}
        message={confirmationData.message}
        details={confirmationData.details}
        onConfirm={confirmationData.onConfirm}
        onReject={confirmationData.onReject}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {/* Messages area - use Static for completed messages to reduce re-renders */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={debugMode ? 1 : 0}>
        {formattedMessages.length > 1 && (
          <Static items={formattedMessages.slice(0, -1)}>
            {(msg, idx) => (
              <Box
                key={idx}
                flexDirection="column"
                marginBottom={getMessageMarginBottom(idx)}
              >
                {renderMessageBody(msg)}
              </Box>
            )}
          </Static>
        )}

        {/* Render the last (potentially streaming) message separately */}
        {formattedMessages.length > 0 && (
          <Box
            flexDirection="column"
            marginBottom={getMessageMarginBottom(formattedMessages.length - 1)}
          >
            {renderMessageBody(formattedMessages[formattedMessages.length - 1])}
          </Box>
        )}
      </Box>

      {/* Task list - floats above input */}
      {debugMode && tasks.length > 0 && (
        <TaskList tasks={tasks} />
      )}

      {/* Status bar */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexShrink={0}>
        <Text color={isProcessing ? 'yellow' : 'green'}>
          {getStatusText()}
        </Text>
      </Box>

      {/* Token usage bar */}
      <Box paddingX={1} flexShrink={0} justifyContent="space-between">
        <Text color={usageColor as any}>
          {tokenIcon} Tokens: {usageText}
          {(tokenSpeed > 0 || lastTokenSpeed > 0) && (
            <Text color="cyan"> • {(tokenSpeed > 0 ? tokenSpeed : lastTokenSpeed).toFixed(1)} tok/s</Text>
          )}
        </Text>
        <Text color="cyan" dimColor>
          {currentModel}
        </Text>
      </Box>

      {/* Input box - always at bottom */}
      <Box borderStyle="round" borderColor="green" paddingX={1} flexShrink={0} flexDirection="column">
        <CommandInput
          input={input}
          onInputChange={setInput}
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
