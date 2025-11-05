import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SelectionItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

interface SelectionMenuProps {
  title: string;
  items: SelectionItem[];
  onSubmit: (selectedIds: string[]) => void;
  onCancel: () => void;
  singleSelect?: boolean; // New: if true, only allow one selection
}

export function SelectionMenu({ title, items, onSubmit, onCancel, singleSelect = false }: SelectionMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selections, setSelections] = useState<Set<string>>(
    new Set(items.filter(item => item.enabled).map(item => item.id))
  );

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSubmit(Array.from(selections));
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
    } else if (input === ' ') {
      const currentItem = items[selectedIndex];
      setSelections(prev => {
        const newSet = new Set(prev);
        
        if (singleSelect) {
          // Single select mode: clear all and add current
          newSet.clear();
          newSet.add(currentItem.id);
        } else {
          // Multi select mode: toggle current
          if (newSet.has(currentItem.id)) {
            newSet.delete(currentItem.id);
          } else {
            newSet.add(currentItem.id);
          }
        }
        return newSet;
      });
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>
          {singleSelect 
            ? 'Use ↑↓ to navigate, Space to select, Enter to confirm, Esc to cancel'
            : 'Use ↑↓ to navigate, Space to select/deselect, Enter to confirm, Esc to cancel'}
        </Text>
      </Box>
      
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const isEnabled = selections.has(item.id);
        
        return (
          <Box key={item.id} marginBottom={0}>
            <Text color={isSelected ? 'cyan' : 'white'}>
              {isSelected ? '> ' : '  '}
              {singleSelect ? (isEnabled ? '(•) ' : '( ) ') : (isEnabled ? '[✓] ' : '[ ] ')}
              <Text bold={isSelected}>{item.name}</Text>
              {' - '}
              <Text dimColor>{item.description}</Text>
            </Text>
          </Box>
        );
      })}
      
      <Box marginTop={1}>
        <Text dimColor>
          {singleSelect 
            ? `Current: ${selections.size > 0 ? Array.from(selections)[0] : 'none'}`
            : `Selected: ${selections.size}/${items.length}`}
        </Text>
      </Box>
    </Box>
  );
}
