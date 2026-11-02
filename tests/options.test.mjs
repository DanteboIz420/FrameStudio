import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaults, duration } from '../src/model.mjs';
import {
  rangeProject,
  validateExport,
  styleOf,
  validateStyle,
  QUALITY,
} from '../src/project-options.mjs';
const { createStorage } = createRequire(import.meta.url)('../storage.cjs');
const fixture = () => ({
  ...defaults(),
  media: [{ id: 'm', path: 'demo.mp4', duration: 30, width: 1920, height: 1080 }],
  clips: [
    { id: 'a', mediaId: 'm', start: 0, in: 0, out: 2, speed: 1, slot: 0, scale: 1, x: 0, y: 0 },
    { id: 'b', mediaId: 'm', start: 2, in: 10, out: 18, speed: 2, slot: 0, scale: 1, x: 0, y: 0 },
  ],
});
test('selected range intersects accelerated clips and rebases time without mutating edits', () => {
  const p = fixture(),
    before = structuredClone(p),
    r = rangeProject(p, 1, 4);
  assert.deepEqual(
    r.clips.map((c) => [c.start, c.in, c.out]),
    [
      [0, 1, 2],
      [1, 10, 14],
    ],
  );
  assert.equal(duration(r.clips[1]), 2);
  assert.deepEqual(p, before);
});
test('range inside a gap produces no clips but remains a valid export selection', () => {
  const p = fixture();
  p.clips[1].start = 5;
  assert.equal(rangeProject(p, 3, 4).clips.length, 0);
  assert.equal(validateExport(p, { start: 3, end: 4 }).end, 4);
});
test('export settings reject invalid ranges and support all quality levels', () => {
  const p = fixture();
  for (const quality of Object.keys(QUALITY))
    assert.equal(validateExport(p, { start: 1, end: 2, quality }).quality, quality);
  for (const invalid of [
    { start: -1 },
    { end: 100 },
    { start: 2, end: 2 },
    { fps: 0 },
    { quality: 'unknown' },
    { width: 1279 },
  ])
    assert.throws(() => validateExport(p, invalid));
});
test('saved styles exclude recordings and edits, and validate dimensions', () => {
  const p = fixture();
  const s = styleOf(p);
  assert.equal(s.clips, undefined);
  assert.equal(s.name, undefined);
  assert.equal(validateStyle(s).width, 1920);
  assert.throws(() => validateStyle({ ...s, width: 7 }));
});
test('autosaves from different sessions survive independently; clearing one preserves the other', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-storage-')),
    a = createStorage(root, '11111111-1111-1111-1111-111111111111'),
    b = createStorage(root, '22222222-2222-2222-2222-222222222222');
  await Promise.all([
    a.autosave({ project: fixture(), time: 2 }),
    b.autosave({ project: { ...fixture(), name: 'Second' }, time: 3 }),
  ]);
  assert.equal((await a.recoveries()).length, 1);
  await a.clear();
  assert.equal((await a.recoveries())[0].project.name, 'Second');
  assert.equal((await b.recoveries()).length, 0);
});
test('atomic save ordering leaves the last edit and preset updates persist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-storage-')),
    a = createStorage(root, '33333333-3333-3333-3333-333333333333');
  await Promise.all([
    a.autosave({ project: fixture(), time: 1 }),
    a.autosave({ project: fixture(), time: 4 }),
  ]);
  const other = createStorage(root);
  assert.equal((await other.recoveries())[0].time, 4);
  const preset = await a.savePreset('Twitter', styleOf(fixture()));
  await a.savePreset('Updated', styleOf(fixture()), preset.id);
  assert.equal((await other.presets()).length, 1);
  assert.equal((await other.presets())[0].name, 'Updated');
  await other.deletePreset(preset.id);
  assert.equal((await a.presets()).length, 0);
});
