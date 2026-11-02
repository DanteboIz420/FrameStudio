import { defaults, validateProject, projectDuration, duration } from './model.mjs';
export const STYLE_KEYS = [
  'width',
  'height',
  'fps',
  'layout',
  'padding',
  'gap',
  'radius',
  'shadow',
  'background',
  'color',
  'blur',
  'opacity',
  'backgroundZoom',
];
export const QUALITY = {
  draft: { label: 'Draft', crf: 26, preset: 'ultrafast' },
  high: { label: 'High', crf: 20, preset: 'veryfast' },
  ultra: { label: 'Ultra', crf: 16, preset: 'fast' },
};
export function styleOf(p) {
  return Object.fromEntries(STYLE_KEYS.map((k) => [k, p[k]]));
}
export function validateStyle(style) {
  const candidate = {
    ...defaults(),
    ...Object.fromEntries(STYLE_KEYS.filter((k) => k in style).map((k) => [k, style[k]])),
  };
  return styleOf(validateProject(candidate));
}
export function validateExport(p, raw) {
  const total = projectDuration(p),
    o = {
      start: 0,
      end: total,
      fps: p.fps,
      quality: 'high',
      width: p.width,
      height: p.height,
      ...raw,
    };
  if (![24, 25, 30, 50, 60].includes(o.fps) || !Object.hasOwn(QUALITY, o.quality))
    throw Error('Choose a valid frame rate and quality.');
  if (
    !Number.isFinite(o.start) ||
    !Number.isFinite(o.end) ||
    o.start < 0 ||
    o.end > total + 0.00001 ||
    o.end - o.start < 1 / o.fps - 0.00001
  )
    throw Error('Select at least one frame inside the project.');
  if (
    ![o.width, o.height].every((n) => Number.isInteger(n) && n >= 320 && n <= 3840 && n % 2 === 0)
  )
    throw Error('Output dimensions must be even numbers from 320 to 3840.');
  return o;
}
export function rangeProject(p, start, end) {
  return {
    ...p,
    clips: p.clips.flatMap((c) => {
      const a = Math.max(start, c.start),
        b = Math.min(end, c.start + duration(c));
      if (b - a < 0.000001) return [];
      return [
        {
          ...c,
          start: a - start,
          in: c.in + (a - c.start) * c.speed,
          out: Math.min(c.out, c.in + (b - c.start) * c.speed),
        },
      ];
    }),
  };
}
