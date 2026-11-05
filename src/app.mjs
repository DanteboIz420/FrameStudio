import {
  defaults,
  uid,
  duration,
  projectDuration,
  splitClip,
  slots,
  activeAt,
  footageRect,
  validateProject,
  closeGaps,
  insertClip,
} from './model.mjs';
import { Compositor } from './compositor.mjs';
import { exportAssets } from './export-assets.mjs';
import { styleOf, validateStyle, rangeProject, validateExport } from './project-options.mjs';
import { setupExportPanel } from './export-panel.mjs';
import {
  syncCompositions,
  switchComposition,
  addComposition,
  compositionProject,
} from './compositions.mjs';
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const api = window.studio,
  compositor = new Compositor(),
  stage = $('#stage');
let p = defaults(),
  selected = null,
  time = 0,
  playing = false,
  playStart = 0,
  playTime = 0,
  zoom = 55,
  projectPath = null,
  dirty = false;
let history = [],
  future = [],
  exporting = false,
  cancelled = false,
  importing = false,
  activeTab = 'canvas',
  toastTimer,
  scrubbing = false;
let autosaveTimer,
  revision = 0,
  saving = false,
  presets = [],
  recoveries = [];
const clone = (x) => structuredClone(x),
  clip = () => p.clips.find((c) => c.id === selected),
  media = (c) => p.media.find((m) => m.id === c.mediaId);
const fmt = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 5500);
}
function mark() {
  revision++;
  scheduleAutosave();
  dirty = true;
  $('#save-state').textContent = 'UNSAVED CHANGES';
  document.title = p.name + ' • Frame Studio';
}
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => writeAutosave(), 1200);
}
async function writeAutosave() {
  if (!dirty || saving || (!p.clips.length && !p.media.length && history.length === 0)) return;
  const version = revision;
  try {
    await api.autosave({ project: clone(syncCompositions(p)), path: projectPath, time });
    if (dirty && revision === version) $('#save-state').textContent = 'AUTOSAVED · UNSAVED CHANGES';
  } catch (e) {
    $('#save-state').textContent = 'AUTOSAVE FAILED · USE SAVE PROJECT';
    toast('Autosave could not be written: ' + e.message);
  }
}
setInterval(() => {
  if (dirty && !saving) writeAutosave();
}, 10000);
document.addEventListener('pointerup', () => {
  if (dirty) {
    revision++;
    scheduleAutosave();
  }
});
function checkpoint() {
  history.push(clone(p));
  if (history.length > 80) history.shift();
  future = [];
  mark();
}
function undo(redo = false) {
  pause();
  const from = redo ? future : history,
    to = redo ? history : future;
  if (!from.length) return;
  to.push(clone(p));
  p = from.pop();
  selected = p.clips.some((c) => c.id === selected) ? selected : null;
  mark();
  render();
}
function showTab(tab) {
  activeTab = tab;
  $$('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#canvas-panel').hidden = tab !== 'canvas';
  $('#clip-panel').hidden = tab !== 'clip';
}
function select(id, tab = true) {
  selected = id;
  if (tab) showTab('clip');
  renderInspector();
  renderTimeline();
}
let exportQueue = [],
  queueRunning = false,
  nameAction = null;
function renderCompositions() {
  syncCompositions(p);
  const list = $('#composition-list');
  list.replaceChildren();
  for (const item of p.compositions) {
    const b = document.createElement('button');
    b.className = 'composition-item' + (item.id === p.activeComposition ? ' active' : '');
    b.textContent = item.name;
    b.title = item.name + ' · ' + fmt(projectDuration(compositionProject(p, item)));
    b.onclick = () => {
      if (item.id === p.activeComposition) return;
      checkpoint();
      pause();
      switchComposition(p, item.id);
      selected = null;
      time = 0;
      compositor.clear();
      render();
    };
    list.append(b);
  }
  $('#delete-composition').disabled = p.compositions.length < 2;
}
function askCompositionName(title, initial, action) {
  nameAction = action;
  $('#composition-name-title').textContent = title;
  $('#composition-name').value = initial;
  $('#confirm-composition-name').textContent = 'Save';
  $('#composition-name-dialog').showModal();
  $('#composition-name').select();
}
$('#cancel-composition-name').onclick = () => $('#composition-name-dialog').close();
$('#confirm-composition-name').onclick = () => {
  const name = $('#composition-name').value.trim();
  if (!name) return;
  $('#composition-name-dialog').close();
  checkpoint();
  pause();
  nameAction(name);
  selected = null;
  time = 0;
  compositor.clear();
  render();
};
$('#composition-name').onkeydown = (e) => {
  if (e.key === 'Enter') $('#confirm-composition-name').click();
};
$('#new-composition').onclick = () =>
  askCompositionName('New composition', `Composition ${p.compositions.length + 1}`, (name) =>
    addComposition(p, name),
  );
