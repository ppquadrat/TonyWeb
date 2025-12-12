
import { useState, useCallback } from 'react';

export interface HistoryItem<T> {
  data: T;
}

export function useUndoRedo<T>(initialState: T) {
  // Use a single state object to ensure history and index update atomically.
  // This prevents race conditions where index is out of bounds relative to history length.
  const [state, setState] = useState({
    history: [initialState],
    index: 0
  });

  const { history, index } = state;
  
  // Safe retrieval with fallback
  const currentState = history[index] || initialState;

  const commit = useCallback((newState: T) => {
    setState(prev => {
      const newHistory = prev.history.slice(0, prev.index + 1);
      newHistory.push(newState);
      return {
        history: newHistory,
        index: prev.index + 1
      };
    });
  }, []);

  const undo = useCallback(() => {
    setState(prev => ({
      ...prev,
      index: Math.max(0, prev.index - 1)
    }));
  }, []);

  const redo = useCallback(() => {
    setState(prev => ({
      ...prev,
      index: Math.min(prev.history.length - 1, prev.index + 1)
    }));
  }, []);

  const reset = useCallback((newState: T) => {
    setState({
      history: [newState],
      index: 0
    });
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
