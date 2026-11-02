const { _electron: electron } = require('playwright');
let app;
(async () => {
  const env = {
    ...process.env,
    FRAME_TEST_DATA: require('node:fs').mkdtempSync(
      require('node:path').join(require('node:os').tmpdir(), 'frame-test-'),
    ),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  await page.click('#demo');
  await page.waitForFunction(
    () =>
      frameDiagnostics().decoded.length === 4 &&
      frameDiagnostics().decoded.every(
        (v) => v.ready >= 2 && !v.seeking && Math.abs(v.time - 1) < 0.02,
      ),
    null,
    { timeout: 20000 },
  );
  await page.screenshot({ path: 'test-output/preview-check.png' });
  console.log('PASS all four preview streams decoded and synchronized to the playhead');
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.evaluate(({ app }) => app.exit());
  });
