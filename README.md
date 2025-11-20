# Torrent Media Player

A lightweight web app for downloading and streaming torrent content (magnet link or `.torrent` file) with a built-in video player and optional subtitle attachment.

## Features
- Add torrents via magnet URI or uploaded `.torrent` file
- View active torrents with progress, peer counts, and speeds
- Stream MP4/MKV files directly in the browser with range requests
- Download individual files from a torrent
- Attach custom subtitle files (VTT/SRT) to the player

## Getting started
### Requirements
- Node.js 18+

### Installation
```bash
npm install
```

### Run the server
```bash
npm start
```
The server defaults to `http://localhost:3000` and serves the web UI from `public/`.

Set a custom download directory with the `DOWNLOAD_DIR` environment variable:
```bash
DOWNLOAD_DIR=/path/to/downloads npm start
```

### API overview
- `POST /api/torrents` — body `{ "magnetUri": "..." }` or multipart form with a `torrent` file
- `GET /api/torrents` — list active torrents
- `GET /api/torrents/:infoHash/files` — list files for a torrent
- `GET /api/torrents/:infoHash/stream?fileIndex=0` — stream a specific file (range supported)
- `GET /api/torrents/:infoHash/files/:fileIndex/download` — download a file
- `DELETE /api/torrents/:infoHash` — remove a torrent from the client

## Notes
- Media streams are served from the local download directory once pieces are available; allow time for buffering on new torrents.
- Subtitle upload in the UI accepts `.vtt` or `.srt` and attaches the track to the current video element.
