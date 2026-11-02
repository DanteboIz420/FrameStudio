import { footageRect, slots } from './model.mjs';
export async function exportAssets(p) {
  const png = async (canvas) =>
    new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, 'image/png'))).arrayBuffer());
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const base = canvas(p.width, p.height),
    ctx = base.getContext('2d');
  ctx.fillStyle = p.color;
  ctx.fillRect(0, 0, p.width, p.height);
  if (p.background === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, p.width, p.height);
    g.addColorStop(0, p.color);
    g.addColorStop(0.5, '#4c4545');
    g.addColorStop(1, '#242b35');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, p.width, p.height);
  }
  const assets = { base: await png(base), clips: {} };
  for (const c of p.clips.filter((c) => c.slot < slots(p))) {
    const m = p.media.find((m) => m.id === c.mediaId),
      rect = footageRect(p, c, m),
      r = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.max(1, Math.round(rect.w)),
        h: Math.max(1, Math.round(rect.h)),
      };
    const radius = Math.min(p.radius, r.w / 2, r.h / 2),
      mask = canvas(r.w, r.h),
      mc = mask.getContext('2d');
    mc.fillStyle = '#000';
    mc.fillRect(0, 0, r.w, r.h);
    mc.fillStyle = '#fff';
    mc.beginPath();
    mc.roundRect(0, 0, r.w, r.h, radius);
    mc.fill();
    const shadow = canvas(p.width, p.height),
      sc = shadow.getContext('2d');
    sc.shadowColor = `rgba(0,0,0,${(p.shadow / 100) * 0.8})`;
    sc.shadowBlur = p.shadow * 1.2;
    sc.shadowOffsetY = p.shadow * 0.35;
    sc.fillStyle = '#191b1f';
    sc.beginPath();
    sc.roundRect(r.x, r.y, r.w, r.h, radius);
    sc.fill();
    assets.clips[c.id] = { ...r, mask: await png(mask), shadow: await png(shadow) };
  }
  return assets;
}
