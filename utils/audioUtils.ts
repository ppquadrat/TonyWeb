
export const sliceAudioBuffer = (
    audioBuffer: AudioBuffer,
    start: number,
    end: number,
    paddingSamples: number
): { slice: Float32Array; offset: number } | null => {
    const sr = audioBuffer.sampleRate;
    const startSample = Math.floor(start * sr);
    const endSample = Math.floor(end * sr);
    
    const padStart = Math.max(0, startSample - paddingSamples);
    const padEnd = Math.min(audioBuffer.length, endSample + paddingSamples);
    
    // Safety check for empty range
    if (padEnd <= padStart) return null;

    const channelData = audioBuffer.getChannelData(0);
    // Create a copy to avoid SharedArrayBuffer issues with Workers
    const slice = new Float32Array(channelData.subarray(padStart, padEnd));
    
    // Calculate time offset so we can map results back to original timeline
    const offset = padStart / sr;

    return { slice, offset };
};
