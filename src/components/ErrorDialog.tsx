import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface ErrorDialogProps {
  title: string;
  message: string;
  details?: string;
  suggestion?: string;
  onClose: () => void;
}

export function ErrorDialog({ title, message, details, suggestion, onClose }: ErrorDialogProps) {
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
        borderColor="red"
        width={70}
      >
        <Box marginBottom={1}>
          <Text bold color="red">❌  {title}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text>{message}</Text>
        </Box>

        {details && (
          <Box marginBottom={1} paddingX={2}>
            <Text dimColor>{details}</Text>
          </Box>
        )}

        {suggestion && (
          <Box
            marginBottom={1}
            paddingX={2}
            paddingY={1}
            borderStyle="single"
            borderColor="yellow"
          >
            <Box flexDirection="column">
              <Text bold color="yellow">💡 Suggestion:</Text>
              <Text>{suggestion}</Text>
            </Box>
          </Box>
        )}

        <Box marginTop={1} justifyContent="center">
          <Text
            bold
            color="green"
            inverse
          >
            {' Press any key to close '}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Helper function to create error dialog props from an error object
 */
export function getErrorDialogProps(error: any): ErrorDialogProps {
  const errorMessage = error?.message || String(error);
  const statusCode = error?.status || error?.statusCode;
  const errorCode = error?.code;

  // Connection errors (ECONNREFUSED, ENOTFOUND, etc.)
  if (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND' || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
    return {
      title: 'Connection Error',
      message: 'Unable to connect to the API server.',
      details: errorMessage,
      suggestion: 'Please ensure that OPENAI_BASE_URL is set correctly in your environment variables and that the API server is running.\n\nExample: export OPENAI_BASE_URL=http://localhost:11434/v1',
      onClose: () => {},
    };
  }

  // 401 Unauthorized
  if (statusCode === 401 || errorMessage.includes('401') || errorMessage.toLowerCase().includes('unauthorized')) {
    return {
      title: 'Authentication Error',
      message: 'Invalid or missing API token.',
      details: errorMessage,
      suggestion: 'Please set your API token in the environment variable.\n\nExample: export OPENAI_API_KEY=your-api-token-here',
      onClose: () => {},
    };
  }

  // 403 Forbidden
  if (statusCode === 403 || errorMessage.includes('403') || errorMessage.toLowerCase().includes('forbidden')) {
    return {
      title: 'Authorization Error',
      message: 'Access denied. Your API token may not have the required permissions.',
      details: errorMessage,
      suggestion: 'Please verify your API token has the correct permissions, or set a new token.\n\nExample: export OPENAI_API_KEY=your-api-token-here',
      onClose: () => {},
    };
  }

  // 404 Not Found
  if (statusCode === 404 || errorMessage.includes('404') || errorMessage.toLowerCase().includes('not found')) {
    return {
      title: 'Resource Not Found',
      message: 'The requested resource or endpoint was not found.',
      details: errorMessage,
      suggestion: 'Please verify:\n1. OPENAI_BASE_URL points to a valid API endpoint\n2. The model name is correct and available\n\nExample: export OPENAI_BASE_URL=http://localhost:11434/v1',
      onClose: () => {},
    };
  }

  // 500 Internal Server Error
  if (statusCode === 500 || errorMessage.includes('500') || errorMessage.toLowerCase().includes('internal server error')) {
    return {
      title: 'Server Error',
      message: 'The API server encountered an internal error.',
      details: errorMessage,
      suggestion: 'The server is experiencing issues. Please:\n1. Check the server logs for details\n2. Ensure the server is running properly\n3. Try again in a few moments',
      onClose: () => {},
    };
  }

  // 502 Bad Gateway
  if (statusCode === 502 || errorMessage.includes('502') || errorMessage.toLowerCase().includes('bad gateway')) {
    return {
      title: 'Bad Gateway Error',
      message: 'Unable to reach the API server through the gateway.',
      details: errorMessage,
      suggestion: 'Please verify that OPENAI_BASE_URL is correct and the API server is accessible.\n\nExample: export OPENAI_BASE_URL=http://localhost:11434/v1',
      onClose: () => {},
    };
  }

  // 503 Service Unavailable
  if (statusCode === 503 || errorMessage.includes('503') || errorMessage.toLowerCase().includes('service unavailable')) {
    return {
      title: 'Service Unavailable',
      message: 'The API server is temporarily unavailable.',
      details: errorMessage,
      suggestion: 'The server may be overloaded or under maintenance. Please try again later.',
      onClose: () => {},
    };
  }

  // Network timeout
  if (errorMessage.toLowerCase().includes('timeout') || errorCode === 'ETIMEDOUT') {
    return {
      title: 'Request Timeout',
      message: 'The request took too long to complete.',
      details: errorMessage,
      suggestion: 'The server may be slow or unresponsive. Please:\n1. Check your network connection\n2. Verify the API server is running\n3. Try again',
      onClose: () => {},
    };
  }

  // Generic error fallback
  return {
    title: 'Error',
    message: 'An unexpected error occurred.',
    details: errorMessage,
    suggestion: 'Please check your configuration and try again. If the problem persists, check the server logs for more information.',
    onClose: () => {},
  };
}
