const torrentListEl = document.getElementById('torrent-list');
const magnetForm = document.getElementById('magnet-form');
const fileForm = document.getElementById('file-form');
const video = document.getElementById('video');
const subtitleInput = document.getElementById('subtitleInput');
const toast = document.getElementById('toast');
const statCount = document.getElementById('stat-count');
const statSpeed = document.getElementById('stat-speed');
const statPeers = document.getElementById('stat-peers');
const scrollToForm = document.getElementById('scrollToForm');
const refreshBtn = document.getElementById('refresh');

const formatBytes = (bytes) => {
  if (!bytes || Number.isNaN(bytes)) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / 1024 ** i).toFixed(2)} ${sizes[i]}`;
};

const formatSpeed = (bytesPerSec) => `${formatBytes(bytesPerSec)}/s`;

const showToast = (message, tone = 'info') => {
  toast.textContent = message;
  toast.className = `toast ${tone}`;
  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => toast.classList.remove('visible'), 3200);
};

const fetchTorrents = async () => {
  try {
    const res = await fetch('/api/torrents');
    const data = await res.json();
    const list = data.torrents || [];
    renderTorrents(list);
    updateStats(list);
  } catch (error) {
    console.error('Failed to fetch torrents', error);
    showToast('Unable to refresh torrents', 'error');
  }
};

const updateStats = (torrents) => {
  statCount.textContent = torrents.length;
  const totalSpeed = torrents.reduce((sum, t) => sum + (t.downloadSpeed || 0), 0);
  const totalPeers = torrents.reduce((sum, t) => sum + (t.numPeers || 0), 0);
  statSpeed.textContent = formatSpeed(totalSpeed);
  statPeers.textContent = totalPeers;
};

const renderProgress = (progress) => `
  <div class="progress">
    <div class="bar" style="width:${progress}%"></div>
    <span>${progress}%</span>
  </div>
`;

const renderTorrents = (torrents) => {
  torrentListEl.innerHTML = '';
  if (!torrents.length) {
    torrentListEl.innerHTML = '<p class="muted">No torrents yet. Add a magnet or upload a file to start.</p>';
    return;
  }

  torrents.forEach((t) => {
    const el = document.createElement('div');
    const isReady = Boolean(t.ready);
    const readyText = isReady ? 'Ready to play & download' : 'Downloading… wait to play';
    el.className = 'torrent';
    el.innerHTML = `
      <div class="torrent-header">
        <div>
          <h3>${t.name || 'Unknown torrent'}</h3>
          <p class="muted">${readyText} · ${formatBytes(t.totalSize || 0)}</p>
        </div>
        <div class="meta">
          <span>${formatSpeed(t.downloadSpeed)} ↓</span>
          <span>${formatSpeed(t.uploadSpeed)} ↑</span>
          <span>${t.numPeers} peers</span>
        </div>
      </div>
      ${renderProgress(t.progress || 0)}
      <div class="files">${t.files
        .map((file) => {
          const downloadHref = isReady
            ? `/api/torrents/${t.infoHash}/files/${file.index}/download`
            : '#';
          const disabledClass = isReady ? '' : 'disabled';
          const downloadAttrs = isReady
            ? `href="${downloadHref}" target="_blank"`
            : 'aria-disabled="true" tabindex="-1"';

          return `
            <div class="file-row">
              <div>
                <div class="file-name">${file.name}</div>
                <div class="badge">${formatBytes(file.length)}</div>
              </div>
              <div class="actions">
                <button data-stream="${t.infoHash}" data-index="${file.index}" class="primary ghost" ${isReady ? '' : 'disabled'}>Play</button>
                <a class="ghost ${disabledClass}" ${downloadAttrs}>Download</a>
              </div>
            </div>
          `;
        })
        .join('')}</div>
      <div class="actions footer">
        <button data-refresh="${t.infoHash}" class="ghost">Refresh</button>
        <button data-delete="${t.infoHash}" class="danger">Remove</button>
      </div>
    `;
    torrentListEl.appendChild(el);
  });
};

magnetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const magnetUri = document.getElementById('magnetUri').value.trim();
  if (!magnetUri) return;

  try {
    await fetch('/api/torrents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnetUri }),
    });
    showToast('Magnet added. Pulling metadata...');
    magnetForm.reset();
    fetchTorrents();
  } catch (error) {
    console.error(error);
    showToast('Failed to add magnet link', 'error');
  }
});

fileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(fileForm);
  if (!formData.get('torrent')) {
    showToast('Choose a .torrent file first', 'error');
    return;
  }

  try {
    await fetch('/api/torrents', { method: 'POST', body: formData });
    showToast('Torrent file uploaded');
    fileForm.reset();
    fetchTorrents();
  } catch (error) {
    console.error(error);
    showToast('Failed to upload torrent', 'error');
  }
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
    showToast('Torrent removed');
  }

  if (refreshBtn) {
    fetchTorrents();
  }
});

const playTorrent = (infoHash, index) => {
  const src = `/api/torrents/${infoHash}/stream?fileIndex=${index}`;
  video.src = src;
  video.play();
};

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

if (scrollToForm) {
  scrollToForm.addEventListener('click', () => {
    document.getElementById('formCard')?.scrollIntoView({ behavior: 'smooth' });
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', fetchTorrents);
}

fetchTorrents();
setInterval(fetchTorrents, 5000);
