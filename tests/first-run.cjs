const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let app;
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-ready-to-use-')),
    env = { ...process.env, FRAME_TEST_DATA: profile };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.PATH = path.join(process.env.SystemRoot, 'System32') + ';' + process.env.SystemRoot;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.FRAME_FFMPEG_DIR;
  app = await electron.launch({
    executablePath: path.join(root, 'dist/win-unpacked/Frame Studio.exe'),
    args: [],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow({ timeout: 60000 });
  page.setDefaultTimeout(60000);
  await page.waitForSelector('#welcome-import');
  assert.equal(await page.locator('#engine-dialog').count(), 0);
  console.log('PASS clean Windows profile opens without installation or an engine prompt');
  await page.click('#demo');
  await page.waitForFunction(() => frameDiagnostics().project.clips.length === 4);
  await page.click('#export');
  await page.fill('#range-end', '1');
  await page.press('#range-end', 'Tab');
  await page.selectOption('#output-fps', '30');
  await page.selectOption('#output-resolution', '720');
  const target = path.join(root, 'test-output/first-run.mp4');
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
      path.join(root, 'dist/win-unpacked/resources/engine/ffprobe.exe'),
      ['-v', 'error', '-show_streams', '-of', 'json', target],
      { encoding: 'utf8', windowsHide: true },
    ),
    stream = JSON.parse(probe.stdout).streams[0];
  assert.equal(stream.width, 1280);
  assert.equal(stream.r_frame_rate, '30/1');
  assert.equal(stream.nb_frames, '30');
  console.log('PASS clean profile exports using bundled FFmpeg with no system engine on PATH');
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  });
