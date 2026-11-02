export const uid = () => crypto.randomUUID();
export const duration = (c) => Math.max(0, (c.out - c.in) / c.speed);
export const projectDuration = (p) =>
  Math.max(0, ...p.clips.filter((c) => c.slot < slots(p)).map((c) => c.start + duration(c)));
export const activeAt = (c, t) => t >= c.start && t < c.start + duration(c) - 0.00001;
export const sourceTime = (c, t) => c.in + (t - c.start) * c.speed;
export const defaults = () => ({
  version: 1,
  name: 'Untitled project',
  width: 1920,
  height: 1080,
  fps: 60,
  insertMode: false,
  layout: 'single',
  padding: 100,
  gap: 28,
  radius: 24,
  shadow: 45,
  background: 'blur',
  color: '#20262b',
  blur: 55,
  opacity: 55,
  backgroundZoom: 115,
  clips: [],
  media: [],
});
export function splitClip(p, id, time, newId = uid()) {
  const c = p.clips.find((c) => c.id === id);
  if (!c || time <= c.start + 1 / 60 || time >= c.start + duration(c) - 1 / 60) return null;
  const cut = sourceTime(c, time);
  const next = { ...c, id: newId, in: cut, start: time };
  c.out = cut;
  p.clips.splice(p.clips.indexOf(c) + 1, 0, next);
  return next;
}
export function slotRect(p, slot) {
  const cols = p.layout === 'single' ? 1 : p.layout === 'three' ? 3 : 2;
  const rows = p.layout === 'six' ? 3 : p.layout === 'four' ? 2 : 1;
  const padding = Math.min(p.padding, (Math.min(p.width, p.height) - 4) / 2);
  const gap = Math.max(
    0,
    Math.min(
      p.gap,
      cols > 1 ? (p.width - padding * 2 - cols) / (cols - 1) : Infinity,
      rows > 1 ? (p.height - padding * 2 - rows) / (rows - 1) : Infinity,
    ),
  );
  const w = (p.width - padding * 2 - gap * (cols - 1)) / cols;
  const h = (p.height - padding * 2 - gap * (rows - 1)) / rows;
  return {
    x: padding + (slot % cols) * (w + gap),
    y: padding + Math.floor(slot / cols) * (h + gap),
    w,
    h,
  };
}
export const slots = (p) => ({ single: 1, two: 2, three: 3, four: 4, six: 6 })[p.layout] || 1;
export function footageRect(p, c, m) {
  const box = slotRect(p, c.slot);
  const fit = Math.min(box.w / m.width, box.h / m.height) * c.scale;
  const w = m.width * fit,
    h = m.height * fit;
  return {
    x: box.x + (box.w - w) / 2 + c.x * p.width,
    y: box.y + (box.h - h) / 2 + c.y * p.height,
    w,
    h,
  };
}
export function validateProject(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.clips) || !Array.isArray(raw.media))
    throw Error('This is not a Frame Studio project.');
  const p = { ...defaults(), ...raw };
  if (![24, 25, 30, 50, 60].includes(p.fps)) throw Error('Choose 24, 25, 30, 50 or 60 fps.');
  if (typeof p.insertMode !== 'boolean') throw Error('Invalid insert mode.');
  const finite = (x, min, max) =>
    typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  if (!finite(p.width, 320, 3840) || !finite(p.height, 320, 3840) || p.width % 2 || p.height % 2)
    throw Error('Canvas dimensions must be even numbers from 320 to 3840.');
  if (!['single', 'two', 'three', 'four', 'six'].includes(p.layout)) throw Error('Invalid layout.');
  for (const [k, min, max] of [
    ['padding', 0, 500],
    ['gap', 0, 200],
    ['radius', 0, 150],
    ['shadow', 0, 100],
    ['blur', 0, 100],
    ['opacity', 0, 100],
    ['backgroundZoom', 100, 200],
  ])
    if (!finite(p[k], min, max)) throw Error(`Invalid ${k}.`);
  if (!['blur', 'solid', 'gradient'].includes(p.background) || !/^#[0-9a-f]{6}$/i.test(p.color))
    throw Error('Invalid background.');
  for (const m of p.media)
    if (
      typeof m.id !== 'string' ||
      typeof m.path !== 'string' ||
      !finite(m.duration, 0.01, 86400) ||
      !finite(m.width, 1, 32768) ||
      !finite(m.height, 1, 32768)
    )
      throw Error('Invalid media metadata.');
  for (const c of p.clips) {
    const m = p.media.find((m) => m.id === c.mediaId);
    if (
      !m ||
      typeof c.id !== 'string' ||
      !finite(c.start, 0, 86400) ||
      !finite(c.in, 0, m.duration) ||
      !finite(c.out, c.in + 0.001, m.duration + 0.001) ||
      !finite(c.speed, 1, 3) ||
      !finite(c.slot, 0, 5) ||
      !Number.isInteger(c.slot) ||
      !finite(c.scale, 0.2, 2) ||
      !finite(c.x, -1, 1) ||
      !finite(c.y, -1, 1)
    )
      throw Error('Invalid clip data.');
  }
  return p;
}
export function closeGaps(p) {
  for (let slot = 0; slot < 6; slot++) {
    let t = 0;
    for (const c of p.clips.filter((c) => c.slot === slot).sort((a, b) => a.start - b.start)) {
      c.start = t;
      t += duration(c);
    }
  }
}
// Insert at a boundary: a drop inside a clip goes before or after its midpoint.
// This preserves each recording and makes room without silently trimming it.
export function insertClip(p, id, slot, at) {
  const c = p.clips.find((c) => c.id === id);
  if (!c) return;
  const others = p.clips
    .filter((x) => x.id !== id && x.slot === slot)
    .sort((a, b) => a.start - b.start);
  const hit = others.find((x) => at > x.start && at < x.start + duration(x));
  if (hit) at = at < hit.start + duration(hit) / 2 ? hit.start : hit.start + duration(hit);
  c.slot = slot;
  c.start = Math.max(0, at);
  let end = c.start + duration(c);
  for (const x of others) {
    if (x.start + duration(x) <= c.start + 0.00001) continue;
    if (x.start < end) x.start = end;
    end = x.start + duration(x);
  }
}