$('#rename-composition').onclick = () => {
  const item = p.compositions.find((c) => c.id === p.activeComposition);
  askCompositionName('Rename composition', item.name, (name) => {
    item.name = name;
  });
};
$('#duplicate-composition').onclick = () => {
  syncCompositions(p);
  const item = p.compositions.find((c) => c.id === p.activeComposition);
  askCompositionName('Duplicate composition', item.name + ' copy', (name) => {
    const copy = { ...clone(item), id: uid(), name };
    p.compositions.push(copy);
    switchComposition(p, copy.id);
  });
};
$('#delete-composition').onclick = () => {
  if (p.compositions.length < 2 || !confirm('Delete this composition? You can undo this.')) return;
  checkpoint();
  pause();
  const id = p.activeComposition;
  switchComposition(p, p.compositions.find((c) => c.id !== id).id);
  p.compositions = p.compositions.filter((c) => c.id !== id);
  selected = null;
  time = 0;
  compositor.clear();
  render();
};
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.timeline-clip');
  if (!el || exporting) return;
  e.preventDefault();
  select(el.dataset.clip);
  const menu = $('#clip-menu');
  menu.hidden = false;
  menu.style.left = Math.min(e.clientX, innerWidth - 260) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - 55) + 'px';
});
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#clip-menu')) $('#clip-menu').hidden = true;
});
$('#clip-to-composition').onclick = () => {
  $('#clip-menu').hidden = true;
  const source = clone(clip());
  if (!source) return;
  askCompositionName(
    'Create composition from clip',
    media(source).name.replace(/\.[^.]+$/, '') + ' cut',
    (name) => addComposition(p, name, source),
  );
};
function renderQueue() {
  $('#queue-count').textContent = exportQueue.length;
  $('#queue-list').replaceChildren();
  for (const [index, item] of exportQueue.entries()) {
    const row = document.createElement('div');
    row.className = 'queue-item';
    const label = document.createElement('span');
    label.textContent = `${item.project.name} · ${fmt(item.options.end - item.options.start)} · ${item.options.width} × ${item.options.height} · ${item.options.fps} fps · ${item.options.quality} — ${item.status}`;
    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.disabled = queueRunning;
    remove.onclick = () => {
      exportQueue.splice(index, 1);
      renderQueue();
    };
    row.append(label, remove);
    $('#queue-list').append(row);
  }
  $('#run-queue').disabled = queueRunning || !exportQueue.some((i) => i.status !== 'Done');
}
function queueCurrent(options) {
  syncCompositions(p);
  const item = p.compositions.find((c) => c.id === p.activeComposition);
  exportQueue.push({
    project: compositionProject(p, item),
    options: clone(options),
    status: 'Ready',
  });
  renderQueue();
  toast('Added to export queue: ' + item.name);
}
$('#show-queue').onclick = () => {
  renderQueue();
  $('#queue-status').textContent = '';
  $('#queue-dialog').showModal();
};
$('#close-queue').onclick = () => $('#queue-dialog').close();
$('#queue-all').onclick = () => {
  syncCompositions(p);
  for (const item of p.compositions) {
    const project = compositionProject(p, item);
    if (!project.clips.some((c) => c.slot < slots(project))) continue;
    exportQueue.push({ project, options: validateExport(project, {}), status: 'Ready' });
  }
  renderQueue();
};
$('#run-queue').onclick = async () => {
  const pending = exportQueue.filter((i) => i.status !== 'Done');
  try {
    const tokens = await api.queueFolder(pending.map((i) => i.project.name));
    if (!tokens) return;
    queueRunning = true;
    $('#queue-dialog').close();
    for (const [i, item] of pending.entries()) {
      item.status = 'Exporting';
      const result = await exportVideo({ ...item.options, queueToken: tokens[i] }, item.project);
      $('#export-dialog').close();
      item.status = result ? 'Done' : cancelled ? 'Canceled' : 'Failed';
      if (!result) break;
    }
    $('#queue-status').textContent =
      `${exportQueue.filter((i) => i.status === 'Done').length} completed. Finished files are kept; remaining items can be retried.`;
  } catch (e) {
    $('#queue-status').textContent = e.message;
  } finally {
    queueRunning = false;
    renderQueue();
    if (!$('#queue-dialog').open) $('#queue-dialog').showModal();
  }
};
function renderLibrary() {
  $('#media-count').textContent = p.media.length;
  $('#library-empty').hidden = !!p.media.length;
  $('#media-list').innerHTML = p.media
    .map(
      (m) =>
        `<article class="media-card" draggable="true" data-media="${m.id}" title="Drag to a timeline cell, or click + to add"><img src="${m.thumbnail}" alt="${escape(m.name)} thumbnail"><span class="media-duration">${fmt(m.duration)}</span><button data-add="${m.id}" title="Add to timeline">＋</button><h4>${escape(m.name)}</h4><small>${m.width} × ${m.height} · VIDEO</small></article>`,
    )
    .join('');
  $$('[data-add]').forEach((b) => (b.onclick = () => addClip(b.dataset.add)));
  $$('.media-card').forEach((card) => {
    card.ondragstart = (e) => {
      e.dataTransfer.setData('application/frame-media', card.dataset.media);
      e.dataTransfer.effectAllowed = 'copy';
    };
    card.ondblclick = () => addClip(card.dataset.media);
  });
}
function renderInspector() {
  $('#export-fps').value = p.fps;
  $('#fps-label').textContent = p.fps + ' FPS';
  $('#insert-mode').textContent = 'Insert: ' + (p.insertMode ? 'On' : 'Off');
  $('#insert-mode').setAttribute('aria-pressed', String(p.insertMode));
  $('#project-name').value = p.name;
  $('#canvas-width').value = p.width;
  $('#canvas-height').value = p.height;
  $$('[data-format]').forEach((b) =>
    b.classList.toggle('active', b.dataset.format === `${p.width},${p.height}`),
  );
  $$('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === p.layout));
  $$('[data-bg]').forEach((b) => b.classList.toggle('active', b.dataset.bg === p.background));
  for (const input of $$('[data-project]')) {
    const k = input.dataset.project;
    input.value = p[k];
    $(`#${k}-value`).textContent =
      p[k] + (['opacity', 'shadow', 'backgroundZoom'].includes(k) ? '%' : ' px');
  }
  $('#bg-color').value = p.color;
  $('#blur-settings').hidden = p.background !== 'blur';
  $('#layout-note').textContent =
    p.layout === 'single'
      ? 'One video, center stage.'
      : `${slots(p)} videos, playing together. One track per cell.`;
  $('#resolution-label').textContent = `${p.width} × ${p.height}`;
  $('#composition-label').textContent =
    p.width === p.height ? 'Square' : p.width > p.height ? 'Landscape' : 'Portrait';
  const c = clip();
  $('#no-clip').hidden = !!c;
  $('#clip-controls').hidden = !c;
  $('#clip-dot').textContent = c ? '•' : '';
  if (c) {
    $('#clip-name').textContent = media(c).name;
    $('#clip-speed').value = c.speed;
    $('#speed-value').textContent = c.speed + '×';
    $('#clip-scale').value = c.scale;
    $('#scale-value').textContent = Math.round(c.scale * 100) + '%';
    $('#clip-slot').innerHTML = Array.from(
      { length: Math.max(slots(p), c.slot + 1) },
      (_, i) =>
        `<option value="${i}" ${c.slot === i ? 'selected' : ''}>Cell ${i + 1}${i >= slots(p) ? ' (hidden)' : ''}</option>`,
    ).join('');
    $('#clip-x').value = Math.round(c.x * 100);
    $('#clip-y').value = Math.round(c.y * 100);
    $('#clip-in').value = c.in.toFixed(2);
    $('#clip-out').value = c.out.toFixed(2);
  }
  $('#undo').disabled = !history.length;
  $('#redo').disabled = !future.length;
  $('#split').disabled = !c;
  $('#export').disabled = !p.clips.length;
  $('#welcome').hidden = !!p.clips.length;
}
function timelineWidth() {
  return Math.max(
    $('#timeline-scroll').clientWidth,
    Math.ceil((Math.max(projectDuration(p), 10) + 3) * zoom),
  );
}
function renderTimeline() {
  const count = Math.max(slots(p), ...p.clips.map((c) => c.slot + 1));
  const total = projectDuration(p);
  $('#clip-count').textContent = p.clips.length + ' clip' + (p.clips.length === 1 ? '' : 's');
  $('#total-time').textContent = fmt(total);
  $('#timeline-content').style.width = timelineWidth() + 'px';
  $('#lane-labels').innerHTML = Array.from(
    { length: count },
    (_, i) =>
      `<div class="lane-label ${clip()?.slot === i ? 'selected' : ''}"><b>${String(i + 1).padStart(2, '0')}</b> ${count === 1 ? 'Featured video' : 'Cell ' + (i + 1)}<span>${i >= slots(p) ? 'HIDDEN' : '◌'}</span></div>`,
  ).join('');
  const step = zoom < 30 ? 5 : zoom < 80 ? 2 : 1;
  $('#ruler').innerHTML = Array.from(
    { length: Math.ceil(timelineWidth() / zoom / step) },
    (_, i) =>
      `<span class="tick" style="left:${i * step * zoom}px">${fmt(i * step).slice(0, -3)}</span>`,
  ).join('');
  $('#lanes').innerHTML = Array.from(
    { length: count },
    (_, i) =>
      `<div class="lane" data-slot="${i}">${p.clips
        .filter((c) => c.slot === i)
        .map(
          (c) =>
            `<div class="timeline-clip ${selected === c.id ? 'selected' : ''}" data-clip="${c.id}" style="left:${c.start * zoom}px;width:${duration(c) * zoom}px" title="${escape(media(c).name)} · ${c.speed}×"><span class="trim-handle left" data-edge="left"></span><img draggable="false" src="${media(c).thumbnail}" alt=""><span class="clip-label">${escape(media(c).name)}</span><small>${c.speed}×</small><span class="trim-handle right" data-edge="right"></span></div>`,
        )
        .join('')}</div>`,
  ).join('');
  $$('.timeline-clip').forEach((el) => (el.onpointerdown = (e) => startClipDrag(e, el)));
  $$('.lane').forEach((lane) => {
    lane.ondragover = (e) => {
      e.preventDefault();
      lane.classList.add('drag-over');
    };
    lane.ondragleave = () => lane.classList.remove('drag-over');
    lane.ondrop = (e) => {
      e.preventDefault();
      lane.classList.remove('drag-over');
      const id = e.dataTransfer.getData('application/frame-media');
      if (id)
        addClip(
          id,
          Number(lane.dataset.slot),
          Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / zoom),
        );
    };
    lane.onpointerdown = (e) => {
      if (e.target === lane) startScrub(e);
    };
  });
  updateTime();
}
function updateTime() {
  $('#current-time').textContent = fmt(time);
  $('#playhead').style.left = time * zoom + 'px';
  $('#play').textContent = playing ? 'Ⅱ' : '▶';
}
function render() {
  renderCompositions();
  resizeCanvas();
  time = Math.min(time, projectDuration(p));
  renderLibrary();
  renderInspector();
  renderTimeline();
  compositor.sync(p, time, playing);
}
function seek(t) {
  pause();
  time = Math.max(0, Math.min(t, projectDuration(p)));
  compositor.sync(p, time, false);
  updateTime();
}
function pause() {
  playing = false;
  compositor.sync(p, time, false);
  updateTime();
}
function play() {
  if (!p.clips.length) return;
  if (playing) return pause();
  if (time >= projectDuration(p) - 0.01) time = 0;
  playStart = performance.now();
  playTime = time;
  playing = true;
  updateTime();
}
let lastPaint = '',
  paintTicks = 0,
  lastPaintAt = 0;
