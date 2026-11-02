const test = require('node:test'),
  assert = require('node:assert/strict'),
  { setup, installed, DOWNLOAD, SHA256 } = require('../engine-setup.cjs');
test('engine download is pinned to a versioned HTTPS archive and SHA-256', () => {
  assert.equal(new URL(DOWNLOAD).protocol, 'https:');
  assert.match(DOWNLOAD, /packages\/ffmpeg-9\.0\.2-essentials_build\.zip$/);
  assert.match(SHA256, /^[a-f0-9]{64}$/);
  assert.equal(installed(require('node:os').tmpdir()), false);
});
test(
  'a preinstalled valid engine is reused without a network request',
  { skip: process.platform !== 'win32' },
  async () => {
    const fs = require('node:fs/promises'),
      path = require('node:path'),
      os = require('node:os'),
      { FOLDER } = require('../engine-setup.cjs'),
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-engine-test-')),
      bin = path.join(root, FOLDER, 'bin');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(bin, 'ffmpeg.exe'), 'test fixture');
    await fs.writeFile(path.join(bin, 'ffprobe.exe'), 'test fixture');
    assert.equal(installed(root), true);
    assert.equal(await setup(root), bin);
  },
);
