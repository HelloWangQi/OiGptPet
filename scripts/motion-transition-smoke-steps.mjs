import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';

async function captureCanvas(page, output, name) {
  const bytes = await page.locator('#character-canvas').screenshot({ path: path.join(output, name + '.png') });
  return createHash('sha256').update(bytes).digest('hex');
}

async function stabilizeGaze(page) {
  const bounds = await page.locator('#character-canvas').boundingBox();
  if (!bounds) throw new Error('Character canvas is not visible');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

export async function checkVrmTransitions(page, output) {
  // Let pointer-driven gaze settle so each capture isolates the animation pose.
  await page.waitForTimeout(1900);
  await captureCanvas(page, output, 'motion-idle-before');
  await page.evaluate(() => document.querySelector('[data-state="waving"]').click());
  await page.waitForTimeout(90);
  const waveMid = await captureCanvas(page, output, 'motion-wave-transition');
  await page.waitForTimeout(220);
  const waveSettled = await captureCanvas(page, output, 'motion-wave-settled');
  assert.notEqual(waveMid, waveSettled, 'VRM action change should render a changing transition');

  await page.evaluate(() => document.querySelector('[data-state="waving"]').click());
  await page.waitForTimeout(90);
  const replayMid = await captureCanvas(page, output, 'motion-wave-replay-transition');
  await page.waitForTimeout(220);
  const replaySettled = await captureCanvas(page, output, 'motion-wave-replay-settled');
  assert.notEqual(replayMid, replaySettled, 'same-action replay should restart through the transition');

  await page.evaluate(() => document.querySelector('#pause-button').click());
  await stabilizeGaze(page);
  await page.waitForTimeout(80);
  const pausedFrame = await captureCanvas(page, output, 'motion-paused-before-switch');
  await page.evaluate(() => document.querySelector('[data-state="failed"]').click());
  await stabilizeGaze(page);
  await page.waitForTimeout(240);
  const pausedAfterSwitch = await captureCanvas(page, output, 'motion-paused-after-switch');
  assert.equal(pausedAfterSwitch, pausedFrame, 'paused animation should preserve the visible pose');
  await page.evaluate(() => document.querySelector('#pause-button').click());
  await page.waitForTimeout(260);
  const resumed = await captureCanvas(page, output, 'motion-resumed-transition');
  assert.notEqual(resumed, pausedAfterSwitch, 'animation should resume after unpausing');

  await page.evaluate(() => document.querySelector('[data-state="idle"]').click());
  await page.waitForTimeout(260);
  return { stateChange: true, sameActionReplay: true, pauseResume: true };
}

export async function checkSpriteTransitions(page) {
  // Let pointer gaze expire and its low-frame-rate exit crossfade finish
  // before recording the action-row transition baseline.
  await page.waitForTimeout(2700);
  await page.evaluate(() => {
    const canvas = document.querySelector('#character-canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Sprite canvas context is unavailable');
    const original = context.drawImage;
    const log = [];
    Object.defineProperty(context, 'drawImage', {
      configurable: true,
      value: function (...args) {
        log.push({ sx: args[1], sy: args[2], alpha: this.globalAlpha, composite: this.globalCompositeOperation });
        return original.apply(this, args);
      },
    });
    window.__spriteTransitionProbe = { context, original, log };
  });

  const waitForPair = async (fromRows, toRows, replay = false, timeout = 2000) => {
    const args = { fromRows, toRows, replay };
    const findPair = ({ fromRows, toRows, replay }) => {
      const log = window.__spriteTransitionProbe.log;
      for (let index = 0; index + 1 < log.length; index += 1) {
        const from = log[index]; const to = log[index + 1];
        if (from.composite !== 'lighter' || to.composite !== 'lighter') continue;
        if (!fromRows.includes(from.sy) || !toRows.includes(to.sy)) continue;
        if (Math.abs(from.alpha + to.alpha - 1) > 0.001 || from.alpha <= 0 || to.alpha <= 0) continue;
        if (replay && from.sx === to.sx) continue;
        return { from, to };
      }
      return null;
    };
    await page.waitForFunction(findPair, args, { timeout, polling: 50 });
    return page.evaluate(findPair, args);
  };

  try {
    await page.evaluate(() => document.querySelector('[data-state="waving"]').click());
    const changed = await waitForPair([0], [3 * 208]);

    await page.waitForTimeout(260);
    await page.evaluate(() => { window.__spriteTransitionProbe.log.length = 0; });
    await page.evaluate(() => document.querySelector('[data-state="waving"]').click());
    const replay = await waitForPair([3 * 208], [3 * 208], true);

    await page.waitForTimeout(260);
    const bounds = await page.locator('#character-canvas').boundingBox();
    assert.ok(bounds, 'sprite preview canvas should remain visible');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const gazeEntry = await waitForPair([3 * 208], [9 * 208, 10 * 208]);

    await page.waitForTimeout(250);
    await page.evaluate(() => { window.__spriteTransitionProbe.log.length = 0; });
    // Begin sampling shortly before gaze expires so idle frame pacing cannot
    // make the whole crossfade pass between two observations.
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__spriteTransitionProbe.log.length = 0; });
    const gazeExit = await waitForPair([9 * 208, 10 * 208], [3 * 208], false, 1800);
    return { stateChange: true, sameActionReplay: true, gazeEntry, gazeExit, blend: changed, replay };
  } finally {
    await page.evaluate(() => {
      const probe = window.__spriteTransitionProbe;
      Object.defineProperty(probe.context, 'drawImage', { configurable: true, value: probe.original });
      delete window.__spriteTransitionProbe;
    });
  }
}
