#!/usr/bin/env bun
/**
 * Interactive REPL for AI Agent (simpler alternative to TUI)
 * Usage: bun run examples/repl.ts
 */

import { AIAgent } from '../src/agent.js';
import chalk from 'chalk';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.bold.cyan('You: '),
});

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('Error: ANTHROPIC_API_KEY not set'));
    process.exit(1);
  }

  const agent = new AIAgent(apiKey);

  console.log(chalk.bold.cyan('\n╔════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║') + chalk.bold.white('          AI Agent REPL - Interactive Mode          ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════╝\n'));
  console.log(chalk.dim('Type your questions or commands. Type "exit" or "quit" to exit.\n'));

  let isProcessing = false;

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log(chalk.yellow('\nGoodbye! 👋\n'));
      process.exit(0);
    }

    if (trimmed.toLowerCase() === 'clear') {
      console.clear();
      agent.clearHistory();
      console.log(chalk.green('✓ Chat history cleared\n'));
      rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'help') {
      console.log(chalk.bold.yellow('\nAvailable Commands:'));
      console.log(chalk.white('  exit/quit') + chalk.dim(' - Exit the REPL'));
      console.log(chalk.white('  clear') + chalk.dim('     - Clear chat history'));
      console.log(chalk.white('  help') + chalk.dim('      - Show this help\n'));
      rl.prompt();
      return;
    }

    if (isProcessing) {
      console.log(chalk.yellow('⚠ Please wait for the current request to complete\n'));
      rl.prompt();
      return;
    }

    isProcessing = true;
    console.log(chalk.bold.magenta('\nAI: '), chalk.dim('(thinking...)\r'));

    try {
      let firstChunk = true;

      await agent.chat(
        trimmed,
        // On text chunk
        (text: string) => {
          if (firstChunk) {
            process.stdout.write(chalk.bold.magenta('AI: '));
            firstChunk = false;
          }
          process.stdout.write(chalk.white(text));
        },
        // On tool use
        (tool: any) => {
          console.log(chalk.dim.blue(`\n    🔧 ${tool.name}`));
        },
        // On tool result
        (result: any) => {
          // Optionally show results
        }
      );

      console.log('\n');
    } catch (error: any) {
      console.log(chalk.red(`\nError: ${error.message}\n`));
    } finally {
      isProcessing = false;
      rl.prompt();
    }
  });

  rl.on('close', () => {
    console.log(chalk.yellow('\nGoodbye! 👋\n'));
    process.exit(0);
  });

  rl.prompt();
}

main().catch((error) => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});
