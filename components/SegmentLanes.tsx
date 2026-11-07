import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Palette } from 'lucide-react';
import { SegmentLayer, Segment } from '../types';
import { useTimelineWheel } from '../hooks/useTimelineWheel';
import { addSegment, moveSegmentBoundary, snapToBoundaries, labelColor, getLayerLabels } from '../utils/segmentUtils';

export interface SegmentRef {
  layerId: string;
  segmentId: string;
}

interface SegmentLanesProps {
  layers: SegmentLayer[];
  duration: number;
  zoom: number;
  viewStartTime: number;
  currentTime: number;
  snapTimes: number[]; // note boundaries, selection edges etc.
  activeLayerId: string | null;
  selectedSegment: SegmentRef | null;
  editingSegment: SegmentRef | null;
  onLayersChange: (layers: SegmentLayer[]) => void;
  onAddLayer: () => string; // returns the new layer's id
  onSetActiveLayer: (layerId: string) => void;
  onSelectSegment: (ref: SegmentRef | null) => void;
  onEditSegment: (ref: SegmentRef | null) => void;
  onSeek: (time: number) => void;
  onPreviewSelection: (range: [number, number]) => void; // show a drag in progress as the time selection
  onViewScroll: (startTime: number) => void;
  onZoomWheel: (deltaPixels: number, mouseTime: number) => void;
}

const LANE_HEIGHT = 40;
const EDGE_PX = 6;

// Which edge of a segment a time grabs. Only the inside of the segment counts, so
// dragging in the empty space right next to a segment still creates a new one.
const hitEdge = (seg: Segment, time: number, zoom: number): 'start' | 'end' | null => {
  const edge = Math.min(EDGE_PX / zoom, (seg.end - seg.start) / 4);
  if (time >= seg.start && time - seg.start < edge) return 'start';
  if (time <= seg.end && seg.end - time < edge) return 'end';
  return null;
};

type DragState =
  | { mode: 'create', layerId: string, anchor: number, current: number, startX: number }
  | { mode: 'resize', layerId: string, segmentId: string, edge: 'start' | 'end', draft: SegmentLayer };

