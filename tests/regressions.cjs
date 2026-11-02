const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'test-output');
let app;
(async () => {
  const env = {
    ...process.env,
    FRAME_TEST_DATA: require('node:fs').mkdtempSync(
      require('node:path').join(require('node:os').tmpdir(), 'frame-test-'),
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.FRAME_PACKAGED
      ? { executablePath: path.join(root, 'dist/win-unpacked/Frame Studio.exe'), args: [] }
      : { args: [root] }),
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(60000);
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.click('#demo');
  await page.waitForFunction(
    () =>
      frameDiagnostics().decoded.length === 4 &&
      frameDiagnostics().decoded.every((v) => v.ready >= 2 && !v.seeking),
  );
  const pixel = () =>
    page.evaluate(() => {
      const c = document.querySelector('#stage');
      return c
        .getContext('2d')
        .getImageData(Math.round(c.width * 0.16), Math.round(c.height * 0.14), 1, 1).data[0];
    });
  const ruler = await page.locator('#ruler').boundingBox();
  await page.mouse.move(ruler.x + 20, ruler.y + 16);
  await page.mouse.down();
  let minimum = 255;
  for (const second of [0.4, 2.7, 0.8, 3.2, 0.2, 1.6, 3.5, 0.5]) {
    await page.mouse.move(ruler.x + second * 55, ruler.y + 16, { steps: 3 });
    minimum = Math.min(minimum, await pixel());
  }
  await page.mouse.up();
  assert.ok(minimum > 180, 'Preview cleared while scrubbing: ' + minimum);
  console.log('PASS continuous held-mouse scrubbing retains decoded frames');
  await page.locator('.timeline-clip').first().click();
  await page.click('[data-speed="2"]');
  await page.click('#go-start');
  await page.keyboard.press('Space');
  minimum = 255;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(50);
    minimum = Math.min(minimum, await pixel());
  }
  await page.keyboard.press('Space');
  assert.ok(minimum > 180, '2× playback flashed: ' + minimum);
  console.log('PASS spacebar 2× playback without black flashes');
  // Move split footage with Insert mode, then verify the switch is undoable.
  await page.click('#go-start');
  await page.mouse.click(ruler.x + 55, ruler.y + 16);
  await page.keyboard.press('Control+Shift+C');
  await page.click('#insert-mode');
  assert.equal((await page.evaluate(() => frameDiagnostics())).project.insertMode, true);
  let b = await page.locator('.timeline-clip.selected').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 4, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  let p = (await page.evaluate(() => frameDiagnostics())).project;
  const row = p.clips.filter((c) => c.slot === 0).sort((a, b) => a.start - b.start);
  assert.equal(row.length, 2);
  assert.ok(row[0].start + (row[0].out - row[0].in) / row[0].speed <= row[1].start + 0.001);
  console.log('PASS insert drag pushes clips aside instead of overlapping');
  await page.click('#ripple');
  p = (await page.evaluate(() => frameDiagnostics())).project;
  const packed = p.clips.filter((c) => c.slot === 0).sort((a, b) => a.start - b.start);
  assert.equal(packed[0].start, 0);
  assert.ok(Math.abs(packed[1].start - (packed[0].out - packed[0].in) / packed[0].speed) < 0.001);
  console.log('PASS Snap all together');
  await page.click('[data-tab="canvas"]');
  await page.selectOption('#export-fps', '30');
  assert.equal((await page.evaluate(() => frameDiagnostics())).project.fps, 30);
  // Native export at 30 fps, with cuts and 2× footage, exercises scene concatenation.
  const target = path.join(out, 'regression-30fps.mp4');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, target);
  const began = Date.now();
  await page.click('#export');
  await page.click('#begin-export');
  await page.waitForFunction(
    () =>
      !document.querySelector('#reveal-export').hidden ||
      document.querySelector('#toast').textContent.startsWith('Export failed'),
    null,
    { timeout: 120000 },
  );
  assert.equal(
    await page.locator('#reveal-export').isVisible(),
    true,
    await page.locator('#toast').textContent(),
  );
  const elapsed = (Date.now() - began) / 1000;
  const result = spawnSync(
    require('./engine.cjs').engine('ffprobe'),
    ['-v', 'error', '-show_streams', '-of', 'json', target],
    { encoding: 'utf8', windowsHide: true },
  );
  const streams = JSON.parse(result.stdout).streams;
  assert.equal(streams.length, 1);
  assert.equal(streams[0].r_frame_rate, '30/1');
  assert.equal(Number(streams[0].nb_frames), 120);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, 'native-timing.json'),
    JSON.stringify({ seconds: elapsed, duration: 4, fps: 30, grid: 4 }, null, 2),
  );
  console.log(
    'PASS native 30 fps multi-scene export: ' + elapsed.toFixed(2) + ' s for 4 s of video',
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  });
