const fs = require('node:fs/promises'),
  { createWriteStream, existsSync } = require('node:fs'),
  path = require('node:path'),
  { createHash } = require('node:crypto'),
  { Transform, Readable } = require('node:stream'),
  { pipeline } = require('node:stream/promises'),
  { spawn } = require('node:child_process');
const VERSION = '9.0.2',
  FOLDER = 'ffmpeg-9.0.2-essentials_build';
const DOWNLOAD = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip';
const SHA256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba';
function installed(root) {
  return ['ffmpeg.exe', 'ffprobe.exe'].every((name) =>
    existsSync(path.join(root, FOLDER, 'bin', name)),
  );
}
async function setup(root, progress = () => {}) {
  if (process.platform !== 'win32')
    throw Error(
      'Automatic engine setup currently supports Windows. Install FFmpeg and FFprobe on PATH on other systems.',
    );
  root = path.resolve(root);
  if (installed(root)) return path.join(root, FOLDER, 'bin');
  await fs.mkdir(root, { recursive: true });
  const temp = await fs.mkdtemp(path.join(root, '.setup-'));
  try {
    progress({ phase: 'download', value: 0 });
    const response = await fetch(DOWNLOAD, { signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!response.ok) throw Error('FFmpeg download failed: HTTP ' + response.status);
    const length = Number(response.headers.get('content-length')) || 0,
      hash = createHash('sha256');
    let bytes = 0,
      last = 0;
    const tap = new Transform({
      transform(chunk, encoding, callback) {
        hash.update(chunk);
        bytes += chunk.length;
        if (Date.now() - last > 200) {
          progress({ phase: 'download', value: length ? bytes / length : 0, bytes });
          last = Date.now();
        }
        callback(null, chunk);
      },
    });
    const archive = path.join(temp, 'engine.zip');
    await pipeline(Readable.fromWeb(response.body), tap, createWriteStream(archive));
    if (hash.digest('hex') !== SHA256)
      throw Error('FFmpeg download checksum did not match. Please try again.');
    progress({ phase: 'extract', value: 1 });
    await new Promise((resolve, reject) => {
      const child = spawn('tar.exe', ['-xf', archive, '-C', temp], { windowsHide: true });
      let error = '';
      child.stderr.on('data', (d) => (error += d));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(Error(error || 'Could not extract the FFmpeg download.')),
      );
    });
    const folder = path.join(temp, FOLDER);
    for (const name of ['ffmpeg.exe', 'ffprobe.exe'])
      await fs.access(path.join(folder, 'bin', name));
    await fs.rename(folder, path.join(root, FOLDER));
    progress({ phase: 'ready', value: 1 });
    return path.join(root, FOLDER, 'bin');
  } finally {
    if (path.dirname(temp) !== root || !path.basename(temp).startsWith('.setup-'))
      throw Error('Invalid setup workspace.');
    await fs.rm(temp, { recursive: true, force: true });
  }
}
module.exports = { setup, installed, VERSION, FOLDER, DOWNLOAD, SHA256 };
