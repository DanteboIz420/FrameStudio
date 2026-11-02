const { _electron: electron } = require('playwright');
const path = require('node:path'),
  fs = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
if (!process.env.FRAME_PREVIOUS_EXE) {
  console.error('Set FRAME_PREVIOUS_EXE to a previous build to run this optional comparison.');
  process.exit(1);
}
(async () => {
  const timings = {};
  for (const version of ['previous', 'native']) {
    const env = {
      ...process.env,
      FRAME_TEST_DATA: require('node:fs').mkdtempSync(
        require('node:path').join(require('node:os').tmpdir(), 'frame-test-'),
      ),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    let app;
    try {
      app = await electron.launch({
        ...(version === 'previous'
          ? { executablePath: process.env.FRAME_PREVIOUS_EXE, args: [] }
          : { args: [root] }),
        env,
        timeout: 60000,
      });
      const page = await app.firstWindow({ timeout: 60000 });
      page.setDefaultTimeout(60000);
      await page.click('#demo');
      await page.waitForFunction(() => frameDiagnostics().project.clips.length === 4);
      await app.evaluate(
        ({ dialog }, file) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
        },
        path.join(root, 'test-output', `benchmark-${version}.mp4`),
      );
      const start = Date.now();
      await page.click('#export');
      if (version === 'native') await page.click('#begin-export');
      await page.waitForFunction(
        () =>
          !document.querySelector('#reveal-export').hidden ||
          document.querySelector('#toast').textContent.startsWith('Export failed'),
        null,
        { timeout: 240000 },
      );
      if (!(await page.locator('#reveal-export').isVisible()))
        throw Error(await page.locator('#toast').textContent());
      timings[version] = (Date.now() - start) / 1000;
      console.log(version + ': ' + timings[version] + ' s');
    } finally {
      if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  }
  timings.speedup = timings.previous / timings.native;
  await fs.writeFile(
    path.join(root, 'test-output/benchmark.json'),
    JSON.stringify(timings, null, 2),
  );
  console.log('Native speedup: ' + timings.speedup.toFixed(2) + '×');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
