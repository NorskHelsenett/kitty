import React from 'react';
import { Box, Text } from 'ink';

export interface Task {
  id: string;
  description: string;
  completed: boolean;
}

interface TaskListProps {
  tasks: Task[];
}

export function TaskList({ tasks }: TaskListProps) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor="blue">
      <Text bold color="blue" dimColor={false}>Tasks:</Text>
      {tasks.map((task) => (
        <Box key={task.id} marginLeft={1}>
          <Text color={task.completed ? 'green' : 'yellow'} dimColor={task.completed}>
            {task.completed ? '✓' : '☐'} {task.description}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
