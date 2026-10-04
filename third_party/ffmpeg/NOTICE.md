# FFmpeg runtime notice

Clipzu for Windows downloads the Gyan Doshi FFmpeg 8.1.2 essentials build on first use. FFmpeg.org links Gyan's Windows builds from its download page. Clipzu pins the upstream archive URL and SHA-256 in `src/shared/modelCatalog.ts`, extracts only `ffmpeg.exe` and `ffprobe.exe`, validates both version strings plus the codecs and filters used by Clipzu, and stores them under the current user's application data. The binaries are installed once and media editing/export then work offline. A user can also select the same pinned archive from local storage to install without a network connection.

- Build page: <https://www.gyan.dev/ffmpeg/builds/>
- Pinned build archive: <https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip>
- Corresponding FFmpeg source: <https://github.com/FFmpeg/FFmpeg/commit/38b88335f9>
- License: GNU GPL version 3; see `GPL-3.0.txt` beside this notice.
- Build configuration and included libraries: Gyan's release essentials build; `libass`, `libfreetype`, `libfribidi`, `libharfbuzz`, `libx264`, `libx265`, `libmp3lame`, `libwebp`, and the standard FFmpeg components required by Clipzu.

The local-archive action accepts only this pinned archive. A different or modified archive fails the SHA-256 check before extraction.
