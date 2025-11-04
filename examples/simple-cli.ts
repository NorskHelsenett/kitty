#!/usr/bin/env bun
/**
 * Simple CLI demo of the AI Agent (without TUI)
 * Usage: bun run examples/simple-cli.ts
 */

import { AIAgent } from '../src/agent.js';
import chalk from 'chalk';

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('Error: ANTHROPIC_API_KEY not set'));
    process.exit(1);
  }

  const agent = new AIAgent(apiKey);

  console.log(chalk.bold.cyan('\n🤖 AI Agent Demo\n'));

  // Example queries to demonstrate capabilities
  const queries = [
    'List all TypeScript files in the src directory',
    'What dependencies does this project use?',
    'Show me the git status',
  ];

  for (const query of queries) {
    console.log(chalk.bold.yellow('\n' + '='.repeat(70)));
    console.log(chalk.bold.green('Query:'), chalk.white(query));
    console.log(chalk.bold.yellow('='.repeat(70) + '\n'));

    let response = '';

    await agent.chat(
      query,
      // On text chunk
      (text: string) => {
        response += text;
        process.stdout.write(chalk.white(text));
      },
      // On tool use
      (tool: any) => {
        console.log(chalk.dim.blue(`\n🔧 Using tool: ${tool.name}`));
        console.log(chalk.dim.blue(`   Input: ${JSON.stringify(tool.input, null, 2)}`));
      },
      // On tool result
      (result: any) => {
        const preview = typeof result === 'string' 
          ? result.slice(0, 150) + (result.length > 150 ? '...' : '')
          : JSON.stringify(result);
        console.log(chalk.dim.green(`✅ Result: ${preview}\n`));
      }
    );

    if (!response) {
      console.log(chalk.dim('(Task completed using tools)'));
    }

    console.log('\n');
    
    // Wait a bit between queries
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(chalk.bold.cyan('\n✓ Demo complete!\n'));
}

main().catch((error) => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});
