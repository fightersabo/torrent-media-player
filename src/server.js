import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import morgan from 'morgan';
import WebTorrent from 'webtorrent';
import mime from 'mime-types';

const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const app = express();
const upload = multer();
const client = new WebTorrent();
const torrents = new Map();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(express.static(path.join(process.cwd(), 'public')));

const getTorrentSummary = (torrent) => ({
  infoHash: torrent.infoHash,
  name: torrent.name,
  progress: Number((torrent.progress * 100).toFixed(2)),
  downloaded: torrent.downloaded,
  downloadedMB: Number((torrent.downloaded / (1024 * 1024)).toFixed(2)),
  downloadSpeed: torrent.downloadSpeed,
  uploadSpeed: torrent.uploadSpeed,
  numPeers: torrent.numPeers,
  ready: torrent.ready,
  files: torrent.files.map((file, index) => ({
    name: file.name,
    length: file.length,
    path: file.path,
    index,
    mime: mime.lookup(file.name) || 'application/octet-stream',
  })),
});

const registerTorrent = (torrent) => {
  torrents.set(torrent.infoHash, torrent);
  torrent.on('done', () => {
    console.log(`Torrent ${torrent.name} finished downloading.`);
  });
};

const addTorrentAndWait = (source) =>
  new Promise((resolve, reject) => {
    const isMagnet = typeof source === 'string';
    const existing = isMagnet ? client.get(source) : null;

    if (existing) {
      registerTorrent(existing);
      return resolve(existing);
    }

    const torrent = client.add(source, { path: DOWNLOAD_DIR });

    torrent.once('error', (err) => {
      console.error('Torrent error:', err);
      reject(err);
    });

    torrent.once('ready', () => {
      registerTorrent(torrent);
      resolve(torrent);
    });
  });

app.get('/api/torrents', (req, res) => {
  const list = Array.from(torrents.values()).map((t) => getTorrentSummary(t));
  res.json({ torrents: list });
});

app.post('/api/torrents', upload.single('torrent'), async (req, res) => {
  const { magnetUri } = req.body;
  const torrentFile = req.file;

  if (!magnetUri && !torrentFile) {
    return res.status(400).json({ error: 'Provide a magnetUri or upload a .torrent file.' });
  }

  try {
    const torrent = await addTorrentAndWait(magnetUri ? magnetUri.trim() : torrentFile.buffer);
    res.status(201).json({ torrent: getTorrentSummary(torrent) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add torrent', details: error?.message });
  }
});

app.get('/api/torrents/:infoHash', (req, res) => {
  const torrent = torrents.get(req.params.infoHash);
  if (!torrent) {
    return res.status(404).json({ error: 'Torrent not found' });
  }
  res.json({ torrent: getTorrentSummary(torrent) });
});

app.get('/api/torrents/:infoHash/files', (req, res) => {
  const torrent = torrents.get(req.params.infoHash);
  if (!torrent) {
    return res.status(404).json({ error: 'Torrent not found' });
  }
  res.json({ files: torrent.files.map((file, index) => ({
    name: file.name,
    index,
    length: file.length,
    mime: mime.lookup(file.name) || 'application/octet-stream',
  })) });
});

app.get('/api/torrents/:infoHash/files/:fileIndex/download', (req, res) => {
  const torrent = torrents.get(req.params.infoHash);
  const fileIndex = Number(req.params.fileIndex);

  if (!torrent) {
    return res.status(404).json({ error: 'Torrent not found' });
  }

  const file = torrent.files[fileIndex];
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', mime.lookup(file.name) || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.setHeader('Content-Length', file.length);
  file.createReadStream().pipe(res);
});

app.get('/api/torrents/:infoHash/stream', (req, res) => {
  const torrent = torrents.get(req.params.infoHash);
  const fileIndex = Number(req.query.fileIndex || 0);

  if (!torrent) {
    return res.status(404).json({ error: 'Torrent not found' });
  }

  const file = torrent.files[fileIndex];
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const range = req.headers.range;
  const mimeType = mime.lookup(file.name) || 'application/octet-stream';

  const size = file.length;
  let start = 0;
  let end = size - 1;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    start = parseInt(parts[0], 10);
    end = parts[1] ? parseInt(parts[1], 10) : end;
  }

  const sizeSafe = size - 1;
  if (start < 0 || end > sizeSafe || start > end) {
    return res.status(416).json({ error: 'Requested range not satisfiable' });
  }

  const chunkSize = end - start + 1;
  const stream = file.createReadStream({ start, end });

  res.writeHead(range ? 206 : 200, {
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': mimeType,
  });

  stream.pipe(res);
});

app.delete('/api/torrents/:infoHash', (req, res) => {
  const torrent = torrents.get(req.params.infoHash);
  if (!torrent) {
    return res.status(404).json({ error: 'Torrent not found' });
  }

  torrent.destroy(() => {
    torrents.delete(req.params.infoHash);
    res.json({ success: true });
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Torrent media server running on http://localhost:${PORT}`);
  console.log(`Downloads directory: ${DOWNLOAD_DIR}`);
});
