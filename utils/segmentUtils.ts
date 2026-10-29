import { Segment, SegmentLayer } from '../types';

// Shortest segment that can be created or left after a resize (seconds)
export const MIN_SEGMENT_DURATION = 0.01;
// Boundaries closer than this are treated as shared (touching)
const EPSILON = 1e-6;

export const LAYER_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444'];

// Distinct, stable colours for labels (e.g. speakers)
const LABEL_PALETTE = ['#60a5fa', '#f87171', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#22d3ee', '#fb923c', '#a3e635', '#94a3b8'];

export const labelColor = (label: string) => {
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
    return LABEL_PALETTE[Math.abs(hash) % LABEL_PALETTE.length];
};

export const createLayer = (existing: SegmentLayer[], name?: string): SegmentLayer => ({
    id: crypto.randomUUID(),
    name: name ?? (existing.length === 0 ? 'Lyrics' : `Layer ${existing.length + 1}`),
    color: LAYER_COLORS[existing.length % LAYER_COLORS.length],
    colorByLabel: false,
    segments: [],
});

const sortSegments = (segments: Segment[]) => [...segments].sort((a, b) => a.start - b.start);

export const findSegmentAt = (layer: SegmentLayer, time: number) =>
    layer.segments.find(s => time >= s.start && time < s.end) ?? null;

// The free gap around a time: [end of previous segment, start of next segment]
export const getGapAt = (layer: SegmentLayer, time: number, duration: number): [number, number] | null => {
    if (findSegmentAt(layer, time)) return null;
    let gapStart = 0;
    let gapEnd = duration;
    for (const s of layer.segments) {
        if (s.end <= time + EPSILON) gapStart = Math.max(gapStart, s.end);
        if (s.start >= time - EPSILON) gapEnd = Math.min(gapEnd, s.start);
    }
    return [gapStart, gapEnd];
};

/**
 * Add a segment for [start, end], trimmed to the free gap that contains its start
 * (or its midpoint), so segments in a layer never overlap.
 * Returns null if there is no room.
 */
export const addSegment = (
    layer: SegmentLayer,
    start: number,
    end: number,
    duration: number,
    label = ''
): { layer: SegmentLayer, segment: Segment } | null => {
    let [a, b] = start <= end ? [start, end] : [end, start];
    a = Math.max(0, a);
    b = Math.min(duration, b);
    const anchor = findSegmentAt(layer, a) ? (a + b) / 2 : a;
    const gap = getGapAt(layer, anchor, duration);
    if (!gap) return null;
    a = Math.max(a, gap[0]);
    b = Math.min(b, gap[1]);
    if (b - a < MIN_SEGMENT_DURATION) return null;
    const segment: Segment = { id: crypto.randomUUID(), start: a, end: b, label };
    return { layer: { ...layer, segments: sortSegments([...layer.segments, segment]) }, segment };
};

export const updateSegmentLabel = (layer: SegmentLayer, segmentId: string, label: string): SegmentLayer => ({
    ...layer,
    segments: layer.segments.map(s => s.id === segmentId ? { ...s, label } : s),
});

export const deleteSegment = (layer: SegmentLayer, segmentId: string): SegmentLayer => ({
    ...layer,
    segments: layer.segments.filter(s => s.id !== segmentId),
});

// Split a segment at a time; the label stays on the left part.
export const splitSegment = (layer: SegmentLayer, segmentId: string, time: number): SegmentLayer | null => {
    const seg = layer.segments.find(s => s.id === segmentId);
    if (!seg) return null;
    if (time - seg.start < MIN_SEGMENT_DURATION || seg.end - time < MIN_SEGMENT_DURATION) return null;
    const left = { ...seg, end: time };
    const right: Segment = { id: crypto.randomUUID(), start: time, end: seg.end, label: '' };
    return { ...layer, segments: sortSegments([...layer.segments.filter(s => s.id !== segmentId), left, right]) };
};

/**
 * Move one boundary of a segment. A boundary shared with a touching neighbour moves
 * both segments together (like a Praat tier boundary); otherwise it stops at the neighbour.
 */
export const moveSegmentBoundary = (
    layer: SegmentLayer,
    segmentId: string,
    edge: 'start' | 'end',
    time: number,
    duration: number
): SegmentLayer => {
    const segments = sortSegments(layer.segments);
    const i = segments.findIndex(s => s.id === segmentId);
    if (i < 0) return layer;
    const seg = segments[i];
    const next = [...segments];

    if (edge === 'start') {
        const prev = segments[i - 1];
        const shared = prev && Math.abs(prev.end - seg.start) < EPSILON;
        const lower = prev ? (shared ? prev.start + MIN_SEGMENT_DURATION : prev.end) : 0;
        const t = Math.max(lower, Math.min(seg.end - MIN_SEGMENT_DURATION, time));
        next[i] = { ...seg, start: t };
        if (shared) next[i - 1] = { ...prev, end: t };
    } else {
        const after = segments[i + 1];
        const shared = after && Math.abs(after.start - seg.end) < EPSILON;
        const upper = after ? (shared ? after.end - MIN_SEGMENT_DURATION : after.start) : duration;
        const t = Math.min(upper, Math.max(seg.start + MIN_SEGMENT_DURATION, time));
        next[i] = { ...seg, end: t };
        if (shared) next[i + 1] = { ...after, start: t };
    }
    return { ...layer, segments: next };
};

// Snap a time to nearby boundaries (notes, other segments, playhead) within a pixel threshold.
export const snapToBoundaries = (time: number, boundaries: number[], zoom: number, thresholdPx = 8) => {
    const threshold = thresholdPx / zoom;
    let best = time;
    let bestDiff = threshold;
    for (const b of boundaries) {
        const d = Math.abs(b - time);
        if (d < bestDiff) { bestDiff = d; best = b; }
    }
    return best;
};

// Labels already used in a layer, most frequent first (for autocomplete)
export const getLayerLabels = (layer: SegmentLayer) => {
    const counts = new Map<string, number>();
    layer.segments.forEach(s => { if (s.label) counts.set(s.label, (counts.get(s.label) ?? 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
};