function animate(now) {
  paintTicks++;
  if (!exporting) {
    if (playing) {
      time = Math.min(projectDuration(p), playTime + (now - playStart) / 1000);
      if (time >= projectDuration(p)) pause();
      updateTime();
    }
    compositor.sync(p, time, playing);
    const signature =
      JSON.stringify({ ...p, media: undefined }) +
      time +
      selected +
      [...compositor.videos.values()]
        .map((v) => `${v.readyState}:${v.currentTime}:${v.seeking}`)
        .join('|');
    if (now - lastPaintAt >= 1000 / 60 && (playing || signature !== lastPaint)) {
      compositor.draw(stage, p, time, selected);
      lastPaint = signature;
      lastPaintAt = now;
    }
    if (compositor.errors.size) {
      toast('A recording uses an unsupported codec. Use an H.264 MP4 or WebM file.');
      pause();
      compositor.errors.clear();
    }
  }
  if (!exporting) exportPanel.tick();
  requestAnimationFrame(animate);
}
function addClip(mediaId, slot, at) {
  const m = p.media.find((m) => m.id === mediaId);
  if (!m) return;
  checkpoint();
  pause();
  if (slot === undefined) {
    slot = Array.from({ length: slots(p) }, (_, i) => i).find(
      (i) => !p.clips.some((c) => c.slot === i),
    );
    slot ??= clip()?.slot ?? 0;
  }
  const start =
    at ?? Math.max(0, ...p.clips.filter((c) => c.slot === slot).map((c) => c.start + duration(c)));
  const c = {
    id: uid(),
    mediaId,
    start,
    in: 0,
    out: m.duration,
    speed: 1,
    slot,
    scale: 1,
    x: 0,
    y: 0,
  };
  p.clips.push(c);
  if (p.insertMode) insertClip(p, c.id, slot, start);
  selected = c.id;
  time = start;
  showTab('clip');
  render();
}
async function importMedia(paths) {
  if (importing || exporting) return;
  importing = true;
  $('#import').disabled = true;
  toast('Reading your recordings…');
  try {
    const result = await api.importMedia(paths);
    const good = result.filter((m) => !m.error);
    if (good.length) {
      checkpoint();
      p.media.push(...good);
      renderLibrary();
      for (const m of good) addClip(m.id);
      toast(`${good.length} recording${good.length > 1 ? 's' : ''} added.`);
    }
    const errors = result.filter((m) => m.error);
    if (errors.length) toast(errors.map((m) => m.error).join('\n'));
  } catch (e) {
    toast(e.message);
  } finally {
    importing = false;
    $('#import').disabled = false;
  }
}
function snap(value, c, e) {
  if (e.altKey) return Math.max(0, value);
  const targets = [
    0,
    time,
    ...p.clips
      .filter((x) => x.id !== c.id && x.slot === c.slot)
      .flatMap((x) => [x.start, x.start + duration(x)]),
  ];
  for (const target of targets) {
    if (Math.abs(target - value) * zoom < 8) return target;
    if (Math.abs(target - value - duration(c)) * zoom < 8) return Math.max(0, target - duration(c));
  }
  return Math.max(0, value);
}
function startClipDrag(e, el) {
  if (e.button !== 0 || exporting) return;
  e.preventDefault();
  pause();
  const c = p.clips.find((c) => c.id === el.dataset.clip);
  select(c.id);
  const origin = { ...c },
    x = e.clientX,
    y = e.clientY,
    edge = e.target.dataset.edge;
  const originals = new Map(p.clips.map((c) => [c.id, { ...c }]));
  let moved = false;
  function move(ev) {
    if (!moved && Math.abs(ev.clientX - x) + Math.abs(ev.clientY - y) < 3) return;
    if (!moved) {
      checkpoint();
      moved = true;
    }
    if (p.insertMode && !edge)
      for (const other of p.clips) Object.assign(other, originals.get(other.id));
    const delta = (ev.clientX - x) / zoom;
    if (edge === 'left') {
      const d = Math.max(-origin.in / origin.speed, Math.min(delta, duration(origin) - 1 / 60));
      c.start = Math.max(0, origin.start + d);
      c.in = origin.in + (c.start - origin.start) * origin.speed;
    } else if (edge === 'right')
      c.out = Math.max(
        c.in + c.speed / 60,
        Math.min(media(c).duration, origin.out + delta * c.speed),
      );
    else {
      c.start = snap(origin.start + delta, c, ev);
      const lane = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.lane');
      if (lane) c.slot = Number(lane.dataset.slot);
      if (p.insertMode) insertClip(p, c.id, c.slot, c.start);
    }
    renderTimeline();
    renderInspector();
  }
  function stop() {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', stop);
    render();
  }
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', stop, { once: true });
}
function startScrub(e) {
  if (exporting || e.button !== 0) return;
  e.preventDefault();
  scrubbing = true;
  const set = (ev) => {
    const r = $('#ruler').getBoundingClientRect();
    seek((ev.clientX - r.left) / zoom);
  };
  set(e);
  document.addEventListener('pointermove', set);
  document.addEventListener(
    'pointerup',
    () => {
      scrubbing = false;
      document.removeEventListener('pointermove', set);
    },
    { once: true },
  );
}
$('#ruler').onpointerdown = startScrub;
function changeSpeed(value, record = true) {
  const c = clip();
  if (!c) return;
  if (record) checkpoint();
  const oldEnd = c.start + duration(c);
  c.speed = value;
  const delta = c.start + duration(c) - oldEnd;
  for (const other of p.clips)
    if (other.id !== c.id && other.slot === c.slot && other.start >= oldEnd - 0.001)
      other.start = Math.max(0, other.start + delta);
  pause();
  renderInspector();
  renderTimeline();
}
function split() {
  const c = clip();
  if (!c) return;
  if (time <= c.start + 1 / 60 || time >= c.start + duration(c) - 1 / 60) {
    toast('Place the playhead inside the selected clip to split.');
    return;
  }
  checkpoint();
  pause();
  const next = splitClip(p, c.id, time);
  selected = next.id;
  render();
  toast('Split. Drag either piece to move it.');
}
function deleteClip() {
  if (!clip()) return;
  checkpoint();
  pause();
  p.clips = p.clips.filter((c) => c.id !== selected);
  selected = null;
  render();
}
async function save(as = false) {
  clearTimeout(autosaveTimer);
  saving = true;
  try {
    pause();
    p.name = $('#project-name').value.trim() || 'Untitled project';
    const snapshot = clone(syncCompositions(p)),
      version = revision,
      file = await api.save(snapshot, as ? null : projectPath);
    if (file) {
      projectPath = file;
      if (JSON.stringify(snapshot) === JSON.stringify(p)) {
        dirty = false;
        await api.clearRecovery();
        $('#save-state').textContent = 'PROJECT SAVED';
      } else scheduleAutosave();
      toast('Project saved. Original videos stay in their folders.');
      return true;
    }
    return false;
  } catch (e) {
    toast('Could not save: ' + e.message);
    return false;
  } finally {
    saving = false;
    if (dirty) scheduleAutosave();
  }
}
async function discardOkay() {
  if (!dirty) return true;
  return confirm(
    'This project has unsaved changes. Discard them? Use Save project first to keep your edits.',
  );
}
async function openProject() {
  pause();
  if (!(await discardOkay())) return;
  try {
    const loaded = await api.open();
    if (!loaded) return;
    clearTimeout(autosaveTimer);
    await api.clearRecovery();
    compositor.clear();
    p = loaded.project;
    projectPath = loaded.path;
    selected = null;
    time = 0;
    history = [];
    future = [];
    dirty = false;
    $('#save-state').textContent = 'PROJECT SAVED';
    render();
  } catch (e) {
    toast(e.message);
  }
}
let exportBegan = 0;
api.onExportProgress((value) => {
  $('#export-progress').value = value;
  $('#export-percent').textContent = Math.floor(value * 100) + '%';
  const elapsed = (performance.now() - exportBegan) / 1000;
  $('#export-eta').textContent =
    value > 0.015 && value < 0.99
      ? 'About ' + fmt((elapsed / value) * (1 - value)).slice(0, -3) + ' remaining'
      : value >= 0.99
        ? 'Finalizing MP4…'
        : 'Starting native renderer…';
});
async function exportVideo(options, source = p) {
  if (exporting || !source.clips.length) return false;
  pause();
  if (!source.clips.some((c) => c.slot < slots(source))) {
    toast('Move a clip into a visible cell before exporting.');
    return;
  }
  try {
    validateProject(source);
    options = validateExport(source, options);
    exporting = true;
    cancelled = false;
    document.body.classList.add('exporting');
    $('#export-dialog').showModal();
    $('#export-title').textContent = 'Making it share-worthy.';
    $('#export-description').textContent = queueRunning
      ? 'Exporting ' + source.name + ' from the queue.'
      : 'Rendering directly with the native video engine.';
    $('#export-size').textContent = options.width + ' × ' + options.height;
    $('#export-fps-label').textContent = options.fps + ' FPS';
    $('#export-progress').value = 0;
    $('#export-percent').textContent = '0%';
    $('#export-eta').textContent = 'Preparing composition…';
    $('#cancel-export').hidden = false;
    $('#cancel-export').disabled = false;
    $('#reveal-export').hidden = true;
    $('#close-export').hidden = true;
    const assets = await exportAssets(rangeProject(source, options.start, options.end));
    if (cancelled) {
      $('#export-dialog').close();
      return;
    }
    exportBegan = performance.now();
    const file = await api.exportNative(clone(source), assets, options);
    if (!file) {
      $('#export-dialog').close();
      return;
    }
    $('#export-title').textContent = 'Ready for the feed.';
    $('#export-description').textContent = 'Your video is exported. Go show them what you made.';
    $('#export-progress').value = 1;
    $('#export-percent').textContent = '100%';
    $('#export-eta').textContent = 'Export complete';
    $('#cancel-export').hidden = true;
    $('#reveal-export').hidden = false;
    $('#close-export').hidden = false;
    toast('Export complete: ' + file);
    return true;
  } catch (e) {
    $('#export-dialog').close();
    toast(cancelled ? 'Export canceled.' : 'Export failed: ' + e.message);
    return false;
  } finally {
    exporting = false;
    document.body.classList.remove('exporting');
    lastPaint = '';
    compositor.sync(p, time, false);
  }
}
function cancelExport() {
  cancelled = true;
  $('#cancel-export').disabled = true;
  $('#export-eta').textContent = 'Canceling…';
  api.exportCancel();
}
$('#cancel-export').onclick = cancelExport;
$('#export-dialog').addEventListener('cancel', (e) => {
  if (exporting) {
    e.preventDefault();
    cancelExport();
  }
});
$('#close-export').onclick = () => $('#export-dialog').close();
$('#reveal-export').onclick = () => api.revealExport();
$('#import').onclick = () => importMedia();
$('#welcome-import').onclick = () => importMedia();
$('#play').onclick = play;
$('#go-start').onclick = () => seek(0);
$('#split').onclick = split;
$('#delete-clip').onclick = deleteClip;
$('#undo').onclick = () => undo();
$('#redo').onclick = () => undo(true);
$('#save-project').onclick = () => save();
$('#open-project').onclick = openProject;
$('#export').onclick = () => exportPanel.open();
$('#new-project').onclick = async () => {
  pause();
  if (!(await discardOkay())) return;
  clearTimeout(autosaveTimer);
  await api.clearRecovery();
  compositor.clear();
  p = defaults();
  selected = null;
  time = 0;
  history = [];
  future = [];
  projectPath = null;
  dirty = false;
  $('#save-state').textContent = 'LOCAL PROJECT';
  render();
  showTab('canvas');
};
$('#demo').onclick = async () => {
  if (importing) return;
  importing = true;
  try {
    toast('Opening sample project…');
    const items = await api.demo();
    checkpoint();
    compositor.clear();
    p = {
      ...defaults(),
      name: 'A few good things',
      layout: 'four',
      padding: 90,
      gap: 28,
      media: items,
    };
    for (let i = 0; i < 4; i++)
      p.clips.push({
        id: uid(),
        mediaId: items[i % 3].id,
        start: 0,
        in: 0,
        out: items[i % 3].duration,
        speed: 1,
        slot: i,
        scale: 1,
        x: 0,
        y: 0,
      });
    selected = null;
    time = 1;
    projectPath = null;
    showTab('canvas');
    render();
    toast('Sample project. Add your recordings to make it yours.');
  } catch (e) {
    toast(e.message);
  } finally {
    importing = false;
  }
};
$('#project-name').onchange = () => {
  checkpoint();
  p.name = $('#project-name').value.trim() || 'Untitled project';
  renderInspector();
};
$$('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$$('[data-format]').forEach(
  (b) =>
    (b.onclick = () => {
      checkpoint();
      [p.width, p.height] = b.dataset.format.split(',').map(Number);
      resizeCanvas();
      renderInspector();
    }),
);
function resizeCanvas() {
  const scale = Math.min(1, 1100 / p.width, 720 / p.height),
    w = Math.round(p.width * scale),
    h = Math.round(p.height * scale);
  if (stage.width !== w || stage.height !== h) {
    stage.width = w;
    stage.height = h;
  }
}
for (const id of ['canvas-width', 'canvas-height'])
  $('#' + id).onchange = () => {
    const w = Number($('#canvas-width').value),
      h = Number($('#canvas-height').value);
    if (w < 320 || h < 320 || w > 3840 || h > 3840 || w % 2 || h % 2) {
      toast('Use even dimensions between 320 and 3840 pixels.');
      renderInspector();
      return;
    }
    checkpoint();
    p.width = w;
    p.height = h;
    resizeCanvas();
    renderInspector();
  };
