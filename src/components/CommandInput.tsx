import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

export interface CommandSuggestion {
  command: string;
  description: string;
}

interface CommandInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
}

const AVAILABLE_COMMANDS: CommandSuggestion[] = [
  { command: '/models', description: 'Select which AI model to use' },
  { command: '/agents', description: 'Select which agents to enable/disable' },
  { command: '/plugins', description: 'Select which plugins to enable/disable' },
  { command: '/init', description: 'Create a KITTY.md file for project context' },
  { command: '/reinit', description: 'Regenerate KITTY.md (overwrites existing)' },
  { command: '/help', description: 'Show this help message' },
  { command: '/clear', description: 'Clear conversation history' },
];

export function CommandInput({ input, onInputChange, onSubmit, placeholder }: CommandInputProps) {
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showCursor, setShowCursor] = useState(true);

  // Blinking cursor effect
  useEffect(() => {
    const interval = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 530); // Blink every 530ms

    return () => clearInterval(interval);
  }, []);

  // Get filtered suggestions based on current input
  const getSuggestions = (): CommandSuggestion[] => {
    if (!input.startsWith('/')) {
      return [];
    }

    // Show all commands when just "/" is typed
    if (input === '/') {
      return AVAILABLE_COMMANDS;
    }

    const query = input.toLowerCase();
    return AVAILABLE_COMMANDS.filter(cmd => 
      cmd.command.toLowerCase().startsWith(query)
    );
  };

  const suggestions = getSuggestions();

  useInput((inputChar, key) => {
    // Handle special keys when suggestions are shown
    if (suggestions.length > 0 && input.startsWith('/')) {
      if (key.upArrow) {
        setSelectedSuggestionIndex(prev => 
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        setShowSuggestions(true);
        return;
      }

      if (key.downArrow) {
        setSelectedSuggestionIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        setShowSuggestions(true);
        return;
      }

      if (key.tab) {
        // Tab completion
        const suggestion = suggestions[selectedSuggestionIndex];
        if (suggestion) {
          onInputChange(suggestion.command);
          setSelectedSuggestionIndex(0);
          setShowSuggestions(false);
        }
        return;
      }

      if (key.return) {
        // Check if input is an exact match to a command
        const isExactMatch = AVAILABLE_COMMANDS.some(cmd => cmd.command === input);
        
        if (isExactMatch) {
          // Submit the command and hide suggestions
          onSubmit(input);
          setShowSuggestions(false);
          setSelectedSuggestionIndex(0);
          return;
        }
        
        // If a suggestion is selected and shown, use it
        if (showSuggestions && suggestions[selectedSuggestionIndex]) {
          onInputChange(suggestions[selectedSuggestionIndex].command);
          setShowSuggestions(false);
          return;
        }
      }
    }

    // Handle normal text input
    if (key.return) {
      onSubmit(input);
      setShowSuggestions(false);
      setSelectedSuggestionIndex(0);
      return;
    }

    if (key.backspace || key.delete) {
      const newInput = input.slice(0, -1);
      onInputChange(newInput);
      setSelectedSuggestionIndex(0);
      setShowSuggestions(newInput.startsWith('/'));
      return;
    }

    if (inputChar && !key.ctrl && !key.meta) {
      const newInput = input + inputChar;
      onInputChange(newInput);
      setSelectedSuggestionIndex(0);
      setShowSuggestions(newInput.startsWith('/'));
    }
  });

  return (
    <Box flexDirection="column">
      {/* Input line */}
      <Box>
        <Text bold color="greenBright">❯ </Text>
        <Text>{input}</Text>
        <Text color="greenBright">{showCursor ? '█' : ' '}</Text>
        {input.length === 0 && placeholder && (
          <Text dimColor>{placeholder}</Text>
        )}
      </Box>

      {/* Command suggestions */}
      {showSuggestions && input.startsWith('/') && suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Box marginBottom={1}>
            <Text dimColor>
              {input === '/' ? 'Available commands (↑↓ to navigate, Tab/Enter to complete):' : 'Commands (↑↓ to navigate, Tab/Enter to complete):'}
            </Text>
          </Box>
          {suggestions.map((suggestion, index) => {
            const isSelected = index === selectedSuggestionIndex;
            return (
              <Box key={suggestion.command}>
                <Text 
                  color={isSelected ? 'cyan' : 'white'}
                  bold={isSelected}
                  inverse={isSelected}
                >
                  {isSelected ? '> ' : '  '}
                  {suggestion.command}
                </Text>
                <Text dimColor> - {suggestion.description}</Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
