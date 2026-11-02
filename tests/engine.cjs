const path = require('node:path'),
  { existsSync } = require('node:fs'),
  { FOLDER } = require('../engine-setup.cjs');
function engine(name) {
  const exe = name + (process.platform === 'win32' ? '.exe' : '');
  for (const dir of [
    process.env.FRAME_FFMPEG_DIR,
    path.join(__dirname, '../engine', FOLDER, 'bin'),
    path.join(__dirname, '../engine'),
  ].filter(Boolean)) {
    const file = path.join(dir, exe);
    if (existsSync(file)) return file;
  }
  return name;
}
module.exports = { engine };
