#!/usr/bin/env bun

/**
 * Agent System Demo
 * 
 * Demonstrates the Kitty agent system for multi-step workflows
 */

import { AgentManager } from '../src/agent-manager.js';
import { tools as sbomTools } from '../src/tools/sbom-tools.js';
import { tools as builtinTools } from '../src/plugins.js';

async function main() {
  console.log('🤖 Kitty Agent System Demo\n');

  // Initialize agent manager
  const agentManager = new AgentManager();
  await agentManager.initialize();

  // Register tools that agents can use
  console.log('📦 Registering tools...');
  agentManager.registerTools([...builtinTools, ...sbomTools]);
  console.log(`✅ Registered ${builtinTools.length + sbomTools.length} tools\n`);

  // Install example agent
  console.log('📥 Installing example agent...');
  try {
    await agentManager.installAgent('./examples/agents/dependency-checker.yaml');
  } catch (error: any) {
    if (!error.message.includes('already exists')) {
      console.error('Error installing agent:', error.message);
    }
  }

  // List available agents
  console.log('\n📋 Available agents:');
  const agents = agentManager.listAgents();
  agents.forEach(agent => {
    console.log(`  - ${agent.name} (v${agent.version}): ${agent.description}`);
  });

  // Execute an agent
  console.log('\n▶️  Executing dependency-checker agent...\n');
  
  try {
    const result = await agentManager.executeAgent(
      'dependency-checker',
      { package_name: 'react' },
      async (prompt: string) => {
        // Mock AI executor - in real usage, this would call your AI service
        console.log('\n🤔 AI Prompt:', prompt.substring(0, 100) + '...\n');
        return 'AI response would go here';
      }
    );

    console.log('\n📊 Agent Results:');
    console.log('Variables:', JSON.stringify(result.variables, null, 2));
    console.log('\nTasks Completed:', result.results.length);
    
    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors:', result.errors);
    }
  } catch (error: any) {
    console.error('\n❌ Agent execution failed:', error.message);
  }

  console.log('\n✨ Demo complete!\n');
}

main().catch(console.error);
