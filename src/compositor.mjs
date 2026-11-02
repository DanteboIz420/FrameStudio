import { activeAt, sourceTime, footageRect, slots, duration } from './model.mjs';
export class Compositor {
  constructor() {
    this.videos = new Map();
    this.frames = new Map();
    this.thumbs = new Map();
    this.errors = new Set();
  }
  clear() {
    for (const v of this.videos.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    this.videos.clear();
    this.frames.clear();
    this.thumbs.clear();
    this.errors.clear();
  }
  key(c) {
    const overlap = this.project?.clips.some(
      (x) =>
        x.id !== c.id &&
        x.mediaId === c.mediaId &&
        x.slot === c.slot &&
        x.start < c.start + duration(c) - 0.00001 &&
        c.start < x.start + duration(x) - 0.00001,
    );
    return c.mediaId + ':' + c.slot + (overlap ? ':' + c.id : '');
  }
  capture(v, key) {
    if (v.readyState < 2 || v.seeking || !v.videoWidth) return;
    let frame = this.frames.get(key);
    if (!frame) {
      frame = document.createElement('canvas');
      const s = Math.min(1, 960 / v.videoWidth, 720 / v.videoHeight);
      frame.width = Math.round(v.videoWidth * s);
      frame.height = Math.round(v.videoHeight * s);
      this.frames.set(key, frame);
    }
    frame.getContext('2d').drawImage(v, 0, 0, frame.width, frame.height);
  }
  image(c) {
    const key = this.key(c),
      v = this.videos.get(key),
      thumb = this.thumbs.get(c.mediaId);
    return (
      this.frames.get(key) ||
      (v?.readyState >= 2 && !v.seeking ? v : null) ||
      (thumb?.complete && thumb.naturalWidth ? thumb : null)
    );
  }
  video(c, p) {
    const key = this.key(c);
    if (!this.videos.has(key)) {
      const m = p.media.find((m) => m.id === c.mediaId);
      const v = document.createElement('video');
      if (!this.thumbs.has(m.id)) {
        const thumb = new Image();
        thumb.src = m.thumbnail;
        this.thumbs.set(m.id, thumb);
      }
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      v.src = m.url;
      v.addEventListener('error', () => this.errors.add(c.id));
      this.videos.set(key, v);
      for (const event of ['loadeddata', 'seeked'])
        v.addEventListener(event, () => this.capture(v, key));
      if (v.requestVideoFrameCallback) {
        const update = () => {
          if (this.videos.get(key) !== v) return;
          this.capture(v, key);
          v.requestVideoFrameCallback(update);
        };
        v.requestVideoFrameCallback(update);
      }
    }
    return this.videos.get(key);
  }
  async prepare(p, t) {
    const clips = p.clips.filter((c) => c.slot < slots(p) && activeAt(c, t));
    await Promise.all(
      clips.map(async (c) => {
        const v = this.video(c, p);
        v.pause();
        if (v.readyState < 1)
          await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => done(Error('Video could not be opened. Try an H.264 MP4 recording.')),
              15000,
            );
            const ok = () => done(),
              bad = () =>
                done(Error('This video codec cannot be previewed. Convert it to H.264 MP4 first.'));
            const done = (e) => {
              clearTimeout(timer);
              v.removeEventListener('loadedmetadata', ok);
              v.removeEventListener('error', bad);
              e ? reject(e) : resolve();
            };
            v.addEventListener('loadedmetadata', ok, { once: true });
            v.addEventListener('error', bad, { once: true });
            if (v.error) bad();
          });
        const target = Math.min(sourceTime(c, t), v.duration - 0.0001);
        if (Math.abs(v.currentTime - target) < 0.0001 && v.readyState >= 2) return;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => done(Error('Timed out reading a video frame.')), 15000);
          const ok = () => done(),
            bad = () => done(Error('Could not decode this recording.'));
          const done = (e) => {
            clearTimeout(timer);
            v.removeEventListener('seeked', ok);
            v.removeEventListener('error', bad);
            e ? reject(e) : resolve();
          };
          v.addEventListener('seeked', ok, { once: true });
          v.addEventListener('error', bad, { once: true });
          v.currentTime = Math.max(0, target);
        });
        if (Math.abs(v.currentTime - target) > 0.02)
          throw Error('The recording could not seek to the requested frame.');
      }),
    );
  }
  sync(p, t, playing) {
    this.project = p;
    const active = new Set();
    for (const c of p.clips) {
      if (c.slot >= slots(p) || !activeAt(c, t)) continue;
      active.add(this.key(c));
      const v = this.video(c, p);
      const target = Math.max(0, sourceTime(c, t)),
        changed = v._clip !== c.id;
      if (v.playbackRate !== c.speed) v.playbackRate = c.speed;
      const drift = Math.abs(v.currentTime - target),
        now = performance.now();
      if (
        v.readyState >= 1 &&
        !v.seeking &&
        ((!playing && drift > 0.012) ||
          (playing &&
            (changed ||
              (!v._playing && drift > 0.1) ||
              (drift > 0.8 && now - (v._lastSeek || 0) > 1500))))
      ) {
        v.currentTime = Math.min(target, v.duration - 0.0001);
        v._lastSeek = now;
      }
      if (v.readyState >= 1) v._clip = c.id;
      v._playing = playing;
      if (playing && v.paused) v.play().catch(() => {});
      else if (!playing && !v.paused) v.pause();
    }
    for (const [id, v] of this.videos) if (!active.has(id)) v.pause();
  }
  draw(canvas, p, t, selected = null) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const W = p.width,
      H = p.height,
      renderScale = canvas.width / W;
    ctx.save();
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.fillStyle = p.color;
    ctx.fillRect(0, 0, W, H);
    const active = p.clips
      .filter((c) => c.slot < slots(p) && activeAt(c, t))
      .sort((a, b) => a.slot - b.slot || a.start - b.start);
    const bg = active.find((c) => this.image(c));
    if (p.background === 'gradient') {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, p.color);
      g.addColorStop(0.5, '#4c4545');
      g.addColorStop(1, '#242b35');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (p.background === 'blur' && bg) {
      const v = this.image(bg),
        vw = v.videoWidth || v.width,
        vh = v.videoHeight || v.height;
      const s = (Math.max(W / vw, H / vh) * p.backgroundZoom) / 100;
      const w = vw * s,
        h = vh * s;
      ctx.save();
      ctx.globalAlpha = p.opacity / 100;
      ctx.filter = `blur(${p.blur * renderScale}px)`;
      // Overscan prevents transparent blur edges at 100% background zoom.
      const overscan = 1 + (p.blur * 4) / Math.min(w, h);
      ctx.drawImage(v, (W - w * overscan) / 2, (H - h * overscan) / 2, w * overscan, h * overscan);
      ctx.restore();
    }
    for (const c of active) {
      const v = this.image(c),
        m = p.media.find((m) => m.id === c.mediaId);
      if (!v) continue;
      const r = footageRect(p, c, m),
        radius = Math.min(p.radius, r.w / 2, r.h / 2);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      ctx.shadowColor = `rgba(0,0,0,${(p.shadow / 100) * 0.8})`;
      ctx.shadowBlur = p.shadow * 1.2 * renderScale;
      ctx.shadowOffsetY = p.shadow * 0.35 * renderScale;
      ctx.fillStyle = '#191b1f';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      ctx.clip();
      ctx.drawImage(v, r.x, r.y, r.w, r.h);
      ctx.restore();
      if (c.id === selected) {
        ctx.save();
        ctx.strokeStyle = '#f0be92';
        ctx.lineWidth = (2 * W) / canvas.clientWidth;
        ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}
