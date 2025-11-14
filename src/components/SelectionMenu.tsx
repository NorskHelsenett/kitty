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
  const getInitialSelectedIndex = () => {
    if (items.length === 0) {
      return 0;
    }

    if (singleSelect) {
      const preSelectedIndex = items.findIndex(item => item.enabled);
      return preSelectedIndex >= 0 ? preSelectedIndex : 0;
    }

    return 0;
  };

  const getInitialSelections = () => {
    const enabledItems = items.filter(item => item.enabled).map(item => item.id);

    if (items.length === 0) {
      return new Set<string>();
    }

    if (singleSelect) {
      if (enabledItems.length > 0) {
        return new Set<string>([enabledItems[0]]);
      }
      return new Set<string>([items[0].id]);
    }

    return new Set<string>(enabledItems);
  };

  const [selectedIndex, setSelectedIndex] = useState(getInitialSelectedIndex);
  const [selections, setSelections] = useState<Set<string>>(getInitialSelections);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (singleSelect) {
        const currentItem = items[selectedIndex];
        if (currentItem) {
          onSubmit([currentItem.id]);
        }
      } else {
        onSubmit(Array.from(selections));
      }
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
    } else if (input === ' ') {
      const currentItem = items[selectedIndex];
      if (!currentItem) {
        return;
      }

      if (singleSelect) {
        setSelections(new Set([currentItem.id]));
        return;
      }
      setSelections(prev => {
        const newSet = new Set(prev);
        if (newSet.has(currentItem.id)) {
          newSet.delete(currentItem.id);
        } else {
          newSet.add(currentItem.id);
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
            ? 'Use ↑↓/k/j to navigate, Space to select, Enter to confirm, Esc to cancel'
            : 'Use ↑↓/k/j to navigate, Space to select/deselect, Enter to confirm, Esc to cancel'}
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
