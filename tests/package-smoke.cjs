const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  output = path.join(root, 'test-output');
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
    executablePath: path.join(root, 'dist/win-unpacked/Frame Studio.exe'),
    args: [],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.click('#demo');
  await page.waitForFunction(() => window.frameDiagnostics().project.clips.length === 4, {
    timeout: 30000,
  });
  await page.waitForFunction(
    () =>
      window.frameDiagnostics().decoded.length === 4 &&
      window
        .frameDiagnostics()
        .decoded.every((v) => v.ready >= 2 && !v.seeking && Math.abs(v.time - 1) < 0.02),
    null,
    { timeout: 20000 },
  );
  await page.screenshot({ path: path.join(output, 'packaged-studio.png') });
  const state = await page.evaluate(() => window.frameDiagnostics());
  assert.ok(state.project.media[0].path.includes('resources'));
  console.log('PASS packaged sample media and bundled FFprobe/FFmpeg');
  // Exercise drag-to-move and trim through pointer events.
  const first = page.locator('.timeline-clip').first();
  let b = await first.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  let moved = await page.evaluate(() => window.frameDiagnostics());
  assert.ok(moved.project.clips[0].start > 0);
  console.log('PASS timeline drag');
  await page.keyboard.press('Control+z');
  const trim = await page.locator('.trim-handle.right').first().boundingBox();
  await page.mouse.move(trim.x + trim.width / 2, trim.y + trim.height / 2);
  await page.mouse.down();
  await page.mouse.move(trim.x - 30, trim.y + trim.height / 2, { steps: 5 });
  await page.mouse.up();
  moved = await page.evaluate(() => window.frameDiagnostics());
  assert.ok(moved.project.clips[0].out < 4);
  console.log('PASS trim edge');
  await page.keyboard.press('Control+z');
  await page.click('[data-tab="canvas"]');
  await page.click('[data-layout="single"]');
  await page.click('[data-format="1080,1920"]');
  let p = (await page.evaluate(() => window.frameDiagnostics())).project;
  p.name = 'Packaged smoke';
  p.clips = p.clips.filter((c) => c.slot === 0).map((c) => ({ ...c, in: 0, out: 0.05, start: 0 }));
  const fixture = path.join(output, 'package.frame');
  await fs.writeFile(fixture, JSON.stringify(p));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture);
  page.on('dialog', (d) => d.accept());
  await page.click('#open-project');
  await page.waitForFunction(() => window.frameDiagnostics().project.name === 'Packaged smoke');
  const target = path.join(output, 'packaged.mp4');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, target);
  await page.click('#export');
  await page.click('#begin-export');
  await page.waitForSelector('#reveal-export:visible', { timeout: 60000 });
  const r = spawnSync(
    require('./engine.cjs').engine('ffprobe'),
    ['-v', 'error', '-show_streams', '-of', 'json', target],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout).streams[0];
  assert.equal(v.width, 1080);
  assert.equal(v.height, 1920);
  assert.equal(v.nb_frames, '3');
  assert.equal(v.r_frame_rate, '60/1');
  assert.deepEqual(errors, []);
  console.log('PASS packaged portrait MP4 export: bundled engine, 60 fps, muted');
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  });
