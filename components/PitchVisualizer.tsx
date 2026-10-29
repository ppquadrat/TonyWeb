
import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { PitchFrame, Note, SpectrogramData } from '../types';
import { drawSpectrogram, drawGrid, drawNotes, drawPitchCurve, drawCandidates, drawSelection, freqToY, yToFreq, hzToNoteName } from '../utils/renderUtils';
import { applyNoteResize } from '../utils/noteUtils';
import { getSnappedTime, findNoteInteraction, isOnNote, InteractionMode } from '../utils/interactionUtils';
import { useTimelineWheel } from '../hooks/useTimelineWheel';
import { DIMENSIONS, COLORS } from '../constants';

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
  viewStartTime: number;
  selectionRange: [number, number] | null;
  showCandidates: boolean;
  frameDuration: number; // New prop for grid snapping
  onViewScroll: (startTime: number) => void;
  onSeek: (time: number) => void;
  onZoomWheel: (deltaPixels: number, mouseTime: number) => void;
  onSelectionChange: (range: [number, number] | null) => void;
  onNoteResize: (noteId: string, newStart: number, newEnd: number, detach?: boolean) => void;
  
  // Note Pitch Editing
  selectedNoteId: string | null;
  onNoteSelect: (noteId: string) => void;
  onNotePitchChange: (noteId: string, newPitch: number) => void;
  onPitchDragEnd: (noteId: string, newPitch: number) => void;
}