$$('[data-layout]').forEach(
  (b) =>
    (b.onclick = () => {
      checkpoint();
      pause();
      p.layout = b.dataset.layout;
      renderInspector();
      renderTimeline();
      if (p.clips.some((c) => c.slot >= slots(p)))
        toast(
          'Clips in extra cells are kept on hidden tracks. Change the layout to show them again.',
        );
    }),
);
$$('[data-bg]').forEach(
  (b) =>
    (b.onclick = () => {
      checkpoint();
      p.background = b.dataset.bg;
      renderInspector();
    }),
);
$$('[data-project]').forEach((input) => {
  input.onpointerdown = () => checkpoint();
  input.onkeydown = (e) => {
    if (e.key.startsWith('Arrow')) checkpoint();
  };
  input.oninput = () => {
    p[input.dataset.project] = Number(input.value);
    mark();
    renderInspector();
  };
});
$('#bg-color').onchange = () => {
  checkpoint();
  p.color = $('#bg-color').value;
};
$('#clip-speed').onpointerdown = () => checkpoint();
$('#clip-speed').oninput = () => changeSpeed(Number($('#clip-speed').value), false);
$('#clip-speed').onkeydown = (e) => {
  if (e.key.startsWith('Arrow')) checkpoint();
};
$$('[data-speed]').forEach((b) => (b.onclick = () => changeSpeed(Number(b.dataset.speed))));
$('#clip-scale').onpointerdown = () => checkpoint();
$('#clip-scale').onkeydown = (e) => {
  if (e.key.startsWith('Arrow')) checkpoint();
};
$('#clip-scale').oninput = () => {
  const c = clip();
  if (c) {
    c.scale = Number($('#clip-scale').value);
    mark();
    renderInspector();
  }
};
$('#clip-slot').onchange = () => {
  if (clip()) {
    checkpoint();
    clip().slot = Number($('#clip-slot').value);
    render();
  }
};
for (const axis of ['x', 'y'])
  $('#clip-' + axis).onchange = () => {
    const c = clip();
    if (c) {
      checkpoint();
      c[axis] = Math.max(-1, Math.min(1, Number($('#clip-' + axis).value) / 100 || 0));
      renderInspector();
    }
  };
