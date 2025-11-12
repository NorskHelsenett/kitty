import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface WarningDialogProps {
  title: string;
  message: string;
  onClose: () => void;
}

export function WarningDialog({ title, message, onClose }: WarningDialogProps) {
  useInput((input, key) => {
    // Close on Enter, Escape, or any key press
    if (key.return || key.escape || input) {
      onClose();
    }
  });

  return (
    <Box
      flexDirection="column"
      height="100%"
      justifyContent="center"
      alignItems="center"
      paddingX={4}
      paddingY={2}
    >
      <Box
        flexDirection="column"
        padding={2}
        borderStyle="round"
        borderColor="yellow"
        width={70}
      >
        <Box marginBottom={1}>
          <Text bold color="yellow">⚠️  {title}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text>{message}</Text>
        </Box>

        <Box marginTop={1} justifyContent="center">
          <Text
            bold
            color="green"
            inverse
          >
            {' Press any key to continue '}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
