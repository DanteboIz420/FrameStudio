FFmpeg binaries are intentionally excluded from source control .

The public Windows application bundles the pinned engine and is ready to use after extracting the ZIP. For development, run `npm run setup:engine`. The archive checksum is pinned in `engine-setup.cjs`, and the upstream LICENSE and README are kept with the extracted package. An existing FFmpeg/FFprobe installation on PATH also works.
