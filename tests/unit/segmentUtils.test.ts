import { describe, it, expect } from 'vitest';
import { addSegment, createLayer, moveSegmentBoundary, splitSegment, getGapAt, snapToBoundaries, getLayerLabels } from '../../utils/segmentUtils';
import { SegmentLayer } from '../../types';

const layerWith = (...ranges: [number, number, string?][]): SegmentLayer => ({
  ...createLayer([]),
  segments: ranges.map(([start, end, label], i) => ({ id: `s${i}`, start, end, label: label ?? '' })),
});

describe('segmentUtils', () => {
  it('adds a segment and keeps segments sorted', () => {
    const r = addSegment(layerWith([2, 3]), 0.5, 1, 10, 'la')!;
    expect(r.layer.segments.map(s => s.start)).toEqual([0.5, 2]);
    expect(r.segment.label).toBe('la');
  });

  it('trims new segments so they never overlap', () => {
    const layer = layerWith([1, 2], [4, 5]);
    // Dragged across the second segment: stops at its start
    expect(addSegment(layer, 2.5, 4.5, 10)!.segment).toMatchObject({ start: 2.5, end: 4 });
    // Started inside the first segment: begins at its end
    expect(addSegment(layer, 1.5, 3, 10)!.segment).toMatchObject({ start: 2, end: 3 });
    // Entirely inside an existing segment: no room
    expect(addSegment(layer, 1.2, 1.8, 10)).toBeNull();
  });

  it('accepts reversed drags and clamps to the file', () => {
    expect(addSegment(layerWith(), 3, -1, 2)!.segment).toMatchObject({ start: 0, end: 2 });
  });

  it('finds the gap around a time', () => {
    expect(getGapAt(layerWith([1, 2], [4, 5]), 3, 10)).toEqual([2, 4]);
    expect(getGapAt(layerWith([1, 2]), 1.5, 10)).toBeNull();
  });

  it('moves a shared boundary for both neighbours', () => {
    const moved = moveSegmentBoundary(layerWith([0, 1], [1, 2]), 's1', 'start', 0.8, 10);
    expect(moved.segments).toMatchObject([{ start: 0, end: 0.8 }, { start: 0.8, end: 2 }]);
  });

  it('joins the neighbour when a free boundary reaches it, never overlapping', () => {
    const moved = moveSegmentBoundary(layerWith([0, 1], [1.5, 2]), 's1', 'start', 0.5, 10);
    expect(moved.segments[1].start).toBe(0.5);
    expect(moved.segments[0].end).toBe(0.5);
  });

  it('with detach (Alt) stops at the neighbour and leaves it alone', () => {
    const moved = moveSegmentBoundary(layerWith([0, 1], [1.5, 2]), 's1', 'start', 0.5, 10, true);
    expect(moved.segments[1].start).toBe(1);
    expect(moved.segments[0].end).toBe(1);
    const apart = moveSegmentBoundary(layerWith([0, 1], [1, 2]), 's1', 'start', 1.3, 10, true);
    expect(apart.segments[0].end).toBe(1);
    expect(apart.segments[1].start).toBe(1.3);
  });

  it('never inverts a segment while resizing', () => {
    const moved = moveSegmentBoundary(layerWith([1, 2]), 's0', 'end', 0.5, 10);
    expect(moved.segments[0].end).toBeGreaterThan(moved.segments[0].start);
  });

  it('splits a segment, keeping the label on the left', () => {
    const split = splitSegment(layerWith([0, 2, 'hello']), 's0', 1)!;
    expect(split.segments).toMatchObject([{ start: 0, end: 1, label: 'hello' }, { start: 1, end: 2, label: '' }]);
  });

  it('snaps to nearby boundaries only', () => {
    expect(snapToBoundaries(1.03, [1, 2], 100)).toBe(1); // 3px away
    expect(snapToBoundaries(1.2, [1, 2], 100)).toBe(1.2); // 20px away
  });

  it('lists labels by frequency for autocomplete', () => {
    expect(getLayerLabels(layerWith([0, 1, 'B'], [1, 2, 'A'], [2, 3, 'A'], [3, 4, '']))).toEqual(['A', 'B']);
  });
});