const SegmentLanes: React.FC<SegmentLanesProps> = ({
  layers, duration, zoom, viewStartTime, currentTime, snapTimes,
  activeLayerId, selectedSegment, editingSegment,
  onLayersChange, onAddLayer, onSetActiveLayer, onSelectSegment, onEditSegment,
  onSeek, onPreviewSelection, onViewScroll, onZoomWheel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [width, setWidth] = useState(window.innerWidth);

  useTimelineWheel(containerRef, { zoom, viewStartTime, onZoomWheel, onViewScroll });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const viewEnd = viewStartTime + width / zoom;
  const timeAt = (clientX: number, el: HTMLElement) =>
    Math.max(0, Math.min(duration, viewStartTime + (clientX - el.getBoundingClientRect().left) / zoom));

  const boundaryTimes = (excludeSegmentId?: string) => {
    const times = [...snapTimes, currentTime];
    layers.forEach(l => l.segments.forEach(s => {
      if (s.id !== excludeSegmentId) times.push(s.start, s.end);
    }));
    return times;
  };

  const snap = (time: number, shiftKey: boolean, excludeSegmentId?: string) =>
    shiftKey ? time : snapToBoundaries(time, boundaryTimes(excludeSegmentId), zoom);

  const replaceLayer = (layer: SegmentLayer) => onLayersChange(layers.map(l => l.id === layer.id ? layer : l));

  // --- Pointer interaction on a lane ---
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, layer: SegmentLayer) => {
    if (e.button !== 0) return;
    const lane = e.currentTarget;
    const time = timeAt(e.clientX, lane);
    onSetActiveLayer(layer.id);

    // Edge of a segment: resize
    for (const seg of layer.segments) {
      const edge = hitEdge(seg, time, zoom);
      if (edge) {
        e.preventDefault();
        lane.setPointerCapture(e.pointerId);
        setDrag({ mode: 'resize', layerId: layer.id, segmentId: seg.id, edge, draft: layer });
        return;
      }
    }

    // Body of a segment: select it (double-click edits the label)
    const hit = layer.segments.find(s => time >= s.start && time < s.end);
    if (hit) {
      onSelectSegment({ layerId: layer.id, segmentId: hit.id });
      return;
    }

    // Empty space: drag to create a segment
    e.preventDefault();
    lane.setPointerCapture(e.pointerId);
    const anchor = snap(time, e.shiftKey);
    setDrag({ mode: 'create', layerId: layer.id, anchor, current: anchor, startX: e.clientX });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>, layer: SegmentLayer) => {
    const lane = e.currentTarget;
    if (!drag) {
      // Hover cursor
      const time = timeAt(e.clientX, lane);
      const onEdge = layer.segments.some(seg => hitEdge(seg, time, zoom) !== null);
      lane.style.cursor = onEdge ? 'ew-resize' : 'crosshair';
      return;
    }
    if (drag.layerId !== layer.id) return;
    if (drag.mode === 'create') {
      const current = snap(timeAt(e.clientX, lane), e.shiftKey);
      setDrag({ ...drag, current });
      if (Math.abs(e.clientX - drag.startX) >= 3) {
        onPreviewSelection([Math.min(drag.anchor, current), Math.max(drag.anchor, current)]);
      }
    } else {
      const time = snap(timeAt(e.clientX, lane), e.shiftKey, drag.segmentId);
      const draft = moveSegmentBoundary(layer, drag.segmentId, drag.edge, time, duration, e.altKey);
      setDrag({ ...drag, draft });
      const seg = draft.segments.find(s => s.id === drag.segmentId);
      if (seg) onPreviewSelection([seg.start, seg.end]);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>, layer: SegmentLayer) => {
    if (!drag || drag.layerId !== layer.id) return;
    const lane = e.currentTarget;
    if (lane.hasPointerCapture(e.pointerId)) lane.releasePointerCapture(e.pointerId);
    setDrag(null);

    if (drag.mode === 'resize') {
      replaceLayer(drag.draft);
      return;
    }
    if (Math.abs(e.clientX - drag.startX) < 3) {
      // A click in empty space: move the playhead
      onSelectSegment(null);
      onSeek(timeAt(e.clientX, lane));
      return;
    }
    const result = addSegment(layer, drag.anchor, drag.current, duration);
    if (result) {
      replaceLayer(result.layer);
      const ref = { layerId: layer.id, segmentId: result.segment.id };
      onSelectSegment(ref);
      onEditSegment(ref);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>, layer: SegmentLayer) => {
    const time = timeAt(e.clientX, e.currentTarget);
    const hit = layer.segments.find(s => time >= s.start && time < s.end);
    if (hit) {
      const ref = { layerId: layer.id, segmentId: hit.id };
      onSelectSegment(ref);
      onEditSegment(ref);
    }
  };

  // --- Rendering ---
  const renderSegment = (layer: SegmentLayer, seg: Segment) => {
    if (seg.end < viewStartTime || seg.start > viewEnd) return null;
    const left = (seg.start - viewStartTime) * zoom;
    const w = Math.max(1, (seg.end - seg.start) * zoom);
    const isSelected = selectedSegment?.segmentId === seg.id;
    const isEditing = editingSegment?.segmentId === seg.id;
    const color = layer.colorByLabel && seg.label ? labelColor(seg.label) : layer.color;

    return (
      <div
        key={seg.id}
        data-testid="segment"
        className="absolute top-1 bottom-1 rounded-sm overflow-visible"
        style={{
          left, width: w,
          background: `${color}55`,
          border: `${isSelected ? 2 : 1}px solid ${isSelected ? '#1f2937' : color}`,
          zIndex: isEditing ? 30 : isSelected ? 2 : 1,
        }}
      >
        {isEditing ? (
          <LabelEditor
            initial={seg.label}
            suggestions={getLayerLabels(layer)}
            minWidth={Math.max(w, 90)}
            onCommit={(label, move) => {
              replaceLayer({ ...layer, segments: layer.segments.map(s => s.id === seg.id ? { ...s, label } : s) });
              if (move) {
                const sorted = [...layer.segments].sort((a, b) => a.start - b.start);
                const i = sorted.findIndex(s => s.id === seg.id);
                const target = sorted[i + move];
                if (target) {
                  const ref = { layerId: layer.id, segmentId: target.id };
                  onSelectSegment(ref);
                  onEditSegment(ref);
                  return;
                }
              }
              onEditSegment(null);
            }}
            onCancel={() => onEditSegment(null)}
          />
        ) : (
          <span className="block px-1 text-xs leading-[30px] text-gray-900 truncate select-none pointer-events-none" data-testid="segment-label">
            {seg.label}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex-none border-t border-gray-300 bg-gray-50" data-testid="segment-lanes">
      <div ref={containerRef} className="relative max-h-48 overflow-y-auto overflow-x-hidden">
        {layers.map(layer => {
          const shown = drag?.mode === 'resize' && drag.layerId === layer.id ? drag.draft : layer;
          const isActive = layer.id === activeLayerId;
          return (
            <div
              key={layer.id}
              data-testid="segment-lane"
              data-layer-name={layer.name}
              className={`relative border-b border-gray-200 ${isActive ? 'bg-blue-50/60' : 'bg-white'}`}
              style={{ height: LANE_HEIGHT, touchAction: 'none' }}
              onPointerDown={(e) => handlePointerDown(e, layer)}
              onPointerMove={(e) => handlePointerMove(e, layer)}
              onPointerUp={(e) => handlePointerUp(e, layer)}
              onDoubleClick={(e) => handleDoubleClick(e, layer)}
            >
              {shown.segments.map(seg => renderSegment(shown, seg))}

              {drag?.mode === 'create' && drag.layerId === layer.id && (
                <div
                  className="absolute top-1 bottom-1 border border-dashed border-gray-500 bg-gray-300/30 pointer-events-none"
                  style={{
                    left: (Math.min(drag.anchor, drag.current) - viewStartTime) * zoom,
                    width: Math.abs(drag.current - drag.anchor) * zoom,
                  }}
                />
              )}

              {/* Playhead */}
              {currentTime >= viewStartTime && currentTime <= viewEnd && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-80 pointer-events-none z-10" style={{ left: (currentTime - viewStartTime) * zoom }} />
              )}

              {/* Layer header */}
              <div
                className="absolute top-0 left-0 z-20 flex items-center gap-1 bg-white/90 border-r border-b border-gray-200 rounded-br px-1 h-4 text-[10px] text-gray-600"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: layer.color }} />
                {renamingLayerId === layer.id ? (
                  <input
                    autoFocus
                    defaultValue={layer.name}
                    placeholder="Layer name"
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-28 border border-blue-500 rounded px-0.5 text-[10px]"
                    onBlur={(e) => { replaceLayer({ ...layer, name: e.target.value.trim() || layer.name }); setRenamingLayerId(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenamingLayerId(null); }}
                  />
                ) : (
                  <span className="font-semibold cursor-text hover:underline" title="Click to rename" onClick={() => setRenamingLayerId(layer.id)}>{layer.name}</span>
                )}
                <button
                  className={`p-0.5 rounded hover:bg-gray-200 ${layer.colorByLabel ? 'text-blue-600' : 'text-gray-400'}`}
                  title="Colour segments by label (e.g. one colour per speaker)"
                  onClick={() => replaceLayer({ ...layer, colorByLabel: !layer.colorByLabel })}
                >
                  <Palette size={10} />
                </button>
                <button
                  className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-red-600"
                  title="Delete layer"
                  onClick={() => {
                    if (layer.segments.length === 0 || window.confirm(`Delete layer "${layer.name}" and its ${layer.segments.length} segments?`)) {
                      onLayersChange(layers.filter(l => l.id !== layer.id));
                    }
                  }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 px-2 h-7 text-xs text-gray-500">
        <button
          onClick={() => setRenamingLayerId(onAddLayer())}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-200 text-gray-700"
          title="Add a segment layer (lyrics, speakers, ...)"
        >
          <Plus size={12} /> Segment layer
        </button>
        {layers.length > 0 && (
          <span className="truncate">Drag in a layer to add a segment · double-click to label · Tab moves to the next segment · Enter turns a selection into a segment</span>
        )}
      </div>
    </div>
  );
};

interface LabelEditorProps {
  initial: string;
  suggestions: string[];
  minWidth: number;
  onCommit: (label: string, move: 0 | 1 | -1) => void;
  onCancel: () => void;
}

// Inline label input. Enter commits, Tab / Shift+Tab commit and move to the next / previous segment.
const LabelEditor: React.FC<LabelEditorProps> = ({ initial, suggestions, minWidth, onCommit, onCancel }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const listId = useRef(`labels-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (move: 0 | 1 | -1) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(inputRef.current?.value ?? initial, move);
  };

  return (
    <>
      <input
        ref={inputRef}
        data-testid="segment-label-input"
        defaultValue={initial}
        list={listId}
        className="absolute left-0 top-0 h-full px-1 text-xs border-2 border-blue-500 rounded-sm bg-white shadow"
        style={{ width: minWidth }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(0); }
          else if (e.key === 'Tab') { e.preventDefault(); finish(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); doneRef.current = true; onCancel(); }
        }}
        onBlur={() => finish(0)}
      />
      <datalist id={listId}>
        {suggestions.map(s => <option key={s} value={s} />)}
      </datalist>
    </>
  );
};

export default React.memo(SegmentLanes);
