const path = require('node:path'),
  fs = require('node:fs'),
  { spawnSync } = require('node:child_process'),
  { engine } = require('../tests/engine.cjs');
const root = path.resolve(__dirname, '..'),
  input = process.argv[2];
if (!input) throw Error('Pass the folder containing your four showcase videos.');
function run(args) {
  const r = spawnSync(engine('ffmpeg'), ['-v', 'error', ...args], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw Error(r.stderr);
}
const gif = (name, output, width, seconds, start = '0') =>
  run([
    '-ss',
    start,
    '-i',
    path.join(input, name),
    '-t',
    String(seconds),
    '-filter_complex',
    `fps=8,scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
    '-loop',
    '0',
    '-y',
    path.join(root, 'docs/media', output),
  ]);
gif('FrameStudio Demo Edited.mp4', 'showcase.gif', 900, 10);
gif('Example 1.mp4', 'outcome-01.gif', 640, 10, '4');
gif('Example 2.mp4', 'outcome-02.gif', 640, 10);
const font = "fontfile='C\\:/Windows/Fonts/segoeui.ttf'",
  panel = (index, title, label) =>
    `[${index}:v]fps=8,scale=460:280:force_original_aspect_ratio=decrease,pad=460:330:(ow-iw)/2:40+(280-ih)/2:color=0x17181a,drawtext=${font}:text='${title}':fontsize=14:fontcolor=0xe7ac86:x=14:y=12[${label}]`;
run([
  '-i',
  path.join(input, 'FrameStudi Demo Not EDIT.mp4'),
  '-i',
  path.join(input, 'FrameStudio Demo Edited.mp4'),
  '-t',
  '10',
  '-filter_complex',
  [
    panel(0, 'BEFORE  /  UNEDITED WALKTHROUGH', 'before'),
    panel(1, 'AFTER  /  EDITED IN FRAME STUDIO', 'after'),
    '[before][after]hstack=inputs=2,pad=960:350:20:10:color=0x17181a,split[a][b]',
    '[a]palettegen=stats_mode=diff[p]',
    '[b][p]paletteuse=dither=bayer:bayer_scale=3',
  ].join(';'),
  '-loop',
  '0',
  '-y',
  path.join(root, 'docs/media/before-after.gif'),
]);
for (const [source, dest] of [
  ['FrameStudio Demo Edited.mp4', 'Frame-Studio-Showcase.mp4'],
  ['FrameStudi Demo Not EDIT.mp4', 'Unedited-Walkthrough.mp4'],
  ['Example 1.mp4', 'Outcome-01.mp4'],
  ['Example 2.mp4', 'Outcome-02.mp4'],
]) {
  fs.copyFileSync(path.join(input, source), path.join(root, 'dist', dest));
}
console.log('Prepared four animated previews and full-quality release videos.');
