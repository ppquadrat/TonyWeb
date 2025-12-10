
import { PitchFrame, Note, SpectrogramData } from '../types';

export const MIN_PITCH = 50;
export const MAX_PITCH = 5000;
export const RULER_HEIGHT = 20;

// Coordinate helpers
export const freqToY = (f: number, containerHeight: number) => {
    const logF = Math.log(f);
    const logMin = Math.log(MIN_PITCH);
    const logMax = Math.log(MAX_PITCH);
    const normalized = (logF - logMin) / (logMax - logMin);
    const availableHeight = containerHeight - RULER_HEIGHT;
    return (containerHeight) - (normalized * availableHeight);
};

export const yToFreq = (y: number, containerHeight: number) => {
     const availableHeight = containerHeight - RULER_HEIGHT;
     const normalized = (containerHeight - y) / availableHeight;
     const logMin = Math.log(MIN_PITCH);
     const logMax = Math.log(MAX_PITCH);
     const logF = normalized * (logMax - logMin) + logMin;
     return Math.exp(logF);
};

export const formatTime = (seconds: number, interval: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (interval < 1) {
     const ms = Math.round((seconds % 1) * 10);
     return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// --- DRAWING FUNCTIONS ---

export const drawSpectrogram = (
    ctx: CanvasRenderingContext2D,
    spectrogramData: SpectrogramData | null,
    pitchData: PitchFrame[],
    viewStartTime: number,
    zoom: number,
    visibleWidth: number,
    containerHeight: number,
    duration: number,
    showPitchMask: boolean
) => {
    if (!spectrogramData || duration <= 0) return;
    const { magnitude2d, width: specWidth, height: specHeight, maxMagnitude } = spectrogramData;

    const imgWidth = Math.ceil(visibleWidth);
    const imgHeight = containerHeight - RULER_HEIGHT;
    if (imgWidth <= 0 || imgHeight <= 0) return;

    const imageData = ctx.createImageData(imgWidth, imgHeight);
    const data = imageData.data;

    // Pre-calculate Pitch Trajectory for Suppression
    const pitchMap = new Float32Array(imgWidth).fill(-1);
    if (showPitchMask) {
        let pIdx = 0;
        while(pIdx < pitchData.length && pitchData[pIdx].timestamp < viewStartTime) pIdx++;
        for (let x = 0; x < imgWidth; x++) {
            const time = viewStartTime + (x / zoom);
            while(pIdx < pitchData.length - 1 && pitchData[pIdx + 1].timestamp <= time) pIdx++;
            const frame = pitchData[pIdx];
            if (frame && Math.abs(frame.timestamp - time) < (0.1) && frame.hasPitch) {
                pitchMap[x] = freqToY(frame.frequency, containerHeight) - RULER_HEIGHT;
            }
        }
    }

    // Pre-calc Y to Bin mapping
    const binMap = new Float32Array(imgHeight);
    for(let y = 0; y < imgHeight; y++) {
         const canvasY = y + RULER_HEIGHT;
         const freq = yToFreq(canvasY, containerHeight);
         const nyquist = 22050; // Approx
         const bin = (freq / nyquist) * specHeight;
         binMap[y] = bin;
    }

    for (let x = 0; x < imgWidth; x++) {
         const time = viewStartTime + (x / zoom);
         const frameIdx = Math.floor((time / duration) * specWidth);
         
         if (frameIdx >= 0 && frameIdx < specWidth) {
             const magFrame = magnitude2d[frameIdx];
             if (!magFrame) continue;

             const f0_y = pitchMap[x];

             for (let y = 0; y < imgHeight; y++) {
                 const binPos = binMap[y];
                 const bin = Math.floor(binPos);
                 
                 if (bin >= 0 && bin < specHeight - 1) {
                     const frac = binPos - bin;
                     const m1 = magFrame[bin];
                     const m2 = magFrame[bin+1];
                     const mag = m1 + (m2 - m1) * frac;
                     
                     let db = 20 * Math.log10(mag / maxMagnitude + 1e-6); 
                     let norm = (db + 50) / 50; 
                     norm = Math.max(0, Math.min(1, norm));
                     norm = Math.pow(norm, 3.0);
                     const val = Math.floor((1 - norm) * 255);
                     
                     let alpha = 255;
                     if (f0_y > 0 && Math.abs(y - f0_y) < 10) { 
                         const dist = Math.abs(y - f0_y);
                         const factor = dist / 10;
                         const blended = val * factor + 255 * (1 - factor);
                         const idx = (y * imgWidth + x) * 4;
                         data[idx] = blended; data[idx+1] = blended; data[idx+2] = blended; data[idx+3] = 255;     
                     } else {
                         const idx = (y * imgWidth + x) * 4;
                         data[idx] = val; data[idx+1] = val; data[idx+2] = val; data[idx+3] = 255;
                     }
                 }
             }
         }
    }
    ctx.putImageData(imageData, viewStartTime * zoom, RULER_HEIGHT);
};

export const drawGrid = (
    ctx: CanvasRenderingContext2D,
    viewStartTime: number,
    zoom: number,
    visibleWidth: number,
    containerHeight: number
) => {
    const visibleStartX = viewStartTime * zoom;
    const visibleEndX = visibleStartX + visibleWidth;

    // Frequency Grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    [55, 110, 220, 440, 880, 1760, 3520].forEach(f => {
        const y = freqToY(f, containerHeight);
        ctx.beginPath();
        ctx.moveTo(visibleStartX, y);
        ctx.lineTo(visibleEndX, y);
        ctx.stroke();
        ctx.fillStyle = '#6b7280';
        ctx.fillText(`${f}Hz`, visibleStartX + 5, y - 6);
    });

    // Time Ruler
    ctx.fillStyle = '#f9fafb'; 
    ctx.fillRect(visibleStartX, 0, visibleWidth, RULER_HEIGHT);
    ctx.beginPath();
    ctx.strokeStyle = '#d1d5db'; 
    ctx.moveTo(visibleStartX, RULER_HEIGHT);
    ctx.lineTo(visibleEndX, RULER_HEIGHT);
    ctx.stroke();

    const minPxPerTick = 100;
    const intervals = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
    let timeInterval = 60;
    for (const val of intervals) {
        if (val * zoom >= minPxPerTick) { timeInterval = val; break; }
    }

    ctx.fillStyle = '#4b5563'; 
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '10px sans-serif';

    const startTimeTick = Math.floor(viewStartTime / timeInterval) * timeInterval;
    const endTimeTick = startTimeTick + (visibleWidth / zoom) + timeInterval;
    
    for (let t = startTimeTick; t <= endTimeTick; t += timeInterval) {
        const x = t * zoom;
        ctx.beginPath();
        ctx.strokeStyle = '#f3f4f6'; 
        ctx.moveTo(x, RULER_HEIGHT);
        ctx.lineTo(x, containerHeight);
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = '#9ca3af'; 
        ctx.moveTo(x, 0);
        ctx.lineTo(x, RULER_HEIGHT - 5);
        ctx.stroke();

        const label = formatTime(t, timeInterval);
        ctx.fillText(label, x + 4, 4);
    }
};

