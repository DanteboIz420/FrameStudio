const { app, BrowserWindow, ipcMain, dialog, shell, protocol, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { existsSync, createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
let win,
  encoder,
  exportJob,
  lastExport,
  allowClose = false;
const allowed = new Map();
let storage;
if (process.env.FRAME_TEST_DATA) {
  require('node:fs').mkdirSync(process.env.FRAME_TEST_DATA, { recursive: true });
  app.setPath('userData', process.env.FRAME_TEST_DATA);
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'frame-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
function engine(name) {
  const exe = name + (process.platform === 'win32' ? '.exe' : '');
  const { FOLDER } = require('./engine-setup.cjs');
  const dirs = [
    process.env.FRAME_FFMPEG_DIR,
    path.join(app.getPath('userData'), 'video-engine', FOLDER, 'bin'),
    path.join(process.resourcesPath, 'engine'),
    path.join(__dirname, 'engine', FOLDER, 'bin'),
    path.join(__dirname, 'engine'),
  ].filter(Boolean);
  for (const dir of dirs) if (existsSync(path.join(dir, exe))) return path.join(dir, exe);
  return name;
}
function run(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(engine(name), args, { windowsHide: true });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-6000)));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(Error(err || `${name} exited with ${code}`)),
    );
  });
}
function authorize(file) {
  const key = randomUUID();
  allowed.set(key, file);
  return `frame-media://local/${key}`;
}
async function inspect(file) {
  const info = JSON.parse(
    await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]),
  );
  const v = info.streams.find((s) => s.codec_type === 'video');
  const duration = Number(info.format.duration || v?.duration);
  if (!v || !Number.isFinite(duration) || duration <= 0)
    throw Error('No playable video was found in ' + path.basename(file));
  const rotation =
    Math.abs(Number(v.tags?.rotate || v.side_data_list?.find((s) => s.rotation)?.rotation || 0)) %
      180 ===
    90;
  const thumb = path.join(app.getPath('temp'), `frame-${randomUUID()}.jpg`);
  await run('ffmpeg', [
    '-v',
    'error',
    '-ss',
    String(Math.min(0.5, duration / 2)),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    'scale=480:-2',
    '-y',
    thumb,
  ]);
  const thumbnail = 'data:image/jpeg;base64,' + (await fs.readFile(thumb)).toString('base64');
  await fs.unlink(thumb).catch(() => {});
  return {
    id: randomUUID(),
    path: file,
    name: path.basename(file),
    duration,
    width: rotation ? v.height : v.width,
    height: rotation ? v.width : v.height,
    url: authorize(file),
    thumbnail,
  };
}
function handle(name, fn) {
  ipcMain.handle(name, async (e, ...args) => {
    if (e.sender !== win.webContents) throw Error('Unknown sender');
    return fn(...args);
  });
}
app.whenReady().then(async () => {
  storage = require('./storage.cjs').createStorage(app.getPath('userData'));
  protocol.handle('frame-media', async (request) => {
    const file = allowed.get(new URL(request.url).pathname.slice(1));
    if (!file) return new Response('Not found', { status: 404 });
    const { size } = await fs.stat(file);
    const range = request.headers.get('range');
    let start = 0,
      end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match)
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      } else if (match[2]) start = Math.max(0, size - Number(match[2]));
      if (start > end || start >= size)
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const types = {
      '.mp4': 'video/mp4',
      '.m4v': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
    };
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': String(end - start + 1),
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(
      request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file, { start, end })),
      { status: range ? 206 : 200, headers },
    );
  });
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1540, workArea.width - 24),
    height: Math.min(1000, workArea.height - 24),
    minWidth: Math.min(1100, workArea.width - 24),
    minHeight: Math.min(700, workArea.height - 24),
    backgroundColor: '#161719',
    title: 'Frame Studio',
    icon: path.join(__dirname, 'assets/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault();
      win.webContents.send('request-close');
    }
  });
  win.loadFile(path.join(__dirname, 'src/index.html'));
  handle('close-confirmed', () => {
    allowClose = true;
    win.close();
  });
  handle('import', async (paths) => {
    if (!paths) {
      const d = await dialog.showOpenDialog(win, {
        title: 'Add your recordings',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv'] }],
      });
      if (d.canceled) return [];
      paths = d.filePaths;
    }
    const result = [];
    for (let i = 0; i < paths.length; i += 3) {
      result.push(
        ...(await Promise.all(
          paths.slice(i, i + 3).map(async (file) => {
            try {
              return await inspect(file);
            } catch (e) {
              return { error: path.basename(file) + ': ' + e.message };
            }
          }),
        )),
      );
    }
    return result;
  });
  handle('demo', async () => {
    const dir = app.isPackaged
      ? path.join(process.resourcesPath, 'samples')
      : path.join(__dirname, 'assets');
    return Promise.all(
      ['orbit', 'forma', 'aura'].map(async (name) => {
        const file = path.join(dir, name + '.mp4');
        return {
          id: randomUUID(),
          path: file,
          name: name + '.mp4',
          duration: 4,
          width: 1280,
          height: 800,
          url: authorize(file),
          thumbnail:
            'data:image/png;base64,' +
            (await fs.readFile(path.join(__dirname, 'assets', name + '.png'))).toString('base64'),
        };
      }),
    );
  });
  handle('save', async (project, currentPath) => {
    const { validateProject } = await import('./src/model.mjs');
    validateProject(project);
    let dest = currentPath;
    if (!dest) {
      const d = await dialog.showSaveDialog(win, {
        defaultPath: project.name + '.frame',
        filters: [{ name: 'Frame Studio project', extensions: ['frame'] }],
      });
      if (d.canceled) return null;
      dest = d.filePath;
    }
    const clean = { ...project, media: project.media.map(({ url, thumbnail, ...m }) => m) };
    const temp = dest + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(clean, null, 2));
    await fs.rename(temp, dest);
    return dest;
  });
  handle('open', async () => {
    const d = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Frame Studio project', extensions: ['frame'] }],
    });
    if (d.canceled) return null;
    const { validateProject } = await import('./src/model.mjs');
    const p = validateProject(JSON.parse(await fs.readFile(d.filePaths[0], 'utf8')));
    for (const m of p.media) {
      if (!existsSync(m.path)) {
        const r = await dialog.showOpenDialog(win, {
          title: 'Locate missing recording: ' + m.name,
          properties: ['openFile'],
        });
        if (r.canceled) throw Error('Opening canceled: recording is missing.');
        m.path = r.filePaths[0];
      }
    }
    for (let i = 0; i < p.media.length; i += 3)
      await Promise.all(
        p.media.slice(i, i + 3).map(async (m) => {
          const checked = await inspect(m.path);
          if (checked.duration + 0.05 < m.duration)
            throw Error(m.name + ' is shorter than the recording used by this project.');
          Object.assign(m, {
            url: checked.url,
            thumbnail: checked.thumbnail,
            width: checked.width,
            height: checked.height,
          });
        }),
      );
    return { project: p, path: d.filePaths[0] };
  });
  handle('autosave', async (record) => {
    const { validateProject } = await import('./src/model.mjs');
    validateProject(record.project);
    const project = { ...record.project, media: record.project.media.map(({ url, ...m }) => m) };
    await storage.autosave({ project, path: record.path || null, time: Number(record.time) || 0 });
    return true;
  });
  handle('recovery-clear', () => storage.clear());
  handle('recovery-list', async () =>
    (await storage.recoveries()).map((r) => ({
      id: r.id,
      name: r.project.name,
      savedAt: r.savedAt,
      clips: r.project.clips.length,
    })),
  );
  handle('recovery-discard', (id) => storage.discard(id));
  handle('recovery-restore', async (id) => {
    const record = await storage.recovery(id),
      { validateProject } = await import('./src/model.mjs'),
      p = validateProject(record.project);
    for (const m of p.media) {
      if (!existsSync(m.path)) {
        const d = await dialog.showOpenDialog(win, {
          title: 'Locate missing recording: ' + m.name,
          properties: ['openFile'],
        });
        if (d.canceled) throw Error('Recovery canceled. Your saved recovery is still available.');
        const checked = await inspect(d.filePaths[0]);
        if (checked.duration + 0.05 < m.duration)
          throw Error('The replacement recording is too short.');
        Object.assign(m, {
          path: checked.path,
          width: checked.width,
          height: checked.height,
          thumbnail: checked.thumbnail,
          url: checked.url,
        });
      } else m.url = authorize(m.path);
    }
    return { ...record, project: p };
  });
  handle('presets-list', () => storage.presets());
  handle('preset-save', async (name, style, id) => {
    const { validateStyle } = await import('./src/project-options.mjs');
    return storage.savePreset(name, validateStyle(style), id);
  });
  handle('preset-delete', (id) => storage.deletePreset(id));
  const queueTargets = new Map();
  handle('queue-folder', async (names) => {
    if (
      !Array.isArray(names) ||
      !names.length ||
      names.length > 200 ||
      names.some((n) => typeof n !== 'string')
    )
      throw Error('Invalid queue.');
    const choice = await dialog.showOpenDialog(win, {
      title: 'Choose export folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (choice.canceled) return null;
    queueTargets.clear();
    const tokens = [];
    for (let i = 0; i < names.length; i++) {
      const safe =
        names[i]
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
          .replace(/[. ]+$/g, '')
          .slice(0, 80) || 'Composition';
      const token = randomUUID();
      let target = path.join(choice.filePaths[0], `${String(i + 1).padStart(2, '0')}-${safe}.mp4`);
      if (
        await fs.stat(target).then(
          () => true,
          () => false,
        )
      )
        target = target.slice(0, -4) + '-' + token.slice(0, 8) + '.mp4';
      queueTargets.set(token, target);
      tokens.push(token);
    }
    return tokens;
  });
  handle('export-native', async (project, assets, rawOptions) => {
    if (exportJob) throw Error('An export is already running.');
    const { validateProject } = await import('./src/model.mjs');
    const original = validateProject(project),
      { validateExport, rangeProject } = await import('./src/project-options.mjs'),
      options = validateExport(original, rawOptions),
      p = { ...rangeProject(original, options.start, options.end), fps: options.fps };
    const authorized = new Set(allowed.values());
    for (const m of p.media)
      if (!authorized.has(m.path)) throw Error('Open the recording before exporting.');
    const queuedPath = rawOptions?.queueToken ? queueTargets.get(rawOptions.queueToken) : null;
    if (rawOptions?.queueToken && !queuedPath) throw Error('Choose the queue export folder again.');
    if (queuedPath) queueTargets.delete(rawOptions.queueToken);
    const d = queuedPath
      ? { filePath: queuedPath, canceled: false }
      : await dialog.showSaveDialog(win, {
          title: 'Export muted MP4 · ' + p.fps + ' fps',
          defaultPath: p.name + '.mp4',
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        });
    if (d.canceled) return null;
    if (
      p.media.some(
        (m) => path.resolve(m.path).toLowerCase() === path.resolve(d.filePath).toLowerCase(),
      )
    )
      throw Error('Choose a different filename from your recording.');
    const temp = d.filePath + '.' + randomUUID() + '.part.mp4',
      dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'frame-render-'));
    const job = { temp, dir, canceled: false, proc: null };
    exportJob = job;
    try {
      const { renderNative } = require('./native-render.cjs');
      await renderNative({
        project: p,
        options: { ...options, duration: options.end - options.start },
        assets,
        dir,
        temp,
        engine,
        job,
        progress: (value) => {
          if (!win.isDestroyed()) win.webContents.send('export-progress', value);
        },
      });
      if (job.canceled) throw Error('Export canceled.');
      await fs.rename(temp, d.filePath);
      lastExport = d.filePath;
      return d.filePath;
    } finally {
      exportJob = null;
      await fs.rm(dir, { recursive: true, force: true });
      await fs.unlink(temp).catch(() => {});
    }
  });
  handle('export-cancel', () => {
    if (exportJob) {
      exportJob.canceled = true;
      exportJob.proc?.kill();
    }
  });
  handle('reveal-export', () => {
    if (lastExport) shell.showItemInFolder(lastExport);
  });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  exportJob?.proc?.kill();
  encoder?.kill();
  if (exportJob) require('node:fs').unlink(exportJob.temp, () => {});
});
