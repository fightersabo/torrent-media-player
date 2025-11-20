import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import morgan from 'morgan';
import mime from 'mime-types';
import Transmission from 'transmission';

const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');
const TMP_DIR = path.join(DOWNLOAD_DIR, '.tmp');

const transmission = new Transmission({
  host: process.env.TRANSMISSION_HOST || 'localhost',
  port: Number(process.env.TRANSMISSION_PORT) || 9091,
  username: process.env.TRANSMISSION_USER,
  password: process.env.TRANSMISSION_PASSWORD,
});

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const app = express();
const upload = multer();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(express.static(path.join(process.cwd(), 'public')));

const TORRENT_FIELDS = [
  'id',
  'name',
  'hashString',
  'percentDone',
  'rateDownload',
  'rateUpload',
  'peersConnected',
  'totalSize',
  'downloadedEver',
  'uploadedEver',
  'downloadDir',
  'files',
  'leftUntilDone',
  'eta',
  'status',
];

const transmissionGet = (ids = null) =>
  new Promise((resolve, reject) => {
    transmission.get(ids, { fields: TORRENT_FIELDS }, (err, result) => {
      if (err) return reject(err);
      resolve(result?.torrents || []);
    });
  });

const toProgress = (percentDone = 0) => Number(((percentDone || 0) * 100).toFixed(2));
const isComplete = (torrent) => (torrent?.percentDone || 0) >= 1 && (torrent?.leftUntilDone || 0) === 0;

const toSummary = (torrent) => ({
  id: torrent.id,
  infoHash: torrent.hashString,
  name: torrent.name,
  progress: toProgress(torrent.percentDone),
  downloaded: torrent.downloadedEver,
  totalSize: torrent.totalSize,
  downloadSpeed: torrent.rateDownload,
  uploadSpeed: torrent.rateUpload,
  numPeers: torrent.peersConnected,
  ready: isComplete(torrent),
  files:
    torrent.files?.map((file, index) => ({
      name: path.basename(file.name),
      length: file.length,
      bytesCompleted: file.bytesCompleted,
      path: file.name,
      index,
      mime: mime.lookup(file.name) || 'application/octet-stream',
    })) || [],
});

const findTorrentByHash = async (infoHash) => {
  const torrents = await transmissionGet([infoHash]);
  if (!torrents.length) {
    const err = new Error('Torrent not found');
    err.status = 404;
    throw err;
  }
  return torrents[0];
};

const resolveFilePath = (torrent, file) => {
  const baseDir = torrent.downloadDir || DOWNLOAD_DIR;
  const fullPath = path.normalize(path.join(baseDir, file.name));
  const normalizedBase = path.normalize(baseDir);
  if (!fullPath.startsWith(normalizedBase)) {
    const err = new Error('Invalid file path');
    err.status = 400;
    throw err;
  }
  return fullPath;
};

const sendRangeOrFile = (res, filePath, mimeType, range) => {
  const stats = fs.statSync(filePath);
  const size = stats.size;

  if (!range) {
    res.writeHead(200, {
      'Content-Length': size,
      'Content-Type': mimeType,
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  const parts = range.replace(/bytes=/, '').split('-');
  let start = parseInt(parts[0], 10);
  let end = parts[1] ? parseInt(parts[1], 10) : size - 1;
  const sizeSafe = size - 1;

  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end)) end = sizeSafe;
  if (start < 0 || end > sizeSafe || start > end) {
    return res.status(416).json({ error: 'Requested range not satisfiable' });
  }

  const chunkSize = end - start + 1;
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': mimeType,
  });

  return fs.createReadStream(filePath, { start, end }).pipe(res);
};

app.get('/api/torrents', async (_req, res) => {
  try {
    const torrents = await transmissionGet();
    res.json({ torrents: torrents.map((t) => toSummary(t)) });
  } catch (error) {
    console.error('Failed to list torrents', error);
    res.status(500).json({ error: 'Failed to list torrents' });
  }
});

app.post('/api/torrents', upload.single('torrent'), async (req, res) => {
  const { magnetUri } = req.body;
  const torrentFile = req.file;

  if (!magnetUri && !torrentFile) {
    return res.status(400).json({ error: 'Provide a magnetUri or upload a .torrent file.' });
  }

  try {
    const addedTorrent = await new Promise((resolve, reject) => {
      if (magnetUri) {
        return transmission.addUrl(
          magnetUri.trim(),
          { 'download-dir': DOWNLOAD_DIR },
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          },
        );
      }

      const tmpPath = path.join(TMP_DIR, `${Date.now()}-${torrentFile.originalname}`);
      fs.writeFile(tmpPath, torrentFile.buffer, (writeErr) => {
        if (writeErr) return reject(writeErr);
        transmission.addFile(
          tmpPath,
          { 'download-dir': DOWNLOAD_DIR },
          (err, result) => {
            fs.unlink(tmpPath, () => {});
            if (err) return reject(err);
            resolve(result);
          },
        );
      });
    });

    const torrent = await findTorrentByHash(addedTorrent.hashString);
    res.status(201).json({ torrent: toSummary(torrent) });
  } catch (error) {
    console.error('Failed to add torrent', error);
    res.status(500).json({ error: 'Failed to add torrent', details: error?.message });
  }
});

app.get('/api/torrents/:infoHash', async (req, res) => {
  try {
    const torrent = await findTorrentByHash(req.params.infoHash);
    res.json({ torrent: toSummary(torrent) });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to load torrent' });
  }
});

app.get('/api/torrents/:infoHash/files', async (req, res) => {
  try {
    const torrent = await findTorrentByHash(req.params.infoHash);
    res.json({ files: toSummary(torrent).files });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to list files' });
  }
});

app.get('/api/torrents/:infoHash/files/:fileIndex/download', async (req, res) => {
  try {
    const torrent = await findTorrentByHash(req.params.infoHash);
    const fileIndex = Number(req.params.fileIndex);
    const file = torrent.files?.[fileIndex];

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!isComplete(torrent)) {
      return res.status(409).json({ error: 'Torrent must be fully downloaded before downloading files.' });
    }

    const filePath = resolveFilePath(torrent, file);
    const mimeType = mime.lookup(file.name) || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file.name)}"`);
    res.setHeader('Content-Length', file.length);

    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    const status = error.status || 500;
    console.error('Download error', error);
    res.status(status).json({ error: error.message || 'Failed to download file' });
  }
});

app.get('/api/torrents/:infoHash/stream', async (req, res) => {
  try {
    const torrent = await findTorrentByHash(req.params.infoHash);
    const fileIndex = Number(req.query.fileIndex || 0);
    const file = torrent.files?.[fileIndex];

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!isComplete(torrent)) {
      return res.status(409).json({ error: 'Torrent must finish downloading before playback.' });
    }

    const filePath = resolveFilePath(torrent, file);
    const mimeType = mime.lookup(file.name) || 'application/octet-stream';

    return sendRangeOrFile(res, filePath, mimeType, req.headers.range);
  } catch (error) {
    const status = error.status || 500;
    console.error('Stream error', error);
    res.status(status).json({ error: error.message || 'Failed to stream file' });
  }
});

app.delete('/api/torrents/:infoHash', async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      transmission.remove(req.params.infoHash, true, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    res.json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    console.error('Failed to remove torrent', error);
    res.status(status).json({ error: error.message || 'Failed to remove torrent' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Torrent media server running on http://localhost:${PORT}`);
  console.log(`Downloads directory: ${DOWNLOAD_DIR}`);
});