$('#reset-position').onclick = () => {
  if (clip()) {
    checkpoint();
    Object.assign(clip(), { x: 0, y: 0, scale: 1 });
    renderInspector();
  }
};
for (const edge of ['in', 'out'])
  $('#clip-' + edge).onchange = () => {
    const c = clip();
    if (!c) return;
    const v = Number($('#clip-' + edge).value);
    if (
      !Number.isFinite(v) ||
      v < 0 ||
      v > media(c).duration ||
      (edge === 'in' ? v >= c.out - 0.01 : v <= c.in + 0.01)
    ) {
      toast('Trim points must stay inside the source recording.');
      renderInspector();
      return;
    }
    checkpoint();
    c[edge] = v;
    render();
  };
$('#duplicate').onclick = () => {
  const c = clip();
  if (!c) return;
  checkpoint();
  const next = { ...c, id: uid(), start: c.start + duration(c) };
  p.clips.push(next);
  selected = next.id;
  render();
};
$('#ripple').onclick = () => {
  checkpoint();
  pause();
  closeGaps(p);
  render();
  toast('All clips snapped together, track by track.');
};
$('#insert-mode').onclick = () => {
  checkpoint();
  p.insertMode = !p.insertMode;
  renderInspector();
};
$('#export-fps').onchange = () => {
  checkpoint();
  p.fps = Number($('#export-fps').value);
  renderInspector();
};
$('#timeline-zoom').oninput = () => {
  zoom = Number($('#timeline-zoom').value);
  renderTimeline();
};
$('#shortcuts').onclick = () => $('#shortcut-dialog').showModal();
$('#close-shortcuts').onclick = () => $('#shortcut-dialog').close();
stage.onpointerdown = (e) => {
  if (exporting || e.button !== 0) return;
  pause();
  const r = stage.getBoundingClientRect(),
    x = ((e.clientX - r.left) / r.width) * p.width,
    y = ((e.clientY - r.top) / r.height) * p.height;
  const c = [...p.clips].reverse().find((c) => {
    if (c.slot >= slots(p) || !activeAt(c, time)) return false;
    const b = footageRect(p, c, media(c));
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  });
  if (!c) {
    select(null, false);
    return;
  }
  select(c.id);
  const origin = { x: c.x, y: c.y },
    sx = e.clientX,
    sy = e.clientY;
  let moved = false;
  const move = (ev) => {
    if (!moved) {
      checkpoint();
      moved = true;
    }
    c.x = Math.max(-1, Math.min(1, origin.x + (ev.clientX - sx) / r.width));
    c.y = Math.max(-1, Math.min(1, origin.y + (ev.clientY - sy) / r.height));
    renderInspector();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', () => document.removeEventListener('pointermove', move), {
    once: true,
  });
};
document.addEventListener('keydown', (e) => {
  if (exporting) return;
  const input = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.code === 'KeyS') {
    e.preventDefault();
    if (e.shiftKey && !input) split();
    else save(e.altKey);
    return;
  }
  if (mod && e.code === 'KeyO') {
    e.preventDefault();
    openProject();
    return;
  }
  if (input || document.querySelector('dialog[open]')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    play();
  } else if (mod && e.shiftKey && e.code === 'KeyC') {
    e.preventDefault();
    split();
  } else if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    undo(e.shiftKey);
  } else if (mod && e.code === 'KeyI') {
    e.preventDefault();
    importMedia();
  } else if (e.code === 'Delete' || e.code === 'Backspace') {
    e.preventDefault();
    deleteClip();
  } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    e.preventDefault();
    seek(time + (e.code === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / p.fps));
  } else if (e.code === 'Home') seek(0);
  else if (e.code === 'End') seek(projectDuration(p));
});
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
  if (e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    dragCounter++;
    document.body.classList.add('dragging-file');
  }
});
document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter <= 0) document.body.classList.remove('dragging-file');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('dragging-file');
  if (e.dataTransfer.files.length) {
    const paths = [...e.dataTransfer.files].map((f) => api.droppedPath(f)).filter(Boolean);
    if (paths.length) importMedia(paths);
  }
});
api.onClose(async () => {
  if (exporting) {
    toast('Cancel the export before closing Frame Studio.');
    return;
  }
  pause();
  if (await discardOkay()) {
    clearTimeout(autosaveTimer);
    await api.clearRecovery();
    api.close();
  }
});
const exportPanel = setupExportPanel({
  project: () => p,
  selected: clip,
  seek,
  currentTime: () => time,
  pause,
  play,
  onExport: exportVideo,
  onQueue: queueCurrent,
  compositor,
});
function renderPresets(selectedId = '') {
  $('#style-list').replaceChildren(
    new Option('Choose a saved style…', ''),
    ...presets.map((s) => new Option(s.name, s.id)),
  );
  $('#style-list').value = selectedId;
  $('#apply-style').disabled = !selectedId;
  $('#delete-style').disabled = !selectedId;
}
$('#style-list').onchange = () => {
  $('#apply-style').disabled = !$('#style-list').value;
  $('#delete-style').disabled = !$('#style-list').value;
};
$('#save-style').onclick = () => {
  $('#style-name').value = '';
  $('#save-style-dialog').showModal();
  $('#style-name').focus();
};
$('#cancel-save-style').onclick = () => $('#save-style-dialog').close();
$('#confirm-save-style').onclick = async () => {
  const name = $('#style-name').value.trim();
  if (!name) {
    $('#style-name').focus();
    return;
  }
  const old = presets.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (old && !confirm('Replace the saved style “' + old.name + '”?')) return;
  try {
    const item = await api.savePreset(name, styleOf(p), old?.id);
    presets = await api.listPresets();
    renderPresets(item.id);
    $('#save-style-dialog').close();
    toast('Style saved. Ready for your next recording.');
  } catch (e) {
    toast(e.message);
  }
};
$('#style-name').onkeydown = (e) => {
  if (e.key === 'Enter') $('#confirm-save-style').click();
};
$('#apply-style').onclick = () => {
  const item = presets.find((s) => s.id === $('#style-list').value);
  if (!item) return;
  try {
    const style = validateStyle(item.style);
    checkpoint();
    pause();
    Object.assign(p, style);
    render();
    toast('Applied ' + item.name + '. Your footage and cuts are preserved.');
  } catch (e) {
    toast(e.message);
  }
};
$('#delete-style').onclick = async () => {
  const id = $('#style-list').value,
    item = presets.find((s) => s.id === id);
  if (!item || !confirm('Delete the saved style “' + item.name + '”?')) return;
  try {
    await api.deletePreset(id);
    presets = await api.listPresets();
    renderPresets();
  } catch (e) {
    toast(e.message);
  }
};
function renderRecoveries() {
  const list = $('#recovery-list');
  list.replaceChildren();
  for (let i = 0; i < recoveries.length; i++) {
    const r = recoveries[i],
      label = document.createElement('label'),
      radio = document.createElement('input'),
      body = document.createElement('span'),
      name = document.createElement('b'),
      detail = document.createElement('small');
    label.className = 'recovery-item';
    radio.type = 'radio';
    radio.name = 'recovery';
    radio.value = r.id;
    radio.checked = i === 0;
    name.textContent = r.name;
    detail.textContent = new Date(r.savedAt).toLocaleString() + ' · ' + r.clips + ' clips';
    body.append(name, detail);
    label.append(radio, body);
    list.append(label);
  }
  $('#restore-recovery').disabled = !recoveries.length;
  $('#discard-recovery').disabled = !recoveries.length;
  $('#recover-project').hidden = !recoveries.length;
  $('#recover-project').textContent = 'Recover a session (' + recoveries.length + ')';
}
async function loadRecoveries(show = false) {
  recoveries = await api.listRecovery();
  renderRecoveries();
  if (show && recoveries.length) $('#recovery-dialog').showModal();
}
$('#recover-project').onclick = () => {
  renderRecoveries();
  $('#recovery-dialog').showModal();
};
$('#later-recovery').onclick = () => $('#recovery-dialog').close();
$('#restore-recovery').onclick = async () => {
  const id = $('input[name="recovery"]:checked')?.value;
  if (!id || !(await discardOkay())) return;
  $('#restore-recovery').disabled = true;
  try {
    const record = await api.restoreRecovery(id);
    clearTimeout(autosaveTimer);
    compositor.clear();
    p = record.project;
    projectPath = record.path;
    time = Math.min(record.time || 0, projectDuration(p));
    selected = null;
    history = [];
    future = [];
    dirty = true;
    revision++;
    render();
    await api.autosave({ project: clone(p), path: projectPath, time });
    await api.discardRecovery(id);
    $('#recovery-dialog').close();
    await loadRecoveries();
    $('#save-state').textContent = 'RECOVERED · UNSAVED CHANGES';
    toast('Session recovered. Save project to keep it as a .frame file.');
  } catch (e) {
    toast(e.message);
  } finally {
    $('#restore-recovery').disabled = false;
  }
};
$('#discard-recovery').onclick = async () => {
  const id = $('input[name="recovery"]:checked')?.value;
  if (!id || !confirm('Permanently discard this autosaved recovery?')) return;
  try {
    await api.discardRecovery(id);
    await loadRecoveries();
    if (!recoveries.length) $('#recovery-dialog').close();
  } catch (e) {
    toast(e.message);
  }
};
async function boot() {
  try {
    presets = await api.listPresets();
    renderPresets();
    await loadRecoveries(true);
  } catch (e) {
    toast('Local settings could not be loaded: ' + e.message);
  }
}
new ResizeObserver(() => {
  if (!scrubbing) renderTimeline();
}).observe($('#timeline-scroll'));
render();
requestAnimationFrame(animate);
boot();
// A narrow read-only diagnostic surface for the local smoke tests.
window.frameDiagnostics = () => ({
  project: clone(p),
  time,
  selected,
  playing,
  exporting,
  dirty,
  paintTicks,
  decoded: [...compositor.videos.entries()].map(([id, v]) => ({
    id,
    active: p.clips.some((c) => compositor.key(c) === id && activeAt(c, time)),
    ready: v.readyState,
    time: v.currentTime,
    duration: v.duration,
    seeking: v.seeking,
    error: v.error?.message,
  })),
});
