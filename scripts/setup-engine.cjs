const path = require('node:path');
const { setup } = require('../engine-setup.cjs');
setup(path.resolve(__dirname, '../engine'), (p) =>
  process.stdout.write(
    '\r' +
      (p.phase === 'download'
        ? 'Downloading FFmpeg ' + Math.floor(p.value * 100) + '%'
        : p.phase === 'extract'
          ? 'Extracting verified download…'
          : 'FFmpeg ready.') +
      '          ',
  ),
)
  .then((dir) => console.log('\nEngine installed: ' + dir))
  .catch((e) => {
    console.error('\n' + e.message);
    process.exitCode = 1;
  });
