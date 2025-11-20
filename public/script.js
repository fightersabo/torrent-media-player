const torrentListEl = document.getElementById('torrent-list');
const magnetForm = document.getElementById('magnet-form');
const fileForm = document.getElementById('file-form');
const video = document.getElementById('video');
const subtitleInput = document.getElementById('subtitleInput');

const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${sizes[i]}`;
};

const formatSpeed = (bytesPerSec) => `${formatBytes(bytesPerSec)}/s`;

async function fetchTorrents() {
  const res = await fetch('/api/torrents');
  const data = await res.json();
  renderTorrents(data.torrents || []);
}

function renderTorrents(torrents) {
  torrentListEl.innerHTML = '';
  if (!torrents.length) {
    torrentListEl.innerHTML = '<p class="muted">No torrents yet.</p>';
    return;
  }

  torrents.forEach((t) => {
    const el = document.createElement('div');
    el.className = 'torrent';
    el.innerHTML = `
      <h3>${t.name || 'Unknown torrent'}</h3>
      <div class="meta">
        <span>Progress: ${t.progress}%</span>
        <span>Peers: ${t.numPeers}</span>
        <span>Down: ${formatSpeed(t.downloadSpeed)}</span>
        <span>Up: ${formatSpeed(t.uploadSpeed)}</span>
      </div>
      <div class="files">${t.files
        .map(
          (file) => `
            <div class="file-row">
              <div>
                <div>${file.name}</div>
                <div class="badge">${formatBytes(file.length)}</div>
              </div>
              <div class="actions">
                <button data-stream="${t.infoHash}" data-index="${file.index}">Play</button>
                <a href="/api/torrents/${t.infoHash}/files/${file.index}/download" target="_blank">Download</a>
              </div>
            </div>
          `
        )
        .join('')}</div>
      <div class="actions" style="margin-top: 10px;">
        <button data-refresh="${t.infoHash}">Refresh</button>
        <button data-delete="${t.infoHash}">Remove</button>
      </div>
    `;
    torrentListEl.appendChild(el);
  });
}

magnetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const magnetUri = document.getElementById('magnetUri').value.trim();
  if (!magnetUri) return;
  await fetch('/api/torrents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnetUri }),
  });
  magnetForm.reset();
  fetchTorrents();
});

fileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(fileForm);
  await fetch('/api/torrents', {
    method: 'POST',
    body: formData,
  });
  fileForm.reset();
  fetchTorrents();
});

torrentListEl.addEventListener('click', async (e) => {
  const streamBtn = e.target.closest('button[data-stream]');
  const deleteBtn = e.target.closest('button[data-delete]');
  const refreshBtn = e.target.closest('button[data-refresh]');

  if (streamBtn) {
    const hash = streamBtn.getAttribute('data-stream');
    const index = streamBtn.getAttribute('data-index');
    playTorrent(hash, index);
  }

  if (deleteBtn) {
    const hash = deleteBtn.getAttribute('data-delete');
    await fetch(`/api/torrents/${hash}`, { method: 'DELETE' });
    fetchTorrents();
  }

  if (refreshBtn) {
    fetchTorrents();
  }
});

async function playTorrent(infoHash, index) {
  const src = `/api/torrents/${infoHash}/stream?fileIndex=${index}`;
  video.src = src;
  video.play();
}

subtitleInput.addEventListener('change', () => {
  const file = subtitleInput.files[0];
  if (!file) return;

  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = 'Custom';
  track.srclang = 'en';

  const reader = new FileReader();
  reader.onload = () => {
    const isSrt = file.name.toLowerCase().endsWith('.srt');
    const text = isSrt ? `WEBVTT\n\n${reader.result.replace(/,/g, '.')}` : reader.result;
    const blob = new Blob([text], { type: 'text/vtt' });
    track.src = URL.createObjectURL(blob);
    video.appendChild(track);
    track.mode = 'showing';
  };
  reader.readAsText(file);
});

fetchTorrents();
setInterval(fetchTorrents, 5000);
