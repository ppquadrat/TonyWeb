// Viewport helpers: keep the visible window on the audio.

export const MAX_ZOOM = 2000; // Pixels per second

// Smallest zoom: the whole file fits the screen (never below 1 px/s).
export const getMinZoom = (viewportWidth: number, duration: number) => {
    if (duration <= 0 || viewportWidth <= 0) return 1;
    return Math.max(1, viewportWidth / duration);
};

export const clampZoom = (zoom: number, viewportWidth: number, duration: number) => {
    const minZoom = getMinZoom(viewportWidth, duration);
    return Math.max(minZoom, Math.min(MAX_ZOOM, zoom));
};

// Keep the view start inside [0, duration - viewDuration].
export const clampViewStart = (start: number, zoom: number, viewportWidth: number, duration: number) => {
    if (duration <= 0 || zoom <= 0) return 0;
    const viewDuration = viewportWidth / zoom;
    const maxStart = Math.max(0, duration - viewDuration);
    return Math.max(0, Math.min(maxStart, start));
};

// Convert a wheel delta to pixels regardless of deltaMode (Firefox often reports lines).
export const wheelDeltaToPixels = (delta: number, deltaMode: number, pageSize: number) => {
    if (deltaMode === 1) return delta * 16;       // DOM_DELTA_LINE
    if (deltaMode === 2) return delta * pageSize; // DOM_DELTA_PAGE
    return delta;
};

// Zoom factor for a wheel delta in pixels: proportional, so a trackpad
// gesture made of many small events zooms as much as one mouse notch.
export const wheelZoomFactor = (deltaPixels: number) => {
    const clamped = Math.max(-100, Math.min(100, deltaPixels));
    return Math.exp(-clamped * 0.002);
};

// When the cursor is moved by hand (click, arrow keys, note selection) and lands near the
// right edge or outside the view, scroll so it sits a third of the way in. Clicks elsewhere
// leave the view alone.
export const REVEAL_RIGHT_EDGE = 0.85;
export const revealCursor = (time: number, viewStart: number, zoom: number, viewportWidth: number) => {
    const viewDuration = viewportWidth / zoom;
    if (time < viewStart || time > viewStart + viewDuration * REVEAL_RIGHT_EDGE) {
        return time - viewDuration * 0.3;
    }
    return viewStart;
};

// Move the view only when the playhead leaves it ("page turn" follow).
export const followPlayhead = (time: number, viewStart: number, zoom: number, viewportWidth: number) => {
    const viewDuration = viewportWidth / zoom;
    if (time < viewStart || time > viewStart + viewDuration * 0.9) {
        return time - viewDuration * 0.1;
    }
    return viewStart;
};

// Selections shorter than this are not looped: they would stutter in place ("t-t-t-t")
export const MIN_LOOP_DURATION = 0.05;
export const loopRange = (state: { isLooping: boolean, selectionRange: [number, number] | null }) => {
    const r = state.isLooping ? state.selectionRange : null;
    return r && r[1] - r[0] >= MIN_LOOP_DURATION ? r : null;
};
