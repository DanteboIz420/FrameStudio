# Showcase media

The main README uses four recordings supplied by the creator: an unedited app walkthrough, a version edited in Frame Studio, and two finished outcomes. Short, muted GIF excerpts play inline; full-quality MP4 files are release assets. The clips have different edits and durations, so the side-by-side is not a frame-matched benchmark.

The latest editor and export-panel screenshots use the app’s original sample sites. [Media terms](media/LICENSE.md).

To refresh the clips, run `node scripts/prepare-user-media.cjs "path/to/showcase-folder"` with the four named source videos, then attach the resulting MP4 files from ignored `dist` to the release. Keep source recordings out of Git history. No private source paths are committed.
