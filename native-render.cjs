const fs = require('node:fs/promises'),
  path = require('node:path'),
  { spawn } = require('node:child_process');
async function renderNative({
  project: p,
  assets,
  dir,
  temp,
  engine,
  job,
  progress,
  options = {},
}) {
  const { duration, projectDuration, slots, activeAt } = await import('./src/model.mjs');
  const { QUALITY } = await import('./src/project-options.mjs'),
    quality = QUALITY[options.quality || 'high'];
  const fps = p.fps,
    total = Math.ceil((options.duration ?? projectDuration(p)) * fps - 1e-7),
    clips = p.clips.filter((c) => c.slot < slots(p));
  const cuts = [
    ...new Set([
      0,
      total,
      ...clips.flatMap((c) => [
        Math.ceil(c.start * fps - 1e-7),
        Math.ceil((c.start + duration(c)) * fps - 1e-7),
      ]),
    ]),
  ]
    .filter((x) => x >= 0 && x <= total)
    .sort((a, b) => a - b);
  const base = path.join(dir, 'base.png');
  await fs.writeFile(base, Buffer.from(assets.base));
  const art = {};
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i],
      a = assets.clips[c.id];
    if (!a) throw Error('Missing composition assets.');
    const mask = path.join(dir, `mask-${i}.png`),
      shadow = path.join(dir, `shadow-${i}.png`);
    await fs.writeFile(mask, Buffer.from(a.mask));
    await fs.writeFile(shadow, Buffer.from(a.shadow));
    art[c.id] = { ...a, mask, shadow };
  }
  async function exec(args, offset = 0) {
    if (job.canceled) throw Error('Export canceled.');
    await new Promise((resolve, reject) => {
      const child = spawn(engine('ffmpeg'), args, { windowsHide: true });
      job.proc = child;
      let err = '',
        buffer = '';
      child.stderr.on('data', (d) => (err = (err + d).slice(-6000)));
      child.stdout.on('data', (d) => {
        buffer += d;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const m = /^frame=\s*(\d+)/.exec(line);
          if (m) progress(Math.min(0.99, (offset + Number(m[1])) / total));
        }
      });
      child.on('error', reject);
      child.on('close', (code) => {
        job.proc = null;
        code === 0 && !job.canceled
          ? resolve()
          : reject(Error(job.canceled ? 'Export canceled.' : err || 'Native render failed.'));
      });
    });
  }
  const parts = [];
  for (let s = 0; s < cuts.length - 1; s++) {
    const start = cuts[s] / fps,
      count = cuts[s + 1] - cuts[s];
    if (count <= 0) continue;
    const active = clips
      .filter((c) => activeAt(c, start + 1e-8))
      .sort((a, b) => a.slot - b.slot || a.start - b.start);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-threads',
      '2',
      '-filter_complex_threads',
      '2',
    ];
    let input = 0;
    const image = (file) => {
      args.push('-loop', '1', '-framerate', String(fps), '-i', file);
      return input++;
    };
    const baseIndex = image(base),
      indices = [];
    for (const c of active) {
      const m = p.media.find((m) => m.id === c.mediaId);
      args.push('-ss', String(c.in + (start - c.start) * c.speed), '-threads', '2', '-i', m.path);
      const video = input++,
        a = art[c.id];
      indices.push({ c, a, video, mask: image(a.mask), shadow: image(a.shadow) });
    }
    const f = [`[${baseIndex}:v]format=rgba,setpts=PTS-STARTPTS[b0]`];
    let layer = 'b0',
      n = 0;
    for (let i = 0; i < indices.length; i++) {
      const { c, video } = indices[i];
      f.push(
        `[${video}:v]setpts=(PTS-STARTPTS)/${c.speed},fps=${fps}:start_time=0,setsar=1${i === 0 && p.background === 'blur' ? ',split=2[v0][bgsrc]' : `[v${i}]`}`,
      );
    }
    if (indices.length && p.background === 'blur') {
      const W = Math.max(2, Math.round(p.width / 4)),
        H = Math.max(2, Math.round(p.height / 4)),
        m = p.media.find((m) => m.id === indices[0].c.mediaId);
      const z = (p.backgroundZoom / 100) * (1 + (p.blur * 4) / Math.min(p.width, p.height));
      const scale = Math.max(W / m.width, H / m.height) * z;
      const w = Math.max(W, Math.ceil(m.width * scale)),
        h = Math.max(H, Math.ceil(m.height * scale));
      f.push(
        `[bgsrc]scale=${w}:${h},crop=${W}:${H},gblur=sigma=${Math.max(0.01, p.blur / 4)},scale=${p.width}:${p.height},format=rgba,colorchannelmixer=aa=${p.opacity / 100}[bg]`,
      );
      f.push(`[${layer}][bg]overlay=eof_action=pass:format=auto[b${++n}]`);
      layer = 'b' + n;
    }
    for (let i = 0; i < indices.length; i++) {
      const { a, mask, shadow } = indices[i];
      f.push(`[${mask}:v]format=gray[mask${i}]`);
      f.push(`[v${i}]scale=${a.w}:${a.h},format=rgba[scaled${i}]`);
      f.push(`[scaled${i}][mask${i}]alphamerge[rounded${i}]`);
      f.push(`[${layer}][${shadow}:v]overlay=0:0:eof_action=pass:format=auto[b${++n}]`);
      layer = 'b' + n;
      f.push(`[${layer}][rounded${i}]overlay=${a.x}:${a.y}:eof_action=pass:format=auto[b${++n}]`);
      layer = 'b' + n;
    }
    f.push(
      `[${layer}]scale=${options.width || p.width}:${options.height || p.height},format=yuv420p[out]`,
    );
    const part = path.join(dir, `part-${parts.length}.mp4`);
    parts.push(part);
    args.push(
      '-filter_complex',
      f.join(';'),
      '-map',
      '[out]',
      '-an',
      '-frames:v',
      String(count),
      '-r',
      String(fps),
      '-c:v',
      'libx264',
      '-threads',
      '4',
      '-preset',
      quality.preset,
      '-crf',
      String(quality.crf),
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      '-y',
      part,
    );
    await exec(args, cuts[s]);
    progress((cuts[s + 1] / total) * 0.99);
  }
  if (parts.length === 1) {
    await fs.rename(parts[0], temp);
    progress(1);
    return;
  }
  const list = path.join(dir, 'parts.txt');
  await fs.writeFile(list, parts.map((file) => `file '${path.basename(file)}'`).join('\n'));
  await exec([
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '1',
    '-i',
    list,
    '-c',
    'copy',
    '-an',
    '-movflags',
    '+faststart',
    '-y',
    temp,
  ]);
  progress(1);
}
module.exports = { renderNative };
