const path = require('node:path'),
  { spawnSync } = require('node:child_process'),
  { engine } = require('../tests/engine.cjs');
const root = path.resolve(__dirname, '..');
const font = "fontfile='C\\:/Windows/Fonts/segoeui.ttf'";
const panel = (input, title, label) =>
  `[${input}:v]fps=10,scale=460:280:force_original_aspect_ratio=decrease,pad=460:330:(ow-iw)/2:40+(280-ih)/2:color=0x17181a,drawtext=${font}:text='${title}':fontsize=14:fontcolor=0xe7ac86:x=14:y=12[${label}]`;
const filter = [
  panel(0, 'BEFORE  /  RAW RECORDING', 'before'),
  panel(1, 'AFTER  /  FRAME STUDIO', 'after'),
  '[before][after]hstack=inputs=2,pad=960:350:20:10:color=0x17181a,split[a][b]',
  '[a]palettegen=stats_mode=diff[p]',
  '[b][p]paletteuse=dither=bayer:bayer_scale=3',
].join(';');
const r = spawnSync(
  engine('ffmpeg'),
  [
    '-v',
    'error',
    '-i',
    path.join(root, 'assets/orbit.mp4'),
    '-i',
    path.join(root, 'test-output/featured-demo.mp4'),
    '-filter_complex',
    filter,
    '-t',
    '4',
    '-loop',
    '0',
    '-y',
    path.join(root, 'docs/media/before-after.gif'),
  ],
  { windowsHide: true, encoding: 'utf8' },
);
if (r.status !== 0) {
  console.error(r.stderr);
  process.exitCode = 1;
} else console.log('Generated inline before/after GIF from the sample and real export.');
