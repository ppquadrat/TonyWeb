import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { writeToneWav } from './helpers';

const writeProject = (path: string) => writeFileSync(path, JSON.stringify({
  version: '1.3', fileName: 'tones.wav', pitchData: [], notes: [],
  segmentLayers: [{ id: 'l1', name: 'Lyrics', color: '#f59e0b', colorByLabel: false, segments: [{ id: 's1', start: 0.2, end: 0.6, label: 'la' }] }],
}));

test('a project opens without asking for audio picked together with it', async ({ page }, testInfo) => {
  const wav = writeToneWav(testInfo, [[220, 1]]);
  const project = testInfo.outputPath('song.tonyweb');
  writeProject(project);
  await page.goto('./');
  await page.setInputFiles('input[accept=".json,.tonyweb,audio/*"]', [project, wav]);
  await expect(page.getByText('la', { exact: true })).toBeVisible();
  await expect(page.getByText('Locate Audio File')).toHaveCount(0);
});

test('locating the audio for a project shows that it is loading', async ({ page }, testInfo) => {
  const wav = writeToneWav(testInfo, [[220, 1]]);
  const project = testInfo.outputPath('song.tonyweb');
  writeProject(project);
  await page.goto('./');
  await page.setInputFiles('input[accept=".json,.tonyweb,audio/*"]', project);
  await expect(page.getByText('Locate Audio File')).toBeVisible();
  // Hold decoding so the loading state can be seen
  await page.evaluate(() => {
    const orig = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (this: AudioContext, buf: ArrayBuffer) {
      return new Promise(r => setTimeout(r, 1000)).then(() => orig.call(this, buf));
    } as any;
  });
  await page.locator('input[type=file][accept="audio/*"]').last().setInputFiles(wav);
  await expect(page.getByTestId('locate-loading')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Locate File...' })).toBeDisabled();
  await expect(page.getByText('Locate Audio File')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('la', { exact: true })).toBeVisible();
});
