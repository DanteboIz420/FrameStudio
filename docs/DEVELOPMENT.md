# Development

## Layout

- `main.cjs`: native window, media byte-range protocol, file dialogs, IPC, engine discovery and export orchestration.
- `preload.cjs`: restricted renderer bridge.
- `src/app.mjs`: editing state, shortcuts, timeline interactions, styles and recovery UI.
- `src/model.mjs`: clip timing, splitting, grids, snapping, insertion and validation.
- `src/compositor.mjs`: preview decoding and retained frames for scrubbing.
- `src/export-panel.mjs`: export review, selected range and output controls.
- `src/project-options.mjs`: styles and non-destructive range selection.
- `src/export-assets.mjs`: static export masks and shadows.
- `native-render.cjs`: sequential native FFmpeg scene rendering and final concatenation.
- `storage.cjs`: atomic per-session recovery files and persistent style presets.
- `engine-setup.cjs`: pinned Windows engine download, checksum verification and extraction using Windows `tar.exe`.

## Engine setup

`npm run setup:engine` installs the upstream package into the ignored `engine` directory for development. `FRAME_FFMPEG_DIR` can point to a directory containing FFmpeg and FFprobe. An installation on PATH is also accepted.

In packaged apps, the engine is bundled in `resources/engine`. The upstream LICENSE and README remain beside the executables. Public archives include FFmpeg and FFprobe; see [third-party notices](../THIRD_PARTY_NOTICES.md).

## Checks

`npm test` covers timeline math, project options, styles, atomic recovery and isolated sessions. `npm run test:setup` checks the pinned setup configuration. The Electron integration tests require a working local engine:

```powershell
npm run test:app
npm run test:regressions
npm run test:features
```

These tests use temporary, isolated user-data directories. Test exports and screenshots are written to ignored `test-output`. Set `FRAME_PACKAGED=1` to test `dist/win-unpacked/Frame Studio.exe`. If FFmpeg is not on PATH, also set `FRAME_FFMPEG_DIR` to the engine's `bin` directory for packaged tests.

`tests/benchmark.cjs` is optional and requires `FRAME_PREVIOUS_EXE` pointing to a previous build. It is not a general performance guarantee. `node scripts/capture-showcase.cjs` captures the sample editor and export panel and produces a real featured-video export for documentation.

## Packaging

`npm run build` creates the Windows portable folder. Keep the Electron executable unmodified: this project disables executable resource editing and keeps application files in `resources/app`. Application and shortcut icons can still use `assets/icon.ico`. The current release is unsigned.

Before publishing a release, verify the bundled engine on a clean profile with no FFmpeg on PATH, run the packaged feature checks, and archive the entire `win-unpacked` directory—not just the executable. Include this project's LICENSE, third-party notices, Electron license files, and a SHA-256 checksum alongside the ZIP. Never include local `.frame` projects, recovery snapshots, credentials or personal recordings.
