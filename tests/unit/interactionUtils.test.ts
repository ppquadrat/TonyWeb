import { describe, it, expect } from 'vitest';
import { findNoteInteraction } from '../../utils/interactionUtils';
import { freqToY } from '../../utils/renderUtils';
import { Note } from '../../types';

const HEIGHT = 600;
const zoom = 100; // px per second; edge zone is 8px = 0.08s

const note = (id: string, start: number, end: number, pitch = 220): Note => ({ id, start, end, pitch });

describe('findNoteInteraction', () => {
  it('moves a short selected note instead of resizing it', () => {
    // 0.15s note is 15px wide: previously all of it was an edge zone
    const notes = [note('a', 0.5, 0.65)];
    const y = freqToY(220, HEIGHT);
    const hit = findNoteInteraction(0.575, y, notes, zoom, HEIGHT, 'a');
    expect(hit?.mode).toBe('MOVE_VERTICAL');
  });

  it('still resizes from the outer edge of a selected note', () => {
    const notes = [note('a', 0.5, 0.65)];
    const y = freqToY(220, HEIGHT);
    expect(findNoteInteraction(0.505, y, notes, zoom, HEIGHT, 'a')?.mode).toBe('RESIZE_NOTE_START');
    expect(findNoteInteraction(0.645, y, notes, zoom, HEIGHT, 'a')?.mode).toBe('RESIZE_NOTE_END');
  });

  it('does not let a neighbouring edge steal the selected note body', () => {
    const notes = [note('a', 0.5, 0.65), note('b', 0.65, 0.8)];
    const y = freqToY(220, HEIGHT);
    expect(findNoteInteraction(0.66, y, notes, zoom, HEIGHT, 'b')?.mode).toBe('RESIZE_NOTE_START');
    expect(findNoteInteraction(0.7, y, notes, zoom, HEIGHT, 'b')?.mode).toBe('MOVE_VERTICAL');
  });

  it('does not move unselected notes', () => {
    const notes = [note('a', 0.5, 1.5)];
    const y = freqToY(220, HEIGHT);
    expect(findNoteInteraction(1.0, y, notes, zoom, HEIGHT, null)).toBeNull();
  });
});
