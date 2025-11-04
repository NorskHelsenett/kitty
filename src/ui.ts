import React from 'react';
import { render } from 'ink';
import { Chat } from './Chat.js';
import type { AIAgent } from './agent.js';

export class ChatUI {
  private agent: AIAgent;
  private debugMode: boolean;
  private debugLog?: (data: any) => void;
  private renderInstance: any;

  constructor(screen: any, agent: AIAgent, debugLog?: (data: any) => void, debugMode?: boolean) {
    // screen parameter is ignored for Ink compatibility
    this.agent = agent;
    this.debugLog = debugLog;
    this.debugMode = debugMode ?? !!debugLog;
  }

  async initialize(): Promise<void> {
    // Clear screen and enter fullscreen mode
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    
    // Start the Ink rendering with fullscreen support
    this.renderInstance = render(
      React.createElement(Chat, {
        agent: this.agent,
        debugMode: this.debugMode,
      }),
      {
        patchConsole: false,
        exitOnCtrlC: false,
      }
    );
    
    // Clean up and restore terminal on exit
    this.renderInstance.waitUntilExit().then(() => {
      this.renderInstance.clear();
    });
    
    // Return the promise that resolves when app exits
    return this.renderInstance.waitUntilExit();
  }

  // Legacy methods for compatibility - not needed with Ink but kept for interface
  addMessage(role: string, content: string) {
    // Messages are now handled internally by the Chat component
  }
}
