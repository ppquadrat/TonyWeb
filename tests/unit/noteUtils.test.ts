import { describe, it, expect } from 'vitest';
import { moveNoteBoundary, resizeNoteWithPush, placeNewNote, fallbackNotePitch, isFrameInRange } from '../../utils/noteUtils';
import { Note, PitchFrame } from '../../types';

const note = (id: string, start: number, end: number, pitch = 220): Note => ({ id, start, end, pitch });
const byId = (notes: Note[]) => Object.fromEntries(notes.map(n => [n.id, n]));

describe('moveNoteBoundary', () => {
  it('moves a shared boundary for both notes, in either direction', () => {
    const notes = [note('a', 0, 1), note('b', 1, 2)];
    let r = byId(moveNoteBoundary(notes, 'a', 'end', 1.5));
    expect(r.a.end).toBe(1.5); expect(r.b.start).toBe(1.5);
    r = byId(moveNoteBoundary(notes, 'b', 'start', 0.6));
    expect(r.a.end).toBe(0.6); expect(r.b.start).toBe(0.6);
  });

  it('joins and pushes the neighbour when a free boundary reaches it, never overlapping', () => {
    const notes = [note('a', 0, 1), note('b', 1.5, 2)];
    const r = byId(moveNoteBoundary(notes, 'a', 'end', 1.7));
    expect(r.a.end).toBe(1.7);
    expect(r.b.start).toBe(1.7);
  });

  it('leaves a free neighbour alone until it is reached', () => {
    const r = byId(moveNoteBoundary([note('a', 0, 1), note('b', 1.5, 2)], 'a', 'end', 1.2));
    expect(r.b.start).toBe(1.5);
  });

  it('never squeezes the neighbour away', () => {
    const r = byId(moveNoteBoundary([note('a', 0, 1), note('b', 1, 2)], 'a', 'end', 5));
    expect(r.b.end - r.b.start).toBeGreaterThan(0);
    expect(r.a.end).toBe(r.b.start);
  });

  it('with detach (Alt) only the dragged note moves and it stops at the neighbour', () => {
    const notes = [note('a', 0, 1), note('b', 1, 2)];
    let r = byId(moveNoteBoundary(notes, 'a', 'end', 0.8, Infinity, true));
    expect(r.a.end).toBe(0.8); expect(r.b.start).toBe(1);
    r = byId(moveNoteBoundary([note('a', 0, 1), note('b', 1.5, 2)], 'a', 'end', 1.8, Infinity, true));
    expect(r.a.end).toBe(1.5); expect(r.b.start).toBe(1.5);
  });

  it('stays inside the file', () => {
    expect(byId(moveNoteBoundary([note('a', 1, 2)], 'a', 'end', 9, 3)).a.end).toBe(3);
    expect(byId(moveNoteBoundary([note('a', 1, 2)], 'a', 'start', -1)).a.start).toBe(0);
  });
});

describe('resizeNoteWithPush', () => {
  it('updates the pitch of the neighbour that moved', () => {
    const pitch: PitchFrame[] = [0.25, 0.75, 1.25, 1.75].map((t, i) => ({ timestamp: t, frequency: i < 2 ? 200 : 300, probability: 1, hasPitch: true }));
    const r = byId(resizeNoteWithPush([note('a', 0, 1, 200), note('b', 1, 2, 300)], 'b', 0.5, 2, pitch));
    expect(r.a.end).toBe(0.5);
    expect(r.b.pitch).toBe(300);
    expect(r.a.pitch).toBe(200);
  });
});

describe('placeNewNote', () => {
  it('refuses a note inside a longer note', () => {
    expect(placeNewNote([note('a', 0, 4)], 1, 2).range).toBeNull();
  });
  it('trims the new note to the gap between overlapping neighbours', () => {
    const r = placeNewNote([note('a', 0, 1), note('b', 2, 3)], 0.8, 2.4);
    expect(r.range).toEqual([1, 2]);
    expect(r.kept.map(n => n.id)).toEqual(['a', 'b']);
  });
  it('replaces notes whose middle is inside the selection', () => {
    const r = placeNewNote([note('a', 1, 2), note('b', 3, 4)], 0.5, 2.5);
    expect(r.range).toEqual([0.5, 2.5]);
    expect(r.kept.map(n => n.id)).toEqual(['b']);
  });
});

describe('fallbackNotePitch', () => {
  it('uses the nearest note, then nearby f0, then A3', () => {
    expect(fallbackNotePitch([note('a', 0, 1, 300), note('b', 5, 6, 400)], [], 1.5, 2)).toBe(300);
    const frames: PitchFrame[] = [{ timestamp: 3, frequency: 250, hasPitch: true } as PitchFrame];
    expect(fallbackNotePitch([], frames, 1.5, 2)).toBe(250);
    expect(fallbackNotePitch([], [], 1.5, 2)).toBe(220);
  });
});

describe('isFrameInRange', () => {
  it('covers exactly one frame for a one-frame selection', () => {
    const hop = 0.01;
    const frames = [0, 1, 2, 3].map(k => k * hop);
    expect(frames.filter(t => isFrameInRange(t, hop, 2 * hop))).toEqual([hop]);
  });
});