export const drawNotes = (
    ctx: CanvasRenderingContext2D,
    notes: Note[],
    viewStartTime: number,
    zoom: number,
    visibleWidth: number,
    containerHeight: number
) => {
    ctx.fillStyle = '#93c5fd'; 
    ctx.strokeStyle = '#3b82f6'; 
    const NOTE_HEIGHT_PX = 14; 
    const visibleNotes = notes.filter(n => n.end > viewStartTime && n.start < viewStartTime + (visibleWidth/zoom));

    visibleNotes.forEach(note => {
        const x = note.start * zoom;
        const w = (note.end - note.start) * zoom;
        const yCenter = freqToY(note.pitch, containerHeight);
        const y = yCenter - (NOTE_HEIGHT_PX / 2);
        const visibleY = Math.max(RULER_HEIGHT, y);
        
        ctx.globalAlpha = 0.7;
        ctx.fillRect(x, visibleY, w, NOTE_HEIGHT_PX);
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, visibleY, w, NOTE_HEIGHT_PX);
    });
};

export const drawPitchCurve = (
    ctx: CanvasRenderingContext2D,
    pitchData: PitchFrame[],
    viewStartTime: number,
    zoom: number,
    visibleWidth: number,
    containerHeight: number
) => {
    ctx.fillStyle = '#000000'; 
    const pointRadius = 1.2;
    let pIdx = 0;
    while(pIdx < pitchData.length && pitchData[pIdx].timestamp < viewStartTime) pIdx++;
    
    for(let i = pIdx; i < pitchData.length; i++) {
        const frame = pitchData[i];
        if (frame.timestamp > viewStartTime + (visibleWidth/zoom)) break;
        if (!frame.hasPitch || frame.frequency < MIN_PITCH || frame.frequency > MAX_PITCH) continue;
        
        const x = frame.timestamp * zoom;
        const y = freqToY(frame.frequency, containerHeight);
        if (y < RULER_HEIGHT) continue;

        ctx.beginPath();
        ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
        ctx.fill();
    }
};

