import { test, expect, Page } from '@playwright/test';
import { writeToneWav, loadAudio } from './helpers';

const DURATION = 6;

const laneCoords = async (page: Page) => {
  const lane = page.getByTestId('segment-lane').first();
  const box = (await lane.boundingBox())!;
  const zoom = box.width / DURATION; // after Fit
  return { x: (t: number) => box.x + t * zoom, y: box.y + box.height * 0.7 };
};

const dragInLane = async (page: Page, x1: number, x2: number, y: number) => {
  await page.mouse.move(x1, y);
  await page.mouse.down();
  await page.mouse.move(x2, y, { steps: 6 });
  await page.mouse.up();
};

test('create, label and delete segments in a layer', async ({ page }, testInfo) => {
  await loadAudio(page, writeToneWav(testInfo, [[220, 2], [330, 2], [262, 2]]));
  await page.keyboard.press('KeyF');

  await page.getByRole('button', { name: 'Segment layer' }).click();
  await expect(page.getByTestId('segment-lane')).toHaveCount(1);
  await expect(page.getByTestId('segment-lane').first()).toHaveAttribute('data-layer-name', 'Lyrics');

  const c = await laneCoords(page);

  // Drag to create, then type the label; Enter commits
  await dragInLane(page, c.x(1), c.x(2), c.y);
  const input = page.getByTestId('segment-label-input');
  await expect(input).toBeFocused();
  // The new segment shows as the time selection in the pitch view while labelling
  await expect(page.getByTitle('Loop Selection')).toHaveClass(/bg-blue-200/);
  await page.screenshot({ path: testInfo.outputPath('editing.png') });
  await input.fill('la');
  await input.press('Enter');

  // A second segment right after it (start snaps to the first one's end)
  await dragInLane(page, c.x(2.02), c.x(3), c.y);
  await page.getByTestId('segment-label-input').fill('li');
  await page.getByTestId('segment-label-input').press('Enter');

  await expect(page.getByTestId('segment-label')).toHaveText(['la', 'li']);

  // Double-click the first segment and use Tab to move on to the next one
  await page.mouse.dblclick(c.x(1.5), c.y);
  await page.getByTestId('segment-label-input').fill('lo');
  await page.getByTestId('segment-label-input').press('Tab');
  await expect(page.getByTestId('segment-label-input')).toHaveValue('li');
  await page.getByTestId('segment-label-input').press('Escape');
  await expect(page.getByTestId('segment-label')).toHaveText(['lo', 'li']);

  // Select the second segment and delete it
  await page.mouse.click(c.x(2.5), c.y);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('segment-label')).toHaveText(['lo']);

  // Undo brings it back
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('segment-label')).toHaveText(['lo', 'li']);
});

test('Enter turns a time selection into a segment', async ({ page }, testInfo) => {
  await loadAudio(page, writeToneWav(testInfo, [[220, DURATION]]));
  await page.keyboard.press('KeyF');
  await page.getByRole('button', { name: 'Segment layer' }).click();

  const view = (await page.getByTestId('pitch-view').boundingBox())!;
  const zoom = view.width / DURATION;
  await page.mouse.move(view.x + 3 * zoom, view.y + 100);
  await page.mouse.down();
  await page.mouse.move(view.x + 4 * zoom, view.y + 100, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Enter');

  const input = page.getByTestId('segment-label-input');
  await expect(input).toBeFocused();
  await input.fill('Anna');
  await input.press('Enter');
  await expect(page.getByTestId('segment-label')).toHaveText(['Anna']);
});
