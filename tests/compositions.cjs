const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
let app;
(async () => {
  const root = path.resolve(__dirname, '..'),
    out = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-compositions-'));
  const env = { ...process.env, FRAME_TEST_DATA: path.join(out, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    ...(process.env.FRAME_PACKAGED
      ? { executablePath: path.join(root, 'dist/win-unpacked/Frame Studio.exe'), args: [] }
      : { args: [root] }),
    env,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.click('#demo');
  await page.waitForFunction(() => frameDiagnostics().project.clips.length === 4);
  await page.locator('.timeline-clip').first().click({ button: 'right' });
  await page.click('#clip-to-composition');
  await page.fill('#composition-name', 'Pinterest one');
  await page.click('#confirm-composition-name');
  let p = (await page.evaluate(() => frameDiagnostics())).project;
  assert.equal(p.compositions.length, 2);
  assert.equal(p.clips.length, 1);
  assert.equal(p.clips[0].start, 0);
  await page.locator('.timeline-clip').first().click();
  await page.click('[data-speed="2"]');
  await page.click('#duplicate-composition');
  await page.fill('#composition-name', 'Pinterest two');
  await page.click('#confirm-composition-name');
  await page.locator('[data-project="radius"]').evaluate((el) => {
    el.value = 60;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.composition-item').nth(1).click();
  assert.notEqual((await page.evaluate(() => frameDiagnostics())).project.radius, 60);
  await page.locator('.composition-item').nth(2).click();
  assert.equal((await page.evaluate(() => frameDiagnostics())).project.radius, 60);
  const file = path.join(out, 'compositions.frame');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
  await page.click('#save-project');
  await page.waitForFunction(() => !frameDiagnostics().dirty);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.compositions.length, 3);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  const priorUrl = await page.evaluate(() => frameDiagnostics().project.media[0].url);
  await page.click('#open-project');
  await page.waitForFunction((url) => frameDiagnostics().project.media[0].url !== url, priorUrl);
  for (let i = 1; i <= 2; i++) {
    await page.locator('.composition-item').nth(i).click();
    await page.click('#export');
    await page.fill('#range-end', '0.5');
    await page.locator('#range-end').dispatchEvent('change');
    await page.selectOption('#output-resolution', '720');
    await page.selectOption('#output-fps', '30');
    await page.selectOption('#output-quality', 'draft');
    await page.click('#add-to-queue');
  }
  await page.click('#show-queue');
  assert.equal(await page.locator('.queue-item').count(), 2);
  assert.match(await page.locator('.queue-item').nth(0).textContent(), /Pinterest one/);
  assert.match(await page.locator('.queue-item').nth(1).textContent(), /Pinterest two/);
  await page.screenshot({ path: path.join(root, 'test-output/compositions-queue.png') });
  await app.evaluate(({ dialog }, out) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [out] });
    dialog.showSaveDialog = async () => {
      throw Error('Unexpected per-video save dialog');
    };
  }, out);
  await page.click('#run-queue');
  await page.waitForFunction(
    () => document.querySelector('#queue-status').textContent.startsWith('2 completed'),
    null,
    { timeout: 180000 },
  );
  const videos = (await fs.readdir(out)).filter((n) => n.endsWith('.mp4'));
  assert.equal(videos.length, 2);
  for (const f of videos) {
    const probe = spawnSync(
      require('./engine.cjs').engine('ffprobe'),
      ['-v', 'error', '-show_streams', '-of', 'json', path.join(out, f)],
      { encoding: 'utf8' },
    );
    const info = JSON.parse(probe.stdout);
    assert.equal(info.streams.length, 1);
    assert.equal(info.streams[0].nb_frames, '15');
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS independent compositions, clip creation, duplication, save/reopen, queue snapshots and two muted 15-frame exports without save prompts',
  );
  console.log(out);
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.evaluate(({ app }) => app.exit(0));
  });