export const drawCandidates = (
    ctx: CanvasRenderingContext2D,
    pitchData: PitchFrame[],
    viewStartTime: number,
    zoom: number,
    visibleWidth: number,
    containerHeight: number,
    selectionRange: [number, number]
) => {
      const [selStart, selEnd] = selectionRange;
      ctx.fillStyle = '#eab308'; // yellow-500
      
      let startIdx = 0;
      while(startIdx < pitchData.length && pitchData[startIdx].timestamp < selStart) startIdx++;

      for(let i = startIdx; i < pitchData.length; i++) {
          const frame = pitchData[i];
          if (frame.timestamp > selEnd) break;
          if (frame.timestamp < viewStartTime || frame.timestamp > viewStartTime + (visibleWidth/zoom)) continue;

          if (frame.candidates) {
            const x = frame.timestamp * zoom;
            frame.candidates.forEach(cand => {
                if (cand.frequency < MIN_PITCH || cand.frequency > MAX_PITCH) return;
                const r = 2.5; 
                const y = freqToY(cand.frequency, containerHeight);
                if (y < RULER_HEIGHT) return;

                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
            });
          }
      }
};

export const drawSelection = (
    ctx: CanvasRenderingContext2D,
    selectionRange: [number, number],
    viewStartTime: number,
    zoom: number,
    visibleWidth: number,
    containerHeight: number
) => {
    const [start, end] = selectionRange;
    const x1 = start * zoom;
    const x2 = end * zoom;
    const visibleStartX = viewStartTime * zoom;
    const visibleEndX = visibleStartX + visibleWidth;
    
    // Draw background highlight
    if (x2 > visibleStartX && x1 < visibleEndX) {
        ctx.fillStyle = 'rgba(219, 234, 254, 0.5)'; 
        ctx.fillRect(x1, 0, x2 - x1, containerHeight);
    }

    ctx.strokeStyle = '#3b82f6'; 
    ctx.lineWidth = 1;
    
    if (x1 > visibleStartX && x1 < visibleEndX) {
        ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, containerHeight); ctx.stroke();
        const handleSize = 6;
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1 + handleSize, 0); ctx.lineTo(x1, handleSize); ctx.fill();
    }

    if (x2 > visibleStartX && x2 < visibleEndX) {
        ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, containerHeight); ctx.stroke();
        const handleSize = 6;
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2 - handleSize, 0); ctx.lineTo(x2, handleSize); ctx.fill();
    }
};
