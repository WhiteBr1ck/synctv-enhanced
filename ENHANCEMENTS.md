# v0.9.15 Enhanced changes

The Go backend returns AList file size and modification time through transient
`gorm:"-"` fields. No database schema is changed. Unused mixed-case duplicate
package directories were removed for Windows checkout compatibility.

The Node.js gateway serves the frontend and forwards APIs, WebSockets and raw TCP.
Authenticated current-movie responses can carry an opaque subtitle capability.
FFprobe discovers text tracks; FFmpeg extracts selected subtitles and ASS fonts.
HTTP(S) inputs, expiring sessions, bounded jobs and cache cleanup are enforced.
Media credentials are not logged. Video streams are not re-encoded.

The player registers ASS rendering before discovery and handles asynchronous
switches. SRT/VTT cues follow the video clock instead of relying on native MKV tracks.

Shared sort controls select field and direction. Directories come first, numeric
names sort naturally, missing metadata comes last, and full directories are sorted
before pagination. Browser preferences are retained.

The tests use real MKV/MP4 fixtures to check text tracks, fonts, source switching,
authentication, WebSockets, TCP multiplexing, safe timed text and directory sorting.

Runtime databases, account configuration, caches, backups and private screenshots
are excluded from the repository. Upstream licenses and source history are retained.
