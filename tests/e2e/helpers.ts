import { Page, TestInfo, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { freqToY } from '../../utils/renderUtils';

// Mono 16-bit WAV of stepped sine tones: [frequency Hz, seconds][]
export const writeToneWav = (testInfo: TestInfo, steps: [number, number][], sampleRate = 44100) => {
  const total = Math.round(steps.reduce((sum, [, d]) => sum + d, 0) * sampleRate);
  const data = Buffer.alloc(total * 2);
  let phase = 0;
  let i = 0;
  for (const [freq, dur] of steps) {
    const n = Math.round(dur * sampleRate);
    for (let k = 0; k < n && i < total; k++, i++) {
      phase += (2 * Math.PI * freq) / sampleRate;
      const v = 0.4 * Math.sin(phase) + 0.1 * Math.sin(2 * phase);
      data.writeInt16LE(Math.round(v * 32767), i * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  const path = testInfo.outputPath('tones.wav');
  writeFileSync(path, Buffer.concat([header, data]));
  return path;
};

export const loadAudio = async (page: Page, path: string) => {
  await page.goto('./');
  await page.setInputFiles('input[accept="audio/*"]', path);
  // The toolbar button reads "Analyzing..." until pitch extraction has finished
  await expect(page.getByText('Analyzing...')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Extract Pitch' })).toBeVisible({ timeout: 90_000 });
};

export const viewGeometry = async (page: Page) => {
  const box = await page.getByTestId('pitch-view').boundingBox();
  if (!box) throw new Error('pitch view not found');
  return box;
};

// Screen coordinates helper for a given zoom and view start
export const makeCoords = (box: { x: number, y: number, height: number }, zoom: number, viewStart = 0) => ({
  x: (t: number) => box.x + (t - viewStart) * zoom,
  y: (hz: number) => box.y + freqToY(hz, box.height),
});
