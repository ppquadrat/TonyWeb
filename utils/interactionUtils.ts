
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

export const findNoteInteraction = (
    rawTime: number, 
    mouseY: number, 
    notes: Note[], 
    zoom: number, 
    containerHeight: number, 
    selectedNoteId: string | null
): NoteInteractionResult | null => {
      const handleThreshold = DIMENSIONS.handleThresholdPx / zoom; 
      const NOTE_HALF_HEIGHT = DIMENSIONS.noteInteractionHeight / 2; 

      // PRIORITY 1: Note Starts (Onsets)
      for (const note of notes) {
        const noteY = freqToY(note.pitch, containerHeight);
        if (Math.abs(mouseY - noteY) > NOTE_HALF_HEIGHT) continue; 

        if (Math.abs(rawTime - note.start) < handleThreshold) {
            return {
                mode: 'RESIZE_NOTE_START',
                noteId: note.id,
                bounds: [note.start, note.end],
                pitch: note.pitch
            };
        }
      }

      // PRIORITY 2: Note Ends (Offsets)
      for (const note of notes) {
        const noteY = freqToY(note.pitch, containerHeight);
        if (Math.abs(mouseY - noteY) > NOTE_HALF_HEIGHT) continue; 

        if (Math.abs(rawTime - note.end) < handleThreshold) {
            return {
                mode: 'RESIZE_NOTE_END',
                noteId: note.id,
                bounds: [note.start, note.end],
                pitch: note.pitch
            };
        }
      }

      // PRIORITY 3: Note Body (ONLY if selected) for Vertical Move
      if (selectedNoteId) {
          const selectedNote = notes.find(n => n.id === selectedNoteId);
          if (selectedNote) {
              const noteY = freqToY(selectedNote.pitch, containerHeight);
              const inTime = rawTime >= selectedNote.start && rawTime <= selectedNote.end;
              const inPitch = Math.abs(mouseY - noteY) < NOTE_HALF_HEIGHT;
              
              if (inTime && inPitch) {
                  return {
                      mode: 'MOVE_VERTICAL',
                      noteId: selectedNote.id,
                      bounds: [selectedNote.start, selectedNote.end],
                      pitch: selectedNote.pitch
                  };
              }
          }
      }

      return null;
};
