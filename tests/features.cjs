const { _electron: electron } = require('playwright'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'test-output');
let app, profile;
async function launch() {
  const env = { ...process.env, FRAME_TEST_DATA: profile };
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
  return page;
}
async function exit() {
  const child = app.process(),
    done = new Promise((r) => child.once('exit', r));
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await done;
  app = null;
}
async function snapshots() {
  return (await fs.readdir(path.join(profile, 'recovery')).catch(() => [])).filter((n) =>
    n.endsWith('.json'),
  );
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-features-'));
  let page = await launch();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.click('#demo');
  await page.waitForFunction(() => frameDiagnostics().project.clips.length === 4);
  await page.locator('[data-project="radius"]').evaluate((el) => {
    el.value = 64;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('[data-bg="gradient"]');
  await page.click('#save-style');
  await page.fill('#style-name', 'My Twitter setup');
  await page.click('#confirm-save-style');
  await page.waitForFunction(() => !document.querySelector('#save-style-dialog').open);
  await page.locator('[data-project="radius"]').evaluate((el) => {
    el.value = 8;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#apply-style');
  assert.equal((await page.evaluate(() => frameDiagnostics())).project.radius, 64);
  console.log('PASS save and apply a style without altering footage');
  await page.locator('.timeline-clip').first().click();
  await page.keyboard.press('Control+Shift+C');
  await page.click('[data-speed="2"]');
  await page.waitForTimeout(1600);
  const names = await snapshots();
  assert.equal(names.length, 1);
  const recovery = JSON.parse(await fs.readFile(path.join(profile, 'recovery', names[0]), 'utf8'));
  assert.equal(recovery.project.clips.length, 5);
  assert.equal(recovery.project.media[0].url, undefined);
  console.log('PASS autosave writes current edits atomically to a session recovery');
  const before = (await page.evaluate(() => frameDiagnostics())).project;
  await page.click('#export');
  await page.waitForSelector('#export-settings[open]');
  const track = await page.locator('#range-timeline').boundingBox(),
    handle = await page.locator('#range-in-handle').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + track.width * 0.125,
    handle.y + handle.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  assert.ok(Math.abs(Number(await page.inputValue('#range-start')) - 0.5) < 0.05);
  console.log('PASS export timeline handles trim the selected range');
  await page.fill('#range-start', '.5');
  await page.press('#range-start', 'Tab');
  await page.fill('#range-end', '1.5');
  await page.press('#range-end', 'Tab');
  await page.selectOption('#output-fps', '30');
  await page.selectOption('#output-quality', 'ultra');
  await page.selectOption('#output-resolution', '720');
  assert.match(
    await page.locator('#output-summary').textContent(),
    /1280 × 720.*30 fps.*30 frames/,
  );
  await page.screenshot({ path: path.join(out, 'export-panel.png') });
  const target = path.join(out, 'selected-range-ultra.mp4');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, target);
  await page.click('#begin-export');
  await page.waitForFunction(
    () =>
      !document.querySelector('#reveal-export').hidden ||
      document.querySelector('#toast').textContent.startsWith('Export failed'),
    null,
    { timeout: 120000 },
  );
  assert.ok(
    await page.locator('#reveal-export').isVisible(),
    await page.locator('#toast').textContent(),
  );
  const probe = spawnSync(
    require('./engine.cjs').engine('ffprobe'),
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', target],
    { encoding: 'utf8', windowsHide: true },
  );
  const info = JSON.parse(probe.stdout),
    v = info.streams[0];
  assert.equal(v.width, 1280);
  assert.equal(v.height, 720);
  assert.equal(v.r_frame_rate, '30/1');
  assert.equal(v.nb_frames, '30');
  assert.equal(info.streams.length, 1);
  assert.ok(Math.abs(Number(info.format.duration) - 1) < 0.02);
  assert.deepEqual((await page.evaluate(() => frameDiagnostics())).project, before);
  console.log(
    'PASS range crosses a split and 2× footage, exports 1 second at 720p/30, preserves the project',
  );
  await page.click('#close-export');
  await exit();
  page = await launch();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#recovery-dialog[open]');
  await page.click('#restore-recovery');
  await page.waitForFunction(() => !document.querySelector('#recovery-dialog').open);
  let restored = (await page.evaluate(() => frameDiagnostics())).project;
  assert.equal(restored.clips.length, 5);
  assert.ok(restored.clips.some((c) => c.speed === 2));
  assert.equal(restored.radius, 64);
  assert.equal(restored.fps, 60);
  assert.equal((await snapshots()).length, 1);
  assert.ok(
    (await page.locator('#style-list option').allTextContents()).includes('My Twitter setup'),
  );
  console.log('PASS restart restores edits, source media, and persistent style presets');
  const saveFile = path.join(out, 'recovered.frame');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, saveFile);
  await page.click('#save-project');
  await page.waitForFunction(() => !frameDiagnostics().dirty);
  await page.waitForTimeout(100);
  assert.equal((await snapshots()).length, 0);
  assert.equal(JSON.parse(await fs.readFile(saveFile, 'utf8')).clips.length, 5);
  assert.deepEqual(errors, []);
  console.log(
    'PASS saving a recovered project clears its recovery and produces no renderer errors',
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await exit().catch(() => {});
  });
