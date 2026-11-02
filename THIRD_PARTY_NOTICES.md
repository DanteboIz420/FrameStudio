# Third-party software

Frame Studio's application code is released under the MIT license. Dependencies retain their own licenses.

## Electron and Chromium

Electron is MIT-licensed: <https://github.com/electron/electron/blob/main/LICENSE>.
The Windows archive includes the runtime's `LICENSE.electron.txt` and `LICENSES.chromium.html` files. Electron source and build information: <https://github.com/electron/electron>.

## FFmpeg

FFmpeg and FFprobe are separate executables used for metadata and rendering. The Windows portable archive bundles the unmodified FFmpeg and FFprobe executables from the pinned upstream package, together with the provider’s GPL v3 LICENSE and build README. No first-use download is needed. Developers can obtain the same package with `npm run setup:engine`.

- Windows build provider: <https://www.gyan.dev/ffmpeg/builds/>
- Pinned package: FFmpeg 9.0.2 essentials build, dated 2026-09-19.
- Package: <https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip>
- SHA-256: `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`
- FFmpeg source revision recorded by the provider: <https://github.com/FFmpeg/FFmpeg/commit/946fcce07b>
- Source archive: <https://github.com/DanteboIz420/FrameStudio/releases/download/v1.2.1/FFmpeg-9.0.2-Source.tar.gz>
- Upstream licensing information: <https://ffmpeg.org/legal.html>

The release includes the exact FFmpeg source revision as a separate source archive. The provider’s build configuration and external library versions are preserved in `resources/engine/README.txt`. The provider labels this build GPL v3. Its LICENSE, README, and accompanying files are retained in the installed engine directory. Frame Studio's MIT license does not replace the licenses of FFmpeg or its dependencies.

## Development dependencies and sample media

Dependency versions and provenance are recorded in `package-lock.json`. Playwright, Sharp, and electron-builder are development tools and are not shipped as runtime dependencies. Each has its own upstream license.

The bundled Orbit, Forma, and Aura concept-site visuals are original Frame Studio sample assets, included under this repository's MIT license. They are demonstration content, not customer projects or endorsements.
