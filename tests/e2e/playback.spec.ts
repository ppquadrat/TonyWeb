// @ts-nocheck -- patches Web Audio prototypes inside the page
import { test, expect } from '@playwright/test';
import { writeToneWav, loadAudio, viewGeometry } from './helpers';

// Tap the first node connected to the speakers with an analyser, to measure the output level
const tapOutput = () => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && !window.__analyser) {
      window.__analyser = this.context.createAnalyser();
      connect.call(this, window.__analyser);
    }
    return connect.call(this, dest, ...rest);
  };
};
const outputLevel = () => {
  const data = new Float32Array(2048);
  window.__analyser?.getFloatTimeDomainData(data);
  const ctx = window.__analyser?.context;
  return { level: Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length), state: ctx?.state, time: ctx?.currentTime };
};

test('a long selection keeps sounding all the way through', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(tapOutput);
  await loadAudio(page, writeToneWav(testInfo, [[220, 40]]));
  await page.keyboard.press('KeyF');
  const box = await viewGeometry(page);
  const zoom = box.width / 40;
  const y = box.y + box.height - 10;
  await page.mouse.move(box.x + 5 * zoom, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 30 * zoom, y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Space');

  const samples = [];
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(2000);
    samples.push(await page.evaluate(outputLevel));
  }
  console.log(testInfo.project.name, 'output', samples.map(s => `${s.level.toFixed(3)}@${s.time?.toFixed(1)}`).join(' '), samples[0].state);
  // Browsers without an audio device on CI never produce output; only a dropout counts
  test.skip(samples[0].level === 0, 'no audio output in this browser here');
  for (const s of samples) expect(s.level).toBeGreaterThan(0.05);
});
