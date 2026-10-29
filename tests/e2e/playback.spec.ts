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
  return Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
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

  const levels: number[] = [];
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(2000);
    levels.push(await page.evaluate(outputLevel));
  }
  console.log('output levels', levels.map(l => l.toFixed(3)).join(' '));
  for (const level of levels) expect(level).toBeGreaterThan(0.05);
});
