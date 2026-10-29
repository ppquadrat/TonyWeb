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

test('the view follows the cursor moved near the right edge, but not on other clicks', async ({ page }, testInfo) => {
  const wav = writeToneWav(testInfo, [[220, 20]]);
  await loadAudio(page, wav);
  const box = await viewGeometry(page);
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  for (let i = 0; i < 15; i++) await page.mouse.wheel(0, -100);
  const viewX = async () => (await page.getByTestId('minimap-view').boundingBox())!.x;
  const start = await viewX();

  // A click in the middle leaves the view alone
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height - 10);
  expect(await viewX()).toBeCloseTo(start, 0);

  // A click near the right edge brings the cursor back into the view
  await page.mouse.click(box.x + box.width * 0.95, box.y + box.height - 10);
  await expect.poll(viewX).toBeGreaterThan(start + 2);

  // Arrow keys past the right edge keep it in view
  const after = await viewX();
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(viewX).toBeGreaterThan(after);
});

test('a click that jitters by a pixel or two does not make a looping selection', async ({ page }, testInfo) => {
  const wav = writeToneWav(testInfo, [[220, 20]]);
  await loadAudio(page, wav);
  const box = await viewGeometry(page);
  const x = box.x + box.width * 0.4, y = box.y + box.height - 10;
  await page.mouse.move(x, y);
  // Zoomed in, as when annotating notes
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, -100);
  await page.mouse.down();
  // The hand wobbles right and back a little before the button is released
  await page.mouse.move(x + 3, y, { steps: 3 });
  await page.mouse.move(x + 1, y);
  await page.mouse.up();
  await expect(page.getByTitle('Loop Selection')).not.toHaveClass(/bg-blue-200/);
});
