
import { PitchFrame, Note, MixerState } from '../types';

/**
 * TONY CSV FORMATS:
 * Pitch: Timestamp(s), Frequency(Hz), Probability
 * Notes: Onset(s), Duration(s), Pitch(Hz)
 */

/**
 * SONIC VISUALISER (SVL) FORMAT:
 * XML based.
 * Pitch uses <point frame="..." value="..." />
 * Notes use <segment frame="..." duration="..." value="..." />
 */

export interface ProjectViewState {
    zoom: number;
    viewStartTime: number;
    currentTime: number;
    selectionRange: [number, number] | null;
}

export interface ProjectSettings {
    isLooping: boolean;
    playbackSpeed: number;
    showSpectrogram: boolean;
    showPitch: boolean;
    showNotes: boolean;
    mixerState: MixerState;
}

export const generateProjectJSON = (
    fileName: string,
    sampleRate: number,
    pitchData: PitchFrame[],
    notes: Note[],
    viewState?: ProjectViewState,
    settings?: ProjectSettings
) => {
    return JSON.stringify({
        version: "1.2",
        fileName,
        sampleRate,
        pitchData,
        notes,
        viewState,
        settings
    }, null, 2);
};

export const generatePitchCSV = (pitchData: PitchFrame[]) => {
    let csv = "Time(s),Frequency(Hz),Probability\n";
    pitchData.forEach(p => {
        csv += `${p.timestamp.toFixed(6)},${p.frequency.toFixed(3)},${p.probability.toFixed(3)}\n`;
    });
    return csv;
};

export const generateNotesCSV = (notes: Note[]) => {
    // Tony Format: Onset, Duration, Pitch
    let csv = "Onset(s),Duration(s),Pitch(Hz)\n";
    notes.forEach(n => {
        const duration = n.end - n.start;
        csv += `${n.start.toFixed(6)},${duration.toFixed(6)},${n.pitch.toFixed(3)}\n`;
    });
    return csv;
};

export const generateSVL = (
    pitchData: PitchFrame[],
    notes: Note[],
    sampleRate: number,
    layerName: string
) => {
    // Basic SVL Header
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE sv>
<sv>
  <data>
    <model id="1" name="" sampleRate="${sampleRate}" start="0" end="${pitchData.length > 0 ? Math.ceil(pitchData[pitchData.length-1].timestamp * sampleRate) : 0}" type="sparse" dimensions="1" resolution="1" notifyOnAdd="true" dataset="2" subtype="rectangular" minimum="0" maximum="1200" units="Hz" />
    <dataset id="2" dimensions="1">`;

    // Add Pitch Points
    pitchData.forEach(p => {
        if (p.hasPitch && p.frequency > 0) {
            const frame = Math.round(p.timestamp * sampleRate);
            // SVL uses label for probability sometimes, but let's stick to standard value
            xml += `\n      <point frame="${frame}" value="${p.frequency}" label="${p.probability.toFixed(2)}" />`;
        }
    });

    // Add Notes (Segments)
    xml += `\n    </dataset>`;

    if (notes.length > 0) {
        xml += `\n    <model id="3" name="Notes" sampleRate="${sampleRate}" start="0" end="0" type="sparse" dimensions="1" resolution="1" notifyOnAdd="true" dataset="4" subtype="segment" minimum="0" maximum="1200" units="Hz" />
    <dataset id="4" dimensions="1">`;
        notes.forEach(n => {
            const frame = Math.round(n.start * sampleRate);
            const durationFrames = Math.round((n.end - n.start) * sampleRate);
            xml += `\n      <segment frame="${frame}" duration="${durationFrames}" value="${n.pitch}" />`;
        });
        xml += `\n    </dataset>`;
    }

    xml += `\n  </data>\n</sv>`;
    return xml;
};

// --- PARSING ---

export const parseProjectJSON = (jsonString: string) => {
    try {
        const data = JSON.parse(jsonString);
        // Basic validation
        if (!data.pitchData || !Array.isArray(data.pitchData)) throw new Error("Invalid Project File");
        return data;
    } catch (e) {
        console.error(e);
        return null;
    }
};

export const parseCSV = (csvString: string, type: 'pitch' | 'note'): any[] => {
    const lines = csvString.split('\n');
    const result = [];
    // Skip header if present (check for alphabet chars)
    let startIndex = 0;
    if (lines[0] && /[a-zA-Z]/.test(lines[0])) startIndex = 1;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length < 2) continue;

        if (type === 'pitch') {
            const t = parseFloat(parts[0]);
            const f = parseFloat(parts[1]);
            const p = parts[2] ? parseFloat(parts[2]) : 1.0;
            if (!isNaN(t)) {
                result.push({
                    timestamp: t,
                    frequency: isNaN(f) ? 0 : f,
                    probability: p,
                    hasPitch: f > 0,
                    candidates: []
                });
            }
        } else {
            // Note: Onset, Duration, Pitch
            const start = parseFloat(parts[0]);
            const dur = parseFloat(parts[1]);
            const pitch = parseFloat(parts[2]);
            if (!isNaN(start) && !isNaN(dur)) {
                result.push({
                    id: crypto.randomUUID(),
                    start: start,
                    end: start + dur,
                    pitch: isNaN(pitch) ? 0 : pitch,
                    state: 'default'
                });
            }
        }
    }
    return result;
};
