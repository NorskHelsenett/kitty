import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ConfirmationPromptProps {
  title: string;
  message: string;
  details?: string;
  onConfirm: () => void;
  onReject: () => void;
}

export function ConfirmationPrompt({ title, message, details, onConfirm, onReject }: ConfirmationPromptProps) {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  useInput((input, key) => {
    if (key.escape) {
      onReject();
      return;
    }

    if (key.return) {
      if (selected === 'yes') {
        onConfirm();
      } else {
        onReject();
      }
      return;
    }

    if (key.leftArrow || key.rightArrow || input === 'y' || input === 'n') {
      if (input === 'y' || key.leftArrow) {
        setSelected('yes');
      } else if (input === 'n' || key.rightArrow) {
        setSelected('no');
      } else {
        setSelected(prev => prev === 'yes' ? 'no' : 'yes');
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="yellow">
      <Box marginBottom={1}>
        <Text bold color="yellow">⚠️  {title}</Text>
      </Box>
      
      <Box marginBottom={1}>
        <Text>{message}</Text>
      </Box>
      
      {details && (
        <Box marginBottom={1} paddingX={2}>
          <Text dimColor>{details}</Text>
        </Box>
      )}
      
      <Box marginTop={1}>
        <Text>
          {'  '}
          <Text 
            bold={selected === 'yes'} 
            color={selected === 'yes' ? 'green' : 'white'}
            inverse={selected === 'yes'}
          >
            {' Yes '}
          </Text>
          {'  '}
          <Text 
            bold={selected === 'no'} 
            color={selected === 'no' ? 'red' : 'white'}
            inverse={selected === 'no'}
          >
            {' No '}
          </Text>
        </Text>
      </Box>
      
      <Box marginTop={1}>
        <Text dimColor>Use ← → or Y/N to choose, Enter to confirm, Esc to cancel</Text>
      </Box>
    </Box>
  );
}
