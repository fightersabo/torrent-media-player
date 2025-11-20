# Torrent Media Player

A lightweight web app for downloading and streaming torrent content (magnet link or `.torrent` file) with a built-in video player and optional subtitle attachment. Powered by a fast Node.js 20+ backend that controls a local Transmission daemon.

## Features
- Add torrents via magnet URI or uploaded `.torrent` file
- View active torrents with progress, peer counts, and speeds
- Stream MP4/MKV files directly in the browser with range requests (after the download completes)
- Download individual files from a torrent once Transmission finishes
- Attach custom subtitle files (VTT/SRT) to the player

## Getting started
### Requirements
- Node.js 20+
- A running Transmission daemon reachable over RPC (defaults: `localhost:9091`)

### Installation
```bash
npm install
```

Install and start Transmission separately. Configure RPC access (host/port/credentials) so the Node.js app can control it.

### Run the server
```bash
npm start
```
The server defaults to `http://localhost:3000` and serves the web UI from `public/`.

Set a custom download directory with the `DOWNLOAD_DIR` environment variable (must match a valid Transmission download directory):
```bash
DOWNLOAD_DIR=/path/to/downloads npm start
```

Configure Transmission connection details with environment variables:

```bash
TRANSMISSION_HOST=localhost \
TRANSMISSION_PORT=9091 \
TRANSMISSION_USER=myuser \
TRANSMISSION_PASSWORD=secret \
DOWNLOAD_DIR=/path/to/downloads \
npm start
```

### API overview
- `POST /api/torrents` — body `{ "magnetUri": "..." }` or multipart form with a `torrent` file
- `GET /api/torrents` — list active torrents
- `GET /api/torrents/:infoHash/files` — list files for a torrent
- `GET /api/torrents/:infoHash/stream?fileIndex=0` — stream a specific file after the torrent finishes (range supported)
- `GET /api/torrents/:infoHash/files/:fileIndex/download` — download a file once the torrent completes
- `DELETE /api/torrents/:infoHash` — remove a torrent from the client

## Notes
- Playback and downloads unlock only after Transmission finishes the torrent (to ensure full files are on disk).
- Subtitle upload in the UI accepts `.vtt` or `.srt` and attaches the track to the current video element.