// Pointer movement below this is a click, not a selection drag
const CLICK_THRESHOLD_PX = 4;

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
  viewStartTime,
  selectionRange,
  showCandidates,
  frameDuration,
  onViewScroll,
  onSeek,
  onZoomWheel,
  onSelectionChange,
  onNoteResize,
  selectedNoteId,
  onNoteSelect,
  onNotePitchChange,
  onPitchDragEnd
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The canvas only covers the visible window (not the whole timeline), so it
  // stays within browser canvas size limits (Firefox caps a canvas at 32767px).
  const [size, setSize] = useState({ width: window.innerWidth, height: 400 });
  const { width, height: containerHeight } = size;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(1, Math.floor(el.clientWidth));
      const h = Math.max(1, Math.floor(el.clientHeight));
      setSize(prev => (prev.width === w && prev.height === h) ? prev : { width: w, height: h });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Cached spectrogram image for the current view; reused while dragging notes
  // so a drag only redraws cheap vector layers.
  const spectrogramCacheRef = useRef<{ canvas: HTMLCanvasElement, key: string, pitchData: PitchFrame[] | null } | null>(null);

  // Interaction State
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('NONE');
  const dragStartRef = useRef<number>(0); // Raw time for click detection
  
  const selectionAnchorRef = useRef<number>(0); // Snapped time for selection logic
  const initialSelectionRef = useRef<[number, number] | null>(null);

  // Direct Note Resizing State
  const activeNoteIdRef = useRef<string | null>(null);
  const activeNoteInitialBoundsRef = useRef<[number, number] | null>(null);
  
  // Dragged Note State (Visuals) & Ref (Logic)
  const [draggedNoteState, setDraggedNoteState] = useState<{id: string, start: number, end: number, pitch?: number, detach?: boolean} | null>(null);
  const draggedNoteRef = useRef<{id: string, start: number, end: number, pitch?: number, detach?: boolean} | null>(null);

  // Vertical Drag State
  const initialDragYRef = useRef<number>(0);
  const initialNotePitchRef = useRef<number>(0);

  // Hover Info State
  const [hoveredNoteInfo, setHoveredNoteInfo] = useState<{ onset: number, pitch: number } | null>(null);

  useTimelineWheel(containerRef, { zoom, viewStartTime, onZoomWheel, onViewScroll });

  const getMouseInfo = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { time: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    const time = Math.max(0, Math.min(duration, viewStartTime + x / zoom));
    return { time, y };
  };

  // Handle Double Click to Select Note
  const handleDoubleClick = (e: React.MouseEvent) => {
    const { time, y } = getMouseInfo(e.clientX, e.clientY);
    const note = notes.find(n => isOnNote(time, y, n, containerHeight));
    
    if (note) {
        // Trigger context selection logic in App
        onNoteSelect(note.id);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); 
    
    const { time: rawTime, y: mouseY } = getMouseInfo(e.clientX, e.clientY);
    dragStartRef.current = rawTime;

    let mode: InteractionMode = 'SELECTING';
    
    // 1. Check Note Interactions
    if (showNotes) {
        const interaction = findNoteInteraction(rawTime, mouseY, notes, zoom, containerHeight, selectedNoteId);
        if (interaction) {
            mode = interaction.mode;
            activeNoteIdRef.current = interaction.noteId;
            activeNoteInitialBoundsRef.current = interaction.bounds;
            
            // Store initial pitch for vertical drag
            initialDragYRef.current = mouseY;
            initialNotePitchRef.current = interaction.pitch || 0;

            const newState = { 
                id: interaction.noteId, 
                start: interaction.bounds[0], 
                end: interaction.bounds[1],
                pitch: interaction.pitch
            };
            setDraggedNoteState(newState);
            draggedNoteRef.current = newState;
        }
    }

    // 2. Check Selection Handles (Secondary Priority)
    if (mode === 'SELECTING' && selectionRange) {
        const handleThreshold = DIMENSIONS.handleThresholdPx / zoom;
        const [start, end] = selectionRange;
        if (Math.abs(rawTime - start) < handleThreshold) {
            mode = 'RESIZE_SELECTION_START';
        } else if (Math.abs(rawTime - end) < handleThreshold) {
            mode = 'RESIZE_SELECTION_END';
        }
    }
    
    // Determine the anchor point for selection operations
    if (mode === 'SELECTING') {
        selectionAnchorRef.current = getSnappedTime(rawTime, notes, zoom, frameDuration, duration, null, e.shiftKey);
    }

    initialSelectionRef.current = selectionRange;
    setInteractionMode(mode);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { time: rawTime, y: mouseY } = getMouseInfo(e.clientX, e.clientY);
    const snappedTime = getSnappedTime(rawTime, notes, zoom, frameDuration, duration, activeNoteIdRef.current, e.shiftKey); 

    // Update Cursor Style & Hover Info
    if (interactionMode === 'NONE' && containerRef.current) {
        let cursor = 'crosshair';
        let foundHoverNote = null;
        
        if (showNotes) {
            // Re-use logic for finding hover targets, but simplified for display
            const hoveredNote = notes.find(note => isOnNote(rawTime, mouseY, note, containerHeight));
            
            if (hoveredNote) {
                foundHoverNote = { onset: hoveredNote.start, pitch: hoveredNote.pitch };
            }

            // Check boundaries for cursor change
            const interaction = findNoteInteraction(rawTime, mouseY, notes, zoom, containerHeight, selectedNoteId);
            if (interaction) {
                if (interaction.mode === 'MOVE_VERTICAL') cursor = 'ns-resize';
                else cursor = 'ew-resize';
            }
        }
        setHoveredNoteInfo(foundHoverNote);

        // Check Selection Handles
        if (cursor === 'crosshair' && selectionRange) {
            const handleThreshold = DIMENSIONS.handleThresholdPx / zoom;
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
            // A click that jitters by a pixel or two is still a click, not a tiny looping selection
            if (Math.abs(rawTime - dragStartRef.current) >= CLICK_THRESHOLD_PX / zoom) {
                const anchor = selectionAnchorRef.current;
                const start = Math.min(anchor, snappedTime);
                const end = Math.max(anchor, snappedTime);
                if (end > start) onSelectionChange([start, end]);
            }

        } else if (interactionMode === 'RESIZE_SELECTION_START' && initialSelectionRef.current) {
            const oldEnd = initialSelectionRef.current[1];
            const newStart = Math.min(snappedTime, oldEnd - 0.001);
            onSelectionChange([newStart, oldEnd]);

        } else if (interactionMode === 'RESIZE_SELECTION_END' && initialSelectionRef.current) {
            const oldStart = initialSelectionRef.current[0];
            const newEnd = Math.max(snappedTime, oldStart + 0.001);
            onSelectionChange([oldStart, newEnd]);

        } else if (interactionMode === 'RESIZE_NOTE_START' && activeNoteInitialBoundsRef.current) {
            const oldEnd = activeNoteInitialBoundsRef.current[1];
            const newStart = Math.min(snappedTime, oldEnd - 0.001);
            if (activeNoteIdRef.current && draggedNoteRef.current) {
                const newState = { ...draggedNoteRef.current, start: newStart, end: oldEnd, detach: e.altKey };
                setDraggedNoteState(newState);
                draggedNoteRef.current = newState;
            }

        } else if (interactionMode === 'RESIZE_NOTE_END' && activeNoteInitialBoundsRef.current) {
            const oldStart = activeNoteInitialBoundsRef.current[0];
            const newEnd = Math.max(snappedTime, oldStart + 0.001);
            if (activeNoteIdRef.current && draggedNoteRef.current) {
                const newState = { ...draggedNoteRef.current, start: oldStart, end: newEnd, detach: e.altKey };
                setDraggedNoteState(newState);
                draggedNoteRef.current = newState;
            }
        } else if (interactionMode === 'MOVE_VERTICAL' && draggedNoteRef.current) {
             // Calculate Pitch Change
             const deltaY = mouseY - initialDragYRef.current;
             const initialY = freqToY(initialNotePitchRef.current, containerHeight);
             const newY = initialY + deltaY;
             const newPitch = yToFreq(newY, containerHeight);
             const newState = { ...draggedNoteRef.current, pitch: newPitch };
             
             setDraggedNoteState(newState);
             draggedNoteRef.current = newState;
        }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Commit Smart Note Resize
    if ((interactionMode === 'RESIZE_NOTE_START' || interactionMode === 'RESIZE_NOTE_END') && draggedNoteRef.current) {
        onNoteResize(draggedNoteRef.current.id, draggedNoteRef.current.start, draggedNoteRef.current.end, draggedNoteRef.current.detach);
    }
    
    // Commit Pitch Change
    if (interactionMode === 'MOVE_VERTICAL' && draggedNoteRef.current && draggedNoteRef.current.pitch) {
        onNotePitchChange(draggedNoteRef.current.id, draggedNoteRef.current.pitch);
        // Trigger Auditory Feedback with explicit arguments
        onPitchDragEnd(draggedNoteRef.current.id, draggedNoteRef.current.pitch);
    }
    
    // Commit Smart Selection Resize
    if ((interactionMode === 'RESIZE_SELECTION_START' || interactionMode === 'RESIZE_SELECTION_END') && initialSelectionRef.current && selectionRange) {
        const [initStart, initEnd] = initialSelectionRef.current;
        const [currStart, currEnd] = selectionRange;
        const matchingNote = notes.find(n => Math.abs(n.start - initStart) < 0.001 && Math.abs(n.end - initEnd) < 0.001);
        if (matchingNote) {
            onNoteResize(matchingNote.id, currStart, currEnd);
        }
    }

    if (interactionMode === 'SELECTING') {
        const { time } = getMouseInfo(e.clientX, e.clientY);
        const diff = Math.abs(time - dragStartRef.current);
        if (diff < (CLICK_THRESHOLD_PX / zoom)) {
             // Click (not drag): keep the selection only when clicking inside it
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
    setDraggedNoteState(null);
    draggedNoteRef.current = null;
    activeNoteIdRef.current = null;
    activeNoteInitialBoundsRef.current = null;
  };

  // --- DRAW CANVAS ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(containerHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }

    const visibleWidth = width;
    const originX = viewStartTime * zoom;

    // Drawing functions work in timeline pixels (time * zoom); shift so the view start is at x = 0.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. Clear & Background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, containerHeight);
    ctx.translate(-originX, 0);

    // 2. Spectrogram (cached per view)
    if (showSpectrogram && spectrogramData) {
        const key = [viewStartTime, zoom, visibleWidth, containerHeight, duration, showPitch].join('|');
        let cache = spectrogramCacheRef.current;
        if (!cache || cache.key !== key || cache.pitchData !== pitchData) {
            const off = cache?.canvas ?? document.createElement('canvas');
            off.width = Math.ceil(visibleWidth);
            off.height = containerHeight;
            const offCtx = off.getContext('2d');
            if (offCtx) {
                offCtx.clearRect(0, 0, off.width, off.height);
                drawSpectrogram(offCtx, spectrogramData, pitchData, viewStartTime, zoom, visibleWidth, containerHeight, duration, showPitch);
            }
            cache = { canvas: off, key, pitchData };
            spectrogramCacheRef.current = cache;
        }
        ctx.drawImage(cache.canvas, originX, 0);
    }
    
    // 3. Selection (Background highlight)
    if (selectionRange) {
        drawSelection(ctx, selectionRange, viewStartTime, zoom, visibleWidth, containerHeight);
    }

    // 4. Grid
    drawGrid(ctx, viewStartTime, zoom, visibleWidth, containerHeight);

    // 5. Notes
    if (showNotes) {
        // If we are dragging a note, we temporarily swap the original note with the dragged state for rendering
        // Resizes preview exactly what will be committed, including a neighbour that moves with a shared boundary
        const displayNotes = !draggedNoteState
            ? notes
            : (interactionMode === 'RESIZE_NOTE_START' || interactionMode === 'RESIZE_NOTE_END')
                ? applyNoteResize(notes, draggedNoteState.id, draggedNoteState.start, draggedNoteState.end, duration, draggedNoteState.detach)
                : notes.map(n => n.id === draggedNoteState.id ? { ...n, pitch: draggedNoteState.pitch || n.pitch } : n);

        // Pass selected ID for highlighting
        drawNotes(ctx, displayNotes, viewStartTime, zoom, visibleWidth, containerHeight, selectedNoteId);
    }

    // 6. Candidates
    if (showCandidates && selectionRange && showPitch) {
        drawCandidates(ctx, pitchData, viewStartTime, zoom, visibleWidth, containerHeight, selectionRange);
    }

    // 7. Main Pitch
    if (showPitch) {
        drawPitchCurve(ctx, pitchData, viewStartTime, zoom, visibleWidth, containerHeight);
    }
    
  }, [pitchData, notes, spectrogramData, showSpectrogram, width, zoom, containerHeight, selectionRange, showCandidates, viewStartTime, showPitch, showNotes, duration, draggedNoteState, selectedNoteId, interactionMode]);

  const playheadX = (currentTime - viewStartTime) * zoom;

  return (
    <div className="flex-1 relative overflow-hidden bg-white min-h-0">
        <div 
            ref={containerRef} 
            className="absolute inset-0 overflow-hidden bg-white select-none"
            data-testid="pitch-view"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDoubleClick={handleDoubleClick}
            onMouseLeave={() => { setInteractionMode('NONE'); setDraggedNoteState(null); draggedNoteRef.current = null; setHoveredNoteInfo(null); }}
        >
        <canvas 
            ref={canvasRef}
            className="block"
            style={{ width: width, height: containerHeight }}
        />
        
        {playheadX >= 0 && playheadX <= width && (
            <div 
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none opacity-80"
                style={{ left: `${playheadX}px` }}
            />
        )}
        </div>

        {/* Hover Info Overlay - Now positioned relative to the Viewport Wrapper */}
        {hoveredNoteInfo && (
            <div className="absolute top-4 right-4 z-20 bg-black/70 text-white text-xs px-2 py-1 rounded shadow pointer-events-none font-mono">
                <span className="mr-3">Onset: {hoveredNoteInfo.onset.toFixed(3)}s</span>
                <span>{hoveredNoteInfo.pitch.toFixed(1)}Hz ({hzToNoteName(hoveredNoteInfo.pitch)})</span>
            </div>
        )}
    </div>
  );
};

export default React.memo(PitchVisualizer);
