
import { Note, PitchFrame } from "../types";
import { YIN_HOP_SIZE } from "../services/yin";

// Snap time to nearest analysis frame
export const snapTime = (time: number, sampleRate: number): number => {
    if (!sampleRate) return time;
    const frameDur = YIN_HOP_SIZE / sampleRate;
    return Math.round(time / frameDur) * frameDur;
};

// Calculate median pitch from frames
export const calculateMedianPitch = (frames: PitchFrame[]): number => {
  const freqs = frames
    .filter(f => f.hasPitch && f.frequency > 0)
    .map(f => f.frequency)
    .sort((a, b) => a - b);
  
  if (freqs.length === 0) return 0;
  
  const mid = Math.floor(freqs.length / 2);
  if (freqs.length % 2 === 0) {
      return (freqs[mid - 1] + freqs[mid]) / 2;
  }
  return freqs[mid];
};

// Split a note into two at a specific time
export const splitNote = (
    note: Note, 
    splitTime: number, 
    pitchData: PitchFrame[]
): Note[] | null => {
    if (splitTime <= note.start + 0.01 || splitTime >= note.end - 0.01) return null;

    const leftFrames = pitchData.filter(
        f => f.timestamp >= note.start && f.timestamp <= splitTime
    );
    let leftPitch = calculateMedianPitch(leftFrames);
    if (leftPitch === 0) leftPitch = note.pitch;

    const rightFrames = pitchData.filter(
        f => f.timestamp >= splitTime && f.timestamp <= note.end
    );
    let rightPitch = calculateMedianPitch(rightFrames);
    if (rightPitch === 0) rightPitch = note.pitch;

    const leftNote: Note = {
        ...note,
        id: crypto.randomUUID(),
        end: splitTime,
        pitch: leftPitch
    };

    const rightNote: Note = {
        ...note,
        id: crypto.randomUUID(),
        start: splitTime,
        pitch: rightPitch
    };

    return [leftNote, rightNote];
};

// Shortest note a boundary move can leave (seconds)
export const MIN_NOTE_DURATION = 0.01;
// Boundaries closer than this are treated as shared (touching)
const TOUCH_EPSILON = 1e-6;

/**
 * Make room for a note created from a selection. Notes whose middle lies inside the
 * selection are replaced; the new note is then trimmed to the free gap between the
 * remaining notes, so notes never overlap. Returns null when there is no room
 * (e.g. the selection lies inside a longer note).
 */
export const placeNewNote = (notes: Note[], start: number, end: number) => {
    if (notes.some(n => n.start <= start && n.end >= end)) return { kept: notes, range: null };
    const kept = notes.filter(n => !((n.start + n.end) / 2 >= start && (n.start + n.end) / 2 <= end));
    let a = start, b = end;
    for (const n of kept) {
        if (n.end <= a + TOUCH_EPSILON || n.start >= b - TOUCH_EPSILON) continue;
        if (n.start <= a) a = n.end;        // overlaps the left end
        else if (n.end >= b) b = n.start;   // overlaps the right end
    }
    return { kept, range: b - a >= MIN_NOTE_DURATION ? [a, b] as [number, number] : null };
};

/**
 * Move one boundary of a note without ever overlapping its neighbour.
 * A boundary shared with a touching neighbour moves both notes (one time point).
 * A free boundary that reaches the neighbour joins it and then moves both.
 * The neighbour never shrinks below MIN_NOTE_DURATION.
 * With `detach` (Alt held) only this note moves, and it stops at the neighbour.
 */
export const moveNoteBoundary = (
    notes: Note[],
    noteId: string,
    edge: 'start' | 'end',
    time: number,
    duration = Infinity,
    detach = false
): Note[] => {
    const sorted = [...notes].sort((a, b) => a.start - b.start);
    const i = sorted.findIndex(n => n.id === noteId);
    if (i < 0) return notes;
    const note = sorted[i];
    const result = [...sorted];

    if (edge === 'start') {
        const prev = sorted[i - 1];
        const shared = !!prev && Math.abs(prev.end - note.start) < TOUCH_EPSILON;
        const lower = !prev ? 0 : detach ? prev.end : prev.start + MIN_NOTE_DURATION;
        const t = Math.max(lower, Math.min(note.end - MIN_NOTE_DURATION, time));
        result[i] = { ...note, start: t };
        if (prev && !detach && (shared || t < prev.end)) result[i - 1] = { ...prev, end: t };
    } else {
        const next = sorted[i + 1];
        const shared = !!next && Math.abs(next.start - note.end) < TOUCH_EPSILON;
        const upper = !next ? duration : detach ? next.start : next.end - MIN_NOTE_DURATION;
        const t = Math.min(upper, Math.max(note.start + MIN_NOTE_DURATION, time));
        result[i] = { ...note, end: t };
        if (next && !detach && (shared || t > next.start)) result[i + 1] = { ...next, start: t };
    }
    return result;
};

// Apply a new [start, end] for a note through moveNoteBoundary (no pitch update)
export const applyNoteResize = (
    notes: Note[],
    noteId: string,
    newStart: number,
    newEnd: number,
    duration = Infinity,
    detach = false
): Note[] => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return notes;
    let result = notes;
    if (newStart !== note.start) result = moveNoteBoundary(result, noteId, 'start', newStart, duration, detach);
    if (newEnd !== note.end) result = moveNoteBoundary(result, noteId, 'end', newEnd, duration, detach);
    return result;
};

// Resize a note (and a touching or reached neighbour), then update the pitch of every note that changed
export const resizeNoteWithPush = (
    allNotes: Note[], 
    targetNoteId: string, 
    newStart: number, 
    newEnd: number, 
    pitchData: PitchFrame[],
    duration = Infinity,
    detach = false
): Note[] => {
    const before = new Map(allNotes.map(n => [n.id, n]));
    return applyNoteResize(allNotes, targetNoteId, newStart, newEnd, duration, detach).map(n => {
        const old = before.get(n.id);
        if (old && old.start === n.start && old.end === n.end) return n;
        const frames = pitchData.filter(f => f.timestamp >= n.start && f.timestamp <= n.end);
        const pitch = calculateMedianPitch(frames);
        return { ...n, pitch: pitch > 0 ? pitch : n.pitch };
    });
};

// Get context range for a note (neighboring area)
export const getNoteContextRange = (note: Note, paddingSeconds: number): [number, number] => {
    let start = note.start - paddingSeconds;
    let end = note.end + paddingSeconds;
    
    return [Math.max(0, start), end];
};
