import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ConfirmationPromptProps {

  title: string;

  message: string;

  details?: string;

  onAllow: () => void;

  onAllowAndRemember: () => void;

  onExplain: () => void;

  onDeny: () => void;

}



export function ConfirmationPrompt({ title, message, details, onAllow, onAllowAndRemember, onExplain, onDeny }: ConfirmationPromptProps) {

  const [selected, setSelected] = useState(0);

  const options = ['Yes, allow', 'Yes, allow for this session', 'No, explain changes'];



  useInput((input, key) => {
    if (key.escape) {
      onDeny();
      return;
    }

    if (key.return) {
      if (selected === 0) {
        onAllow();
      } else if (selected === 1) {
        onAllowAndRemember();
      } else {
        onExplain();
      }
      return;
    }

    if (key.leftArrow) {
      setSelected(prev => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setSelected(prev => Math.min(options.length - 1, prev + 1));
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
          {options.map((option, i) => (
            <Text 
              key={option}
              bold={selected === i} 
              color={selected === i ? 'green' : 'white'}
              inverse={selected === i}
            >
              {` ${option} `}
            </Text>
          ))}
        </Text>
      </Box>
      
      <Box marginTop={1}>
        <Text dimColor>Use ← → to choose, Enter to confirm, Esc to cancel</Text>
      </Box>
    </Box>
  );
}
