
import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { PitchFrame, Note, SpectrogramData } from '../types';
import { drawSpectrogram, drawGrid, drawNotes, drawPitchCurve, drawCandidates, drawSelection } from '../utils/renderUtils';

interface PitchVisualizerProps {
  pitchData: PitchFrame[];
  notes: Note[]; 
  spectrogramData: SpectrogramData | null;
  showSpectrogram: boolean;
  showPitch: boolean;
  showNotes: boolean;
  currentTime: number;
  duration: number;
  zoom: number; // Pixels per second
  containerHeight: number;
  viewStartTime: number;
  selectionRange: [number, number] | null;
  showCandidates: boolean;
  frameDuration: number; // New prop for grid snapping
  onViewScroll: (startTime: number) => void;
  onSeek: (time: number) => void;
  onZoomWheel: (deltaY: number, mouseTime: number) => void;
  onSelectionChange: (range: [number, number] | null) => void;
  onNoteResize: (noteId: string, newStart: number, newEnd: number) => void;
}

type InteractionMode = 'NONE' | 'SELECTING' | 'RESIZE_START' | 'RESIZE_END';

const PitchVisualizer: React.FC<PitchVisualizerProps> = ({
  pitchData,
  notes,
  spectrogramData,
  showSpectrogram,
  showPitch,
  showNotes,
  currentTime,
  duration,
  zoom,
  containerHeight,
  viewStartTime,
  selectionRange,
  showCandidates,
  frameDuration,
  onViewScroll,
  onSeek,
  onZoomWheel,
  onSelectionChange,
  onNoteResize
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Flag to ignore scroll events triggered by our own zoom logic
  const isProgrammaticScroll = useRef(false);
  
  // Derived width
  const width = Math.max(window.innerWidth, duration * zoom + window.innerWidth);

  // Interaction State
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('NONE');
  const dragStartRef = useRef<number>(0); // Raw time for click detection
  
  const selectionAnchorRef = useRef<number>(0); // Snapped time for selection logic
  const initialSelectionRef = useRef<[number, number] | null>(null);

  // Handle Scroll
  const handleScroll = () => {
    if (isProgrammaticScroll.current) return;
    if (containerRef.current) {
        const time = containerRef.current.scrollLeft / zoom;
        onViewScroll(time);
    }
  };

  // Sync scroll position from external
  useLayoutEffect(() => {
    if (containerRef.current) {
        const targetScroll = viewStartTime * zoom;
        if (Math.abs(containerRef.current.scrollLeft - targetScroll) > 1) {
            isProgrammaticScroll.current = true;
            containerRef.current.scrollLeft = targetScroll;
            setTimeout(() => { isProgrammaticScroll.current = false; }, 50);
        }
    }
  }, [viewStartTime, zoom]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const scrollLeft = containerRef.current.scrollLeft;
        const mouseX = e.clientX - rect.left;
        const mouseTime = (scrollLeft + mouseX) / zoom;
        onZoomWheel(e.deltaY, mouseTime);
      }
    }
  };

  const getTimeAtMouse = (clientX: number) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const scrollLeft = containerRef.current.scrollLeft;
    const x = clientX - rect.left;
    return Math.max(0, Math.min(duration, (scrollLeft + x) / zoom));
  };

  // Snap Logic
  const getSnappedTime = (time: number, e?: React.MouseEvent) => {
    if (e?.shiftKey) return time;

    const SNAP_THRESHOLD_PX = 10;
    const thresholdSeconds = SNAP_THRESHOLD_PX / zoom;
    
    let bestTime = time;
    let minDiff = thresholdSeconds;

    notes.forEach(note => {
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

    if (minDiff === thresholdSeconds && frameDuration > 0) {
        const gridTime = Math.round(time / frameDuration) * frameDuration;
        bestTime = gridTime;
    }

    if (Math.abs(time - 0) < minDiff) bestTime = 0;
    if (Math.abs(time - duration) < minDiff) bestTime = duration;

    return bestTime;
  };

  // Handle Double Click to Select Note
  const handleDoubleClick = (e: React.MouseEvent) => {
    const time = getTimeAtMouse(e.clientX);
    const note = notes.find(n => time >= n.start && time <= n.end);
    
    if (note) {
        onSelectionChange([note.start, note.end]);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); 
    
    const rawTime = getTimeAtMouse(e.clientX);
    
    dragStartRef.current = rawTime;

    const handleThreshold = 5 / zoom; 
    let mode: InteractionMode = 'SELECTING';
    
    // 1. Check Resize Handles (Highest Priority)
    if (selectionRange) {
        const [start, end] = selectionRange;
        if (Math.abs(rawTime - start) < handleThreshold) {
            mode = 'RESIZE_START';
        } else if (Math.abs(rawTime - end) < handleThreshold) {
            mode = 'RESIZE_END';
        }
    }
    
    // Determine the anchor point for the operation
    if (mode === 'SELECTING') {
        selectionAnchorRef.current = getSnappedTime(rawTime, e);
    }

    initialSelectionRef.current = selectionRange;
    setInteractionMode(mode);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rawTime = getTimeAtMouse(e.clientX);
    const snappedTime = getSnappedTime(rawTime, e); 

    // Update Cursor Style
    if (interactionMode === 'NONE' && containerRef.current) {
        const handleThreshold = 5 / zoom;
        let cursor = 'crosshair';
        
        // Check Handles
        if (selectionRange) {
            const [start, end] = selectionRange;
            if (Math.abs(rawTime - start) < handleThreshold || Math.abs(rawTime - end) < handleThreshold) {
                cursor = 'col-resize';
            }
        }
        containerRef.current.style.cursor = cursor;
    }

    // Handle Active Interactions
    if (interactionMode !== 'NONE') {
        if (interactionMode === 'SELECTING') {
            const anchor = selectionAnchorRef.current;
            const start = Math.min(anchor, snappedTime);
            const end = Math.max(anchor, snappedTime);
            onSelectionChange([start, end]);
        } else if (interactionMode === 'RESIZE_START' && initialSelectionRef.current) {
            const oldEnd = initialSelectionRef.current[1];
            const newStart = Math.min(snappedTime, oldEnd - 0.001);
            onSelectionChange([newStart, oldEnd]);
        } else if (interactionMode === 'RESIZE_END' && initialSelectionRef.current) {
            const oldStart = initialSelectionRef.current[0];
            const newEnd = Math.max(snappedTime, oldStart + 0.001);
            onSelectionChange([oldStart, newEnd]);
        } 
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Check Smart Resize
    if ((interactionMode === 'RESIZE_START' || interactionMode === 'RESIZE_END') && initialSelectionRef.current && selectionRange) {
        const [initStart, initEnd] = initialSelectionRef.current;
        const [currStart, currEnd] = selectionRange;
        const matchingNote = notes.find(n => Math.abs(n.start - initStart) < 0.001 && Math.abs(n.end - initEnd) < 0.001);
        if (matchingNote) {
            onNoteResize(matchingNote.id, currStart, currEnd);
        }
    }

    if (interactionMode === 'SELECTING') {
        const time = getTimeAtMouse(e.clientX);
        const diff = Math.abs(time - dragStartRef.current);
        if (diff < (3 / zoom)) { 
             if (!selectionRange || (time < selectionRange[0] || time > selectionRange[1])) {
                 onSelectionChange(null);
                 onSeek(time);
             } else {
                onSeek(time);
             }
        }
    }
    
    // Clear Drag State
    setInteractionMode('NONE');
  };

  // --- DRAW CANVAS ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = width;
    canvas.height = containerHeight;

    const visibleWidth = window.innerWidth;

    // 1. Clear & Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, containerHeight);

    // 2. Spectrogram
    if (showSpectrogram) {
        drawSpectrogram(ctx, spectrogramData, pitchData, viewStartTime, zoom, visibleWidth, containerHeight, duration, showPitch);
    }
    
    // 3. Selection (Background highlight)
    if (selectionRange) {
        drawSelection(ctx, selectionRange, viewStartTime, zoom, visibleWidth, containerHeight);
    }

    // 4. Grid
    drawGrid(ctx, viewStartTime, zoom, visibleWidth, containerHeight);

    // 5. Notes
    if (showNotes) {
        drawNotes(ctx, notes, viewStartTime, zoom, visibleWidth, containerHeight);
    }

    // 6. Candidates
    if (showCandidates && selectionRange && showPitch) {
        drawCandidates(ctx, pitchData, viewStartTime, zoom, visibleWidth, containerHeight, selectionRange);
    }

    // 7. Main Pitch
    if (showPitch) {
        drawPitchCurve(ctx, pitchData, viewStartTime, zoom, visibleWidth, containerHeight);
    }
    
  }, [pitchData, notes, spectrogramData, showSpectrogram, width, zoom, containerHeight, selectionRange, showCandidates, viewStartTime, showPitch, showNotes, duration]);

  return (
    <div 
        ref={containerRef} 
        className="flex-1 overflow-hidden bg-white relative select-none"
        style={{ height: containerHeight }}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onMouseLeave={() => setInteractionMode('NONE')}
    >
      <canvas 
        ref={canvasRef}
        className="block"
        width={width}
        height={containerHeight}
        style={{ width: width, height: containerHeight }}
      />
      
      <div 
        className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none opacity-80"
        style={{ 
          left: `${currentTime * zoom}px`,
          height: containerHeight 
        }}
      />
    </div>
  );
};

export default React.memo(PitchVisualizer);
