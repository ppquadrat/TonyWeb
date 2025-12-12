
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

// Handle smart resizing (pushing neighbors)
export const resizeNoteWithPush = (
    allNotes: Note[], 
    targetNoteId: string, 
    newStart: number, 
    newEnd: number, 
    pitchData: PitchFrame[]
): Note[] => {
    const targetNote = allNotes.find(n => n.id === targetNoteId);
    if (!targetNote) return allNotes;

    const otherNotes = allNotes.filter(n => n.id !== targetNoteId);
    const modifiedNotes: Note[] = [];
    const notesToDelete: string[] = [];

    // Push Neighbors
    otherNotes.forEach(neighbor => {
        let nStart = neighbor.start;
        let nEnd = neighbor.end;
        let changed = false;

        if (newEnd > nStart + 0.001 && newStart < nEnd - 0.001) {
            changed = true;
            if (nStart >= targetNote.start && nEnd > targetNote.end) {
                 nStart = newEnd;
            } else if (nEnd <= targetNote.end && nStart < targetNote.start) {
                 nEnd = newStart;
            } else {
                 if (nStart < newStart) nEnd = newStart;
                 else nStart = newEnd;
            }
        }

        if (changed) {
            if (nEnd - nStart < 0.01) {
                notesToDelete.push(neighbor.id);
            } else {
                modifiedNotes.push({ ...neighbor, start: nStart, end: nEnd });
            }
        }
    });

    // Recalculate Neighbors
    const finalOtherNotes = otherNotes.map(n => {
        const mod = modifiedNotes.find(mn => mn.id === n.id);
        if (notesToDelete.includes(n.id)) return null;
        if (mod) {
            const frames = pitchData.filter(f => f.timestamp >= mod.start && f.timestamp <= mod.end);
            const pitch = calculateMedianPitch(frames);
            return { ...mod, pitch: pitch > 0 ? pitch : mod.pitch };
        }
        return n;
    }).filter((n): n is Note => n !== null);

    // Recalculate Target
    const targetFrames = pitchData.filter(f => f.timestamp >= newStart && f.timestamp <= newEnd);
    const targetPitch = calculateMedianPitch(targetFrames);

    const updatedTargetNote: Note = {
        ...targetNote,
        start: newStart,
        end: newEnd,
        pitch: targetPitch > 0 ? targetPitch : targetNote.pitch
    };

    return [...finalOtherNotes, updatedTargetNote].sort((a, b) => a.start - b.start);
};

// Get context range for a note (neighboring area)
export const getNoteContextRange = (note: Note, paddingSeconds: number): [number, number] => {
    let start = note.start - paddingSeconds;
    let end = note.end + paddingSeconds;
    
    return [Math.max(0, start), end];
};
