import { RefObject, useEffect, useRef } from 'react';
import { wheelDeltaToPixels } from '../utils/viewUtils';

interface TimelineWheelOptions {
  zoom: number;
  viewStartTime: number;
  onZoomWheel: (deltaPixels: number, mouseTime: number) => void;
  onViewScroll: (startTime: number) => void;
}

/**
 * Wheel handling shared by the timeline views. Uses a native non-passive listener so
 * preventDefault works (React's onWheel is passive).
 * Vertical wheel zooms around the mouse; horizontal swipe or Shift+wheel pans.
 */
export const useTimelineWheel = (ref: RefObject<HTMLElement | null>, options: TimelineWheelOptions) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom, viewStartTime, onZoomWheel, onViewScroll } = optionsRef.current;
      const rect = el.getBoundingClientRect();
      const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode, rect.width);
      const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode, rect.height);
      const panPixels = e.shiftKey ? (dx || dy) : dx;
      if (Math.abs(panPixels) > Math.abs(e.shiftKey ? 0 : dy)) {
        onViewScroll(viewStartTime + panPixels / zoom);
      } else if (dy !== 0) {
        const mouseTime = viewStartTime + (e.clientX - rect.left) / zoom;
        onZoomWheel(dy, mouseTime);
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [ref]);
};
