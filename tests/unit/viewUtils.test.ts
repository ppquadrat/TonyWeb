import { describe, it, expect } from 'vitest';
import { clampViewStart, clampZoom, getMinZoom, wheelZoomFactor, wheelDeltaToPixels, followPlayhead, revealCursor, loopRange } from '../../utils/viewUtils';

describe('viewUtils', () => {
  it('keeps the view start inside the audio', () => {
    // 1000px at 100px/s shows 10s of a 60s file
    expect(clampViewStart(-5, 100, 1000, 60)).toBe(0);
    expect(clampViewStart(55, 100, 1000, 60)).toBe(50);
    expect(clampViewStart(20, 100, 1000, 60)).toBe(20);
  });

  it('pins the view to 0 when the whole file fits', () => {
    expect(clampViewStart(3, 100, 1000, 5)).toBe(0);
  });

  it('never zooms out past fitting the whole file', () => {
    expect(getMinZoom(1000, 50)).toBe(20);
    expect(clampZoom(5, 1000, 50)).toBe(20);
    expect(clampZoom(1e6, 1000, 50)).toBeLessThanOrEqual(2000);
  });

  it('zooms proportionally to the wheel delta', () => {
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(-0.2));
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    // Many tiny trackpad events add up to roughly one notch, not ten
    let factor = 1;
    for (let i = 0; i < 10; i++) factor *= wheelZoomFactor(10);
    expect(factor).toBeCloseTo(wheelZoomFactor(100));
  });

  it('normalises line-based wheel deltas (Firefox)', () => {
    expect(wheelDeltaToPixels(3, 1, 800)).toBe(48);
    expect(wheelDeltaToPixels(1, 2, 800)).toBe(800);
    expect(wheelDeltaToPixels(42, 0, 800)).toBe(42);
  });

  it('only moves the view when the playhead leaves it', () => {
    expect(followPlayhead(5, 0, 100, 1000)).toBe(0);
    expect(followPlayhead(9.5, 0, 100, 1000)).toBeCloseTo(8.5);
    expect(followPlayhead(2, 4, 100, 1000)).toBeCloseTo(1);
  });

  it('scrolls to a hand-moved cursor only near the right edge or off screen', () => {
    // 10s visible from 0
    expect(revealCursor(5, 0, 100, 1000)).toBe(0);
    expect(revealCursor(8, 0, 100, 1000)).toBe(0);
    expect(revealCursor(9, 0, 100, 1000)).toBeCloseTo(6);
    expect(revealCursor(14, 0, 100, 1000)).toBeCloseTo(11);
    // Near or past the left edge: two thirds of the way in, so there is room to keep going left
    expect(revealCursor(20.5, 20, 100, 1000)).toBeCloseTo(13.5);
    expect(revealCursor(15, 20, 100, 1000)).toBeCloseTo(8);
    expect(revealCursor(21.5, 20, 100, 1000)).toBe(20);
    // At the very start there is nothing to the left
    expect(revealCursor(0.5, 0, 100, 1000)).toBe(0);
  });

  it('does not loop a selection too short to hear', () => {
    expect(loopRange({ isLooping: true, selectionRange: [10, 10.004] })).toBeNull();
    expect(loopRange({ isLooping: false, selectionRange: [10, 12] })).toBeNull();
    expect(loopRange({ isLooping: true, selectionRange: [10, 12] })).toEqual([10, 12]);
  });
});
