import { test, expect, Page } from '@playwright/test';
import { writeToneWav, loadAudio, viewGeometry, makeCoords } from './helpers';

const createNote = async (page: Page, c: ReturnType<typeof makeCoords>, start: number, end: number) => {
  await page.mouse.move(c.x(start), c.y(1000));
  await page.mouse.down();
  await page.mouse.move(c.x(end), c.y(1000), { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Equal');
};

const dragNotePitch = async (page: Page, c: ReturnType<typeof makeCoords>, t: number, hz: number, dy: number) => {
  await page.mouse.dblclick(c.x(t), c.y(hz));
  const pitchInput = page.locator('input[type="number"]');
  await expect(pitchInput).toBeVisible();
  await page.mouse.move(c.x(t), c.y(hz));
  await page.mouse.down();
  await page.mouse.move(c.x(t), c.y(hz) + dy, { steps: 10 });
  await page.mouse.up();
  return pitchInput;
};

test('dragging a selected note changes its pitch, including short notes', async ({ page }, testInfo) => {
  const duration = 30;
  const wav = writeToneWav(testInfo, [[220, 2], [330, 2], [262, 26]]);
  await loadAudio(page, wav);

  // Fit the whole file so the zoom is known: width / duration
  await page.keyboard.press('KeyF');
  const box = await viewGeometry(page);
  const c = makeCoords(box, box.width / duration);

  // Long note (1s) and short note (0.3s, ~14px at fit zoom)
  await createNote(page, c, 0.3, 1.3);
  await createNote(page, c, 2.4, 2.7);

  const longInput = await dragNotePitch(page, c, 0.8, 220, -60);
  await expect.poll(async () => parseFloat(await longInput.inputValue())).toBeGreaterThan(300);

  const shortInput = await dragNotePitch(page, c, 2.55, 330, -60);
  await expect.poll(async () => parseFloat(await shortInput.inputValue())).toBeGreaterThan(400);
});

test('canvas stays the size of the screen for long files', async ({ page }, testInfo) => {
  const wav = writeToneWav(testInfo, [[220, 60]]);
  await loadAudio(page, wav);
  // Zoom right in: the old single-canvas design would need over 100,000px here
  for (let i = 0; i < 10; i++) await page.getByTitle('Zoom In').click();
  const canvasWidth = await page.locator('[data-testid="pitch-view"] canvas').evaluate(c => (c as HTMLCanvasElement).width);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  expect(canvasWidth).toBeLessThanOrEqual(1400 * dpr);
  await expect(page.locator('[data-testid="pitch-view"] canvas')).toBeVisible();
});

test('the view cannot be scrolled or zoomed away from the audio', async ({ page }, testInfo) => {
  const wav = writeToneWav(testInfo, [[220, 20]]);
  await loadAudio(page, wav);
  const box = await viewGeometry(page);
  const mx = box.x + box.width - 5, my = box.y + box.height / 2;
  await page.mouse.move(mx, my);
  // Zoom far in at the right edge, then pan hard to the right and zoom far out
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -100);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(2000, 0);

  // Panned hard right: the view sits at the end of the audio, not past it
  const track = (await page.getByTestId('minimap').boundingBox())!;
  let view = (await page.getByTestId('minimap-view').boundingBox())!;
  expect(view.width).toBeGreaterThan(3);
  expect(Math.abs(view.x + view.width - (track.x + track.width))).toBeLessThan(3);

  // Zoomed out fully: the whole file is visible and no further
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 100);
  view = (await page.getByTestId('minimap-view').boundingBox())!;
  expect(Math.abs(view.x - track.x)).toBeLessThan(3);
  expect(Math.abs(view.width - track.width)).toBeLessThan(3);
});
