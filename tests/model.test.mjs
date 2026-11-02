import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaults,
  duration,
  splitClip,
  sourceTime,
  activeAt,
  validateProject,
  footageRect,
  projectDuration,
  slotRect,
  insertClip,
  closeGaps,
} from '../src/model.mjs';
const fixture = () => ({
  ...defaults(),
  media: [{ id: 'm', path: 'recording.mp4', duration: 20, width: 1920, height: 1080 }],
  clips: [
    { id: 'c', mediaId: 'm', start: 2, in: 3, out: 15, speed: 2, slot: 0, scale: 1, x: 0, y: 0 },
  ],
});
test('splitting preserves source continuity and total edited duration at accelerated speed', () => {
  const p = fixture();
  const original = duration(p.clips[0]);
  const next = splitClip(p, 'c', 4, 'second');
  assert.equal(p.clips[0].out, 7);
  assert.equal(next.in, 7);
  assert.equal(next.start, 4);
  assert.equal(duration(p.clips[0]) + duration(next), original);
  assert.equal(sourceTime(next, 5), 9);
  assert.equal(activeAt(p.clips[0], 4), false);
  assert.equal(activeAt(next, 4), true);
});
test('splitting outside a clip or at its edge makes no mutation', () => {
  const p = fixture();
  const before = structuredClone(p);
  assert.equal(splitClip(p, 'c', 2, 'x'), null);
  assert.equal(splitClip(p, 'c', 8, 'x'), null);
  assert.deepEqual(p, before);
});
test('project validation rejects invalid sources, timing and dimensions', () => {
  assert.doesNotThrow(() => validateProject(fixture()));
  for (const mutate of [
    (p) => (p.width = 1081),
    (p) => (p.clips[0].speed = 0),
    (p) => (p.clips[0].out = 30),
    (p) => (p.clips[0].mediaId = 'missing'),
    (p) => (p.clips[0].x = NaN),
  ]) {
    const p = fixture();
    mutate(p);
    assert.throws(() => validateProject(p));
  }
});
test('grid framing preserves source aspect ratio and responds to scale and position', () => {
  const p = fixture();
  p.layout = 'four';
  const c = p.clips[0],
    m = p.media[0];
  let r = footageRect(p, c, m);
  assert.equal(r.w / r.h, 1920 / 1080);
  const old = { ...r };
  c.scale = 0.5;
  c.x = 0.1;
  r = footageRect(p, c, m);
  assert.equal(r.w, old.w / 2);
  assert.ok(r.x > old.x);
});
test('hidden grid cells do not extend the exported duration', () => {
  const p = fixture();
  p.clips.push({ ...p.clips[0], id: 'hidden', start: 30, slot: 3 });
  assert.equal(projectDuration(p), 8);
  p.layout = 'four';
  assert.equal(projectDuration(p), 36);
});
test('large padding and gaps keep cells positive on a small custom canvas', () => {
  const p = { ...defaults(), width: 320, height: 320, padding: 400, gap: 150, layout: 'six' };
  for (let slot = 0; slot < 6; slot++) {
    const r = slotRect(p, slot);
    assert.ok(r.w >= 1 && r.h >= 1);
    assert.ok(r.x + r.w <= p.width && r.y + r.h <= p.height);
  }
});
test('insert mode makes room, cascades overlapping clips, and preserves other cells', () => {
  const p = fixture();
  p.clips = [
    { ...p.clips[0], id: 'a', start: 0, in: 0, out: 4, speed: 1 },
    { ...p.clips[0], id: 'b', start: 4, in: 0, out: 4, speed: 1 },
    { ...p.clips[0], id: 'moving', start: 10, in: 0, out: 2, speed: 1 },
    { ...p.clips[0], id: 'other', slot: 1, start: 1 },
  ];
  insertClip(p, 'moving', 0, 1);
  assert.equal(p.clips[2].start, 0);
  assert.equal(p.clips[0].start, 2);
  assert.equal(p.clips[1].start, 6);
  assert.equal(p.clips[3].start, 1);
  assert.equal(p.clips[0].out, 4);
});
test('snap all removes gaps and overlaps in order, independently per cell', () => {
  const p = fixture();
  p.clips.push(
    { ...p.clips[0], id: 'b', start: 3 },
    { ...p.clips[0], id: 'other', slot: 1, start: 9 },
  );
  closeGaps(p);
  assert.deepEqual(
    p.clips.map((c) => c.start),
    [0, 6, 0],
  );
});
test('old projects receive 60 fps and FPS validation rejects invalid values', () => {
  const p = fixture();
  delete p.fps;
  assert.equal(validateProject(p).fps, 60);
  for (const fps of [24, 25, 30, 50, 60]) assert.equal(validateProject({ ...p, fps }).fps, fps);
  assert.throws(() => validateProject({ ...p, fps: 0 }));
});
