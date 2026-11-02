import { projectDuration, duration, slots } from './model.mjs';
import { validateExport } from './project-options.mjs';
const $ = (s) => document.querySelector(s),
  fmt = (t) =>
    `${Math.floor(t / 60)
      .toString()
      .padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
export function setupExportPanel({
  project,
  selected,
  seek,
  currentTime,
  pause,
  play,
  onExport,
  compositor,
}) {
  const dialog = $('#export-settings');
  let range = { start: 0, end: 0 },
    returnTime = 0,
    rangePlaying = false;
  const total = () => projectDuration(project());
  function outputSize() {
    const p = project(),
      value = $('#output-resolution').value;
    if (value === 'canvas') return { width: p.width, height: p.height };
    const scale = Math.min(
      Number(value) / Math.min(p.width, p.height),
      3840 / Math.max(p.width, p.height),
    );
    return {
      width: Math.max(320, Math.round((p.width * scale) / 2) * 2),
      height: Math.max(320, Math.round((p.height * scale) / 2) * 2),
    };
  }
  function options() {
    return validateExport(project(), {
      ...range,
      fps: Number($('#output-fps').value),
      quality: $('#output-quality').value,
      ...outputSize(),
    });
  }
  function render() {
    const t = total(),
      a = (range.start / t) * 100,
      b = (range.end / t) * 100;
    $('#range-start').value = Number(range.start.toFixed(3));
    $('#range-end').value = Number(range.end.toFixed(3));
    $('#range-start').max = t;
    $('#range-end').max = t;
    $('#range-selection').style.left = a + '%';
    $('#range-selection').style.width = b - a + '%';
    $('#range-shade-left').style.width = a + '%';
    $('#range-shade-right').style.width = 100 - b + '%';
    $('#range-summary').textContent = fmt(range.end - range.start) + ' selected';
    const help = {
      draft: 'A quick check before the final export. Softer detail and stronger compression.',
      high: 'A clean balance of crisp detail, file size and encoding time.',
      ultra: 'Preserves finer text and gradients. Larger files and longer encoding.',
    };
    $('#quality-help').textContent = help[$('#output-quality').value];
    try {
      const o = options();
      $('#range-error').textContent = '';
      $('#begin-export').disabled = false;
      $('#output-summary').textContent =
        `${o.width} × ${o.height} · ${o.fps} fps · ${Math.ceil((o.end - o.start) * o.fps - 1e-7)} frames`;
    } catch (e) {
      $('#range-error').textContent = e.message;
      $('#begin-export').disabled = true;
    }
  }
  function setRange(a, b, preview = true) {
    const t = total(),
      min = 1 / Number($('#output-fps').value);
    range.start = Math.max(0, Math.min(a, t - min));
    range.end = Math.max(range.start + min, Math.min(b, t));
    render();
    if (preview) {
      pause();
      rangePlaying = false;
      seek(range.start);
    }
  }
  function tracks() {
    const p = project(),
      t = total(),
      container = $('#range-tracks');
    container.replaceChildren();
    for (let slot = 0; slot < slots(p); slot++) {
      const row = document.createElement('div');
      row.className = 'range-track';
      for (const c of p.clips.filter((c) => c.slot === slot)) {
        const m = p.media.find((m) => m.id === c.mediaId),
          item = document.createElement('div');
        item.className = 'range-track-clip';
        item.style.left = (c.start / t) * 100 + '%';
        item.style.width = (duration(c) / t) * 100 + '%';
        const img = document.createElement('img');
        img.src = m.thumbnail;
        img.alt = '';
        const name = document.createElement('span');
        name.textContent = m.name;
        item.append(img, name);
        row.append(item);
      }
      container.append(row);
    }
    $('#range-ruler').replaceChildren();
    for (let i = 0; i <= 4; i++) {
      const tick = document.createElement('span');
      tick.textContent = fmt((t * i) / 4);
      tick.style.left = i * 25 + '%';
      $('#range-ruler').append(tick);
    }
  }
  function open() {
    if (!project().clips.length) return;
    pause();
    returnTime = currentTime();
    rangePlaying = false;
    $('#output-fps').value = project().fps;
    $('#output-resolution').value = 'canvas';
    tracks();
    range = { start: 0, end: total() };
    render();
    const p = project(),
      canvas = $('#export-preview'),
      scale = Math.min(960 / p.width, 540 / p.height);
    canvas.width = Math.round(p.width * scale);
    canvas.height = Math.round(p.height * scale);
    dialog.showModal();
    compositor.draw(canvas, p, currentTime());
  }
  function close(restore = true) {
    pause();
    rangePlaying = false;
    dialog.close();
    if (restore) seek(returnTime);
  }
  $('#dismiss-export-settings').onclick = () => close();
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  for (const id of ['range-start', 'range-end'])
    $('#' + id).onchange = () => {
      const a = Number($('#range-start').value),
        b = Number($('#range-end').value);
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        a < 0 ||
        b > total() + 0.00001 ||
        b - a < 1 / Number($('#output-fps').value) - 0.00001
      ) {
        $('#range-error').textContent =
          'Choose a start and end inside the project, at least one frame apart.';
        $('#begin-export').disabled = true;
        return;
      }
      range = { start: a, end: b };
      render();
      pause();
      rangePlaying = false;
      seek(a);
    };
  $('#range-full').onclick = () => setRange(0, total());
  $('#range-test').onclick = () => setRange(0, Math.min(5, total()));
  $('#range-clip').onclick = () => {
    const c = selected();
    if (c) setRange(c.start, Math.min(total(), c.start + duration(c)));
  };
  $('#range-start-here').onclick = () => setRange(currentTime(), range.end);
  $('#range-end-here').onclick = () => setRange(range.start, currentTime(), false);
  for (const id of ['output-resolution', 'output-quality']) $('#' + id).onchange = render;
  $('#output-fps').onchange = () => setRange(range.start, range.end, false);
  $('#range-preview-play').onclick = () => {
    if (rangePlaying) {
      pause();
      rangePlaying = false;
    } else {
      if (
        currentTime() < range.start ||
        currentTime() >= range.end - 1 / Number($('#output-fps').value) - 0.00001
      )
        seek(range.start);
      rangePlaying = true;
      play();
    }
  };
  function drag(e, edge) {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = $('#range-timeline').getBoundingClientRect(),
      origin = { ...range },
      x = e.clientX;
    pause();
    rangePlaying = false;
    const move = (ev) => {
      const delta = ((ev.clientX - x) / box.width) * total(),
        fps = Number($('#output-fps').value),
        snap = (v) => Math.round(v * fps) / fps;
      if (edge === 'in')
        setRange(Math.min(snap(origin.start + delta), origin.end - 1 / fps), origin.end);
      else if (edge === 'out')
        setRange(origin.start, Math.max(snap(origin.end + delta), origin.start + 1 / fps));
      else {
        const len = origin.end - origin.start,
          a = Math.max(0, Math.min(snap(origin.start + delta), total() - len));
        setRange(a, a + len);
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener(
      'pointerup',
      () => document.removeEventListener('pointermove', move),
      { once: true },
    );
  }
  $('#range-selection').onpointerdown = (e) =>
    drag(
      e,
      e.target.id === 'range-in-handle'
        ? 'in'
        : e.target.id === 'range-out-handle'
          ? 'out'
          : 'move',
    );
  $('#range-ruler').onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pause();
    rangePlaying = false;
    const box = $('#range-ruler').getBoundingClientRect(),
      move = (ev) =>
        seek(Math.max(0, Math.min(total(), ((ev.clientX - box.left) / box.width) * total())));
    move(e);
    document.addEventListener('pointermove', move);
    document.addEventListener(
      'pointerup',
      () => document.removeEventListener('pointermove', move),
      { once: true },
    );
  };
  $('#begin-export').onclick = () => {
    try {
      const o = options();
      close();
      onExport(o);
    } catch (e) {
      $('#range-error').textContent = e.message;
    }
  };
  return {
    open,
    tick() {
      if (!dialog.open) return;
      const t = currentTime();
      if (rangePlaying && t >= range.end - 1e-7) {
        pause();
        rangePlaying = false;
        seek(Math.max(range.start, range.end - 1 / Number($('#output-fps').value)));
      }
      $('#range-preview-play').textContent = rangePlaying ? 'Ⅱ Pause' : '▶ Play range';
      $('#range-preview-time').textContent = fmt(currentTime());
      $('#range-playhead').style.left = (currentTime() / total()) * 100 + '%';
      compositor.draw($('#export-preview'), project(), currentTime());
    },
    isOpen: () => dialog.open,
  };
}
