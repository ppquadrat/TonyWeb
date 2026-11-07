
import { Note } from '../types';
import { freqToY } from './renderUtils';
import { DIMENSIONS } from '../constants';

export type InteractionMode = 'NONE' | 'SELECTING' | 'RESIZE_SELECTION_START' | 'RESIZE_SELECTION_END' | 'RESIZE_NOTE_START' | 'RESIZE_NOTE_END' | 'MOVE_VERTICAL';

export const getSnappedTime = (
    time: number, 
    notes: Note[], 
    zoom: number, 
    frameDuration: number, 
    duration: number,
    ignoreNoteId: string | null, 
    shiftKey: boolean
) => {
    if (shiftKey) return time;

    const thresholdSeconds = DIMENSIONS.snapThresholdPx / zoom;
    
    let bestTime = time;
    let minDiff = thresholdSeconds;

    // 1. Snap to other notes
    notes.forEach(note => {
        if (note.id === ignoreNoteId) return; // Don't snap to self
        const diffStart = Math.abs(time - note.start);
        if (diffStart < minDiff) {
            minDiff = diffStart;
            bestTime = note.start;
        }
        const diffEnd = Math.abs(time - note.end);
        if (diffEnd < minDiff) {
            minDiff = diffEnd;
            bestTime = note.end;
        }
    });

    // 2. Snap to Grid (Frames) if no note boundary is closer
    if (minDiff === thresholdSeconds && frameDuration > 0) {
        const gridTime = Math.round(time / frameDuration) * frameDuration;
        bestTime = gridTime;
    }

    if (Math.abs(time - 0) < minDiff) bestTime = 0;
    if (Math.abs(time - duration) < minDiff) bestTime = duration;

    return bestTime;
};

export interface NoteInteractionResult {
    mode: InteractionMode;
    noteId: string;
    bounds: [number, number];
    pitch: number;
}

// Edge grab zone for a note: never more than a quarter of the note's width,
// so even short notes keep a body that can be grabbed.
export const getEdgeThreshold = (note: Note, zoom: number) => {
    const handleThreshold = DIMENSIONS.handleThresholdPx / zoom;
    return Math.min(handleThreshold, (note.end - note.start) / 4);
};

// Is the point on the note (time within the note, y within the note's hit height)?
export const isOnNote = (rawTime: number, mouseY: number, note: Note, containerHeight: number) => {
    const noteY = freqToY(note.pitch, containerHeight);
    const inTime = rawTime >= note.start && rawTime <= note.end;
    const inPitch = Math.abs(mouseY - noteY) < DIMENSIONS.noteInteractionHeight / 2;
    return inTime && inPitch;
};

export const findNoteInteraction = (
    rawTime: number, 
    mouseY: number, 
    notes: Note[], 
    zoom: number, 
    containerHeight: number, 
    selectedNoteId: string | null
): NoteInteractionResult | null => {
      const NOTE_HALF_HEIGHT = DIMENSIONS.noteInteractionHeight / 2; 

      // PRIORITY 1: Body of the selected note (vertical pitch move).
      // Checked first so that edges of the note or its neighbours can't steal the grab.
      if (selectedNoteId) {
          const selectedNote = notes.find(n => n.id === selectedNoteId);
          if (selectedNote && isOnNote(rawTime, mouseY, selectedNote, containerHeight)) {
              const edge = getEdgeThreshold(selectedNote, zoom);
              if (rawTime > selectedNote.start + edge && rawTime < selectedNote.end - edge) {
                  return {
                      mode: 'MOVE_VERTICAL',
                      noteId: selectedNote.id,
                      bounds: [selectedNote.start, selectedNote.end],
                      pitch: selectedNote.pitch
                  };
              }
          }
      }

      // PRIORITY 2: Note Starts (Onsets)
      for (const note of notes) {
        const noteY = freqToY(note.pitch, containerHeight);
        if (Math.abs(mouseY - noteY) > NOTE_HALF_HEIGHT) continue; 

        if (Math.abs(rawTime - note.start) < getEdgeThreshold(note, zoom)) {
            return {
                mode: 'RESIZE_NOTE_START',
                noteId: note.id,
                bounds: [note.start, note.end],
                pitch: note.pitch
            };
        }
      }

      // PRIORITY 3: Note Ends (Offsets)
      for (const note of notes) {
        const noteY = freqToY(note.pitch, containerHeight);
        if (Math.abs(mouseY - noteY) > NOTE_HALF_HEIGHT) continue; 

        if (Math.abs(rawTime - note.end) < getEdgeThreshold(note, zoom)) {
            return {
                mode: 'RESIZE_NOTE_END',
                noteId: note.id,
                bounds: [note.start, note.end],
                pitch: note.pitch
            };
        }
      }

      return null;
};
