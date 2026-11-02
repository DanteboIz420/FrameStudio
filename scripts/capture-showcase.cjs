const { _electron: electron } = require('playwright'),
  path = require('node:path'),
  fs = require('node:fs/promises'),
  os = require('node:os');
const root = path.resolve(__dirname, '..');
let app;
(async () => {
  const env = {
    ...process.env,
    FRAME_TEST_DATA: await fs.mkdtemp(path.join(os.tmpdir(), 'frame-showcase-')),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  await page.click('#demo');
  await page.waitForFunction(
    () =>
      frameDiagnostics().decoded.length === 4 &&
      frameDiagnostics().decoded.every((v) => v.ready >= 2 && !v.seeking),
  );
  await page.waitForTimeout(5800);
  await page.screenshot({ path: path.join(root, 'docs/media/editor.png') });
  await page.click('#export');
  await page.fill('#range-end', '3');
  await page.press('#range-end', 'Tab');
  await page.selectOption('#output-quality', 'ultra');
  await page.screenshot({ path: path.join(root, 'docs/media/export-panel.png') });
  await page.click('#dismiss-export-settings');
  await page.click('[data-layout="single"]');
  await page.waitForTimeout(300);
  await page.click('#export');
  await page.selectOption('#output-fps', '30');
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  await app.evaluate(
    ({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    },
    path.join(root, 'test-output/featured-demo.mp4'),
  );
  await page.click('#begin-export');
  await page.waitForFunction(
    () =>
      !document.querySelector('#reveal-export').hidden ||
      document.querySelector('#toast').textContent.startsWith('Export failed'),
    null,
    { timeout: 120000 },
  );
  if (!(await page.locator('#reveal-export').isVisible()))
    throw Error(await page.locator('#toast').textContent());
  console.log('Captured editor, export panel and real featured-video export.');
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  });
