
import React, { useEffect, useRef, useState, useCallback } from 'react';

interface WaveformNavigatorProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  viewStartTime: number;
  viewDuration: number;
  onViewChange: (startTime: number) => void;
}

const WaveformNavigator: React.FC<WaveformNavigatorProps> = ({ 
  audioBuffer, 
  currentTime, 
  duration,
  onSeek,
  viewStartTime,
  viewDuration,
  onViewChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDraggingView, setIsDraggingView] = useState(false);
  const dragStartX = useRef(0);
  const dragStartTime = useRef(0);

  // Draw static waveform
  useEffect(() => {
    if (!audioBuffer || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    canvas.width = width;
    canvas.height = height;

    if (!ctx) return;

    // Clear with White
    ctx.fillStyle = '#ffffff'; 
    ctx.fillRect(0, 0, width, height);

    // Draw waveform (downsampled)
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.beginPath();
    ctx.strokeStyle = '#4b5563'; // Tailwind gray-600
    ctx.lineWidth = 1;

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.moveTo(i, amp + min * amp);
      ctx.lineTo(i, amp + max * amp);
    }
    ctx.stroke();

    // Draw top border (Since it's at the bottom of the screen now)
    ctx.beginPath();
    ctx.strokeStyle = '#d1d5db';
    ctx.moveTo(0, 0);
    ctx.lineTo(width, 0);
    ctx.stroke();

  }, [audioBuffer]);

  // Handle Drag of Viewport Rectangle
  const handleRectMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering seek on parent
    setIsDraggingView(true);
    dragStartX.current = e.clientX;
    dragStartTime.current = viewStartTime;
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingView || !containerRef.current || duration === 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const pixelDelta = e.clientX - dragStartX.current;
    const timeDelta = (pixelDelta / rect.width) * duration;
    
    let newTime = dragStartTime.current + timeDelta;
    
    // Clamp
    newTime = Math.max(0, Math.min(newTime, duration - viewDuration));
    
    onViewChange(newTime);
  }, [isDraggingView, duration, viewDuration, onViewChange]);

  const handleGlobalMouseUp = useCallback(() => {
    setIsDraggingView(false);
  }, []);

  useEffect(() => {
    if (isDraggingView) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    } else {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDraggingView, handleGlobalMouseMove, handleGlobalMouseUp]);


  // Handle Seek (Click outside rectangle)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * duration;
    onSeek(time);
  };

  // Calculate Rectangle Position
  const safeDuration = duration || 1;
  const leftPct = Math.max(0, Math.min(100, (viewStartTime / safeDuration) * 100));
  const widthPct = Math.max(0, Math.min(100 - leftPct, (viewDuration / safeDuration) * 100));

  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-16 bg-white border-t border-gray-300 cursor-crosshair overflow-hidden group select-none"
      onMouseDown={handleMouseDown}
    >
      <canvas ref={canvasRef} className="w-full h-full pointer-events-none" />
      
      {/* Viewport Rectangle (The "Minimap" handle) */}
      <div 
        className="absolute top-0 bottom-0 border-2 border-black bg-black/10 hover:bg-black/20 cursor-grab active:cursor-grabbing z-20 transition-colors"
        style={{ 
          left: `${leftPct}%`, 
          width: `${widthPct}%` 
        }}
        onMouseDown={handleRectMouseDown}
        title="Drag to scroll view"
      />

      {/* Playhead Overlay */}
      <div 
        className="absolute top-0 bottom-0 w-0.5 bg-red-600 z-30 pointer-events-none"
        style={{ 
          left: `${(currentTime / safeDuration) * 100}%` 
        }}
      />
    </div>
  );
};

export default React.memo(WaveformNavigator);
