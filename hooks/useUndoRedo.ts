
import { useState, useCallback } from 'react';

export interface HistoryItem<T> {
  data: T;
}

export function useUndoRedo<T>(initialState: T) {
  const [history, setHistory] = useState<T[]>([initialState]);
  const [index, setIndex] = useState(0);

  const currentState = history[index];

  const commit = useCallback((newState: T) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, index + 1);
      return [...newHistory, newState];
    });
    setIndex(prev => prev + 1);
  }, [index]);

  const undo = useCallback(() => {
    setIndex(prev => Math.max(0, prev - 1));
  }, []);

  const redo = useCallback(() => {
    setIndex(prev => Math.min(history.length - 1, prev + 1));
  }, [history.length]);

  const reset = useCallback((newState: T) => {
    setHistory([newState]);
    setIndex(0);
  }, []);

  return {
    state: currentState,
    commit,
    undo,
    redo,
    reset,
    canUndo: index > 0,
    canRedo: index < history.length - 1
  };
}
