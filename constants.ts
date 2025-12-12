
export const COLORS = {
  background: '#ffffff',
  gridLine: '#e5e7eb',
  gridText: '#6b7280',
  rulerBackground: '#f9fafb',
  rulerLine: '#d1d5db',
  rulerText: '#4b5563',
  playhead: '#ef4444',
  playheadOpacity: 0.8,
  
  selectionBackground: 'rgba(219, 234, 254, 0.5)', // blue-100/50
  selectionBorder: '#3b82f6', // blue-500
  
  noteDefaultFill: '#93c5fd', // blue-300
  noteDefaultBorder: '#3b82f6', // blue-500
  noteSelectedFill: '#60a5fa', // blue-400
  noteSelectedBorder: '#1e40af', // blue-800
  
  pitchCurve: '#000000',
  candidate: '#eab308', // yellow-500
  spectrogramBase: 255, // White
};

export const DIMENSIONS = {
  rulerHeight: 20,
  noteHeight: 14,
  noteInteractionHeight: 20, // Hit area vertical
  handleThresholdPx: 8,      // Hit area horizontal (pixels)
  snapThresholdPx: 10,
  candidateRadius: 2.5,
  pitchPointRadius: 1.2,
};

export const ANALYSIS = {
  minPitch: 50,
  maxPitch: 5000,
  spectrogramDbRange: 50, // -50dB floor
};
