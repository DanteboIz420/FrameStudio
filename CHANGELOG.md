# Changelog

## 1.3.0 — Compositions and batch export

- Keep independent timelines, canvas sizes and styles in one project, with a shared recording library.
- Create compositions from trimmed clips using the timeline context menu; duplicate, rename and switch compositions.
- Save and recover every composition together; older projects open as one composition.
- Queue snapshots with per-video ranges, resolutions, FPS and quality, or add all nonempty compositions.
- Choose one folder and render separate muted MP4s sequentially, with cancellation and retry for unfinished items.

## 1.2.2 — Windows ZIP compatibility

- Package the portable app with Windows’ ZIP implementation, without leading `./` directory entries.
- Verify listing through Windows Explorer and extraction with Windows tooling before release.
- Application features and the bundled video engine are unchanged.

## 1.2.1 — First public beta

- Windows x64 portable release with FFmpeg and FFprobe included. Extract the ZIP and open the app; no installer, engine prompt, account or runtime download.
- Single-video and simultaneous grid layouts, per-clip 1×–3× speed, splitting, trimming, snapping and insert mode.
- Canvas formats, positioning, scale, spacing, rounded corners, shadows and a synchronized blurred-video background.
- Native muted MP4 export with selected ranges, output resolution, FPS and Draft/High/Ultra quality.
- Persistent style presets, project files, per-session autosave and recovery.
- Public README with the creator's edited walkthrough, before/after comparison and finished outcomes.

This is an early beta. macOS/Linux packages, audio editing, transitions, text overlays and keyframe animation are not included.
