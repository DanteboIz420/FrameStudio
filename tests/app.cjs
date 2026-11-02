const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'test-output');
let app;
async function setSave(file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
}
async function setOpen(file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
}
async function probe(file) {
  const r = spawnSync(
    require('./engine.cjs').engine('ffprobe'),
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const env = {
    ...process.env,
    FRAME_TEST_DATA: require('node:fs').mkdtempSync(
      require('node:path').join(require('node:os').tmpdir(), 'frame-test-'),
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  console.log('Launching ' + (process.env.FRAME_PACKAGED ? 'packaged app' : 'Electron'));
  app = await electron.launch({
    ...(process.env.FRAME_PACKAGED
      ? { executablePath: path.join(root, 'dist/win-unpacked/Frame Studio.exe'), args: [] }
      : { args: [root] }),
    env,
    timeout: 60000,
  });
  console.log('Electron connected');
  app.process().stderr.on('data', (d) => console.log(String(d).slice(0, 1200)));
  const page = await app.firstWindow({ timeout: 60000 });
  console.log('Window ready', page.url());
  page.setDefaultTimeout(60000);
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#welcome-import');
  await page.screenshot({ path: path.join(out, 'empty.png') });
  await page.click('#demo');
  await page.waitForFunction(() => window.frameDiagnostics().project.clips.length === 4);
  await page.waitForFunction(
    () =>
      window.frameDiagnostics().decoded.length === 4 &&
      window
        .frameDiagnostics()
        .decoded.every((v) => v.ready >= 2 && !v.seeking && Math.abs(v.time - 1) < 0.02),
    null,
    { timeout: 20000 },
  );
  await page.screenshot({ path: path.join(out, 'studio.png') });
  const initial = await page.evaluate(() => window.frameDiagnostics());
  assert.equal(initial.project.layout, 'four');
  assert.equal(initial.project.media.length, 3);
  await page.locator('.timeline-clip').first().click();
  await page.keyboard.press('Control+Shift+C');
  await page.waitForFunction(() => window.frameDiagnostics().project.clips.length === 5);
  console.log('PASS split shortcut');
  await page.click('[data-speed="2"]');
  let state = await page.evaluate(() => window.frameDiagnostics());
  assert.equal(state.project.clips.find((c) => c.id === state.selected).speed, 2);
  await page.keyboard.press('Control+z');
  state = await page.evaluate(() => window.frameDiagnostics());
  assert.equal(state.project.clips.find((c) => c.id === state.selected).speed, 1);
  console.log('PASS speed and undo');
  await page.click('#play');
  await page.waitForTimeout(350);
  assert.equal((await page.evaluate(() => window.frameDiagnostics())).playing, true);
  await page.click('#play');
  console.log('PASS playback');
  const saveFile = path.join(out, 'roundtrip.frame');
  await setSave(saveFile);
  await page.click('#save-project');
  await page.waitForFunction(() => !window.frameDiagnostics().dirty);
  const saved = JSON.parse(await fs.readFile(saveFile, 'utf8'));
  assert.equal(saved.clips.length, 5);
  assert.equal(saved.media[0].url, undefined);
  console.log('PASS project save');
  // Reopen a short project to exercise real canvas decoding, grid compositing and MP4 encoding.
  const short = {
    ...saved,
    clips: saved.clips
      .filter((c) => c.start === 0)
      .map((c) => ({ ...c, in: 0, out: 0.3, start: 0 })),
    name: 'Export verification',
  };
  const fixture = path.join(out, 'short.frame');
  await fs.writeFile(fixture, JSON.stringify(short));
  await setOpen(fixture);
  await page.click('#open-project', { noWaitAfter: true });
  await page.waitForFunction(
    () => window.frameDiagnostics().project.name === 'Export verification',
  );
  assert.equal((await page.evaluate(() => window.frameDiagnostics())).project.clips.length, 4);
  console.log('PASS project reopen');
  await setSave(path.join(out, 'grid-1080p60.mp4'));
  await page.click('#export');
  await page.click('#begin-export');
  await page.waitForSelector('#reveal-export:visible', { timeout: 120000 });
  let info = await probe(path.join(out, 'grid-1080p60.mp4'));
  let v = info.streams.find((s) => s.codec_type === 'video');
  assert.equal(v.width, 1920);
  assert.equal(v.height, 1080);
  assert.equal(v.r_frame_rate, '60/1');
  assert.equal(info.streams.length, 1);
  assert.equal(Number(v.nb_frames), 18);
  console.log('PASS real grid MP4 export: 1920×1080, 60 fps, 18 frames, no audio');
  await page.click('#close-export');
  await page.click('[data-tab="canvas"]');
  await page.click('[data-format="1080,1920"]');
  await page.click('#save-project');
  await page.waitForFunction(() => !window.frameDiagnostics().dirty);
  await setSave(path.join(out, 'portrait-1080p60.mp4'));
  await page.click('#export');
  await page.click('#begin-export');
  await page.waitForSelector('#reveal-export:visible', { timeout: 120000 });
  info = await probe(path.join(out, 'portrait-1080p60.mp4'));
  v = info.streams[0];
  assert.equal(v.width, 1080);
  assert.equal(v.height, 1920);
  assert.equal(v.r_frame_rate, '60/1');
  console.log('PASS real portrait MP4 export');
  await page.click('#close-export');
  await setOpen(saveFile);
  await page.click('#open-project', { noWaitAfter: true });
  await page.waitForFunction(() => window.frameDiagnostics().project.name === 'A few good things');
  await setSave(path.join(out, 'cancelled.mp4'));
  await page.click('#export');
  await page.click('#begin-export');
  await page.waitForSelector('#cancel-export:visible');
  await page.click('#cancel-export');
  await page.waitForFunction(() => !window.frameDiagnostics().exporting, { timeout: 30000 });
  assert.equal(
    await fs.stat(path.join(out, 'cancelled.mp4')).then(
      () => true,
      () => false,
    ),
    false,
  );
  console.log('PASS export cancellation removes partial output');
  await page.click('[data-tab="canvas"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'studio.png') });
  assert.deepEqual(errors, []);
  console.log('PASS no renderer errors');
})()
  .catch(async (e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  });
