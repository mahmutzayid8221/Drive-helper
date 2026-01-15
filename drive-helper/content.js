(() => {
  const CACHE = new Map(); // folderId -> counts
  const MARKS = new Map(); // itemId -> mark (işaretler)
  const INFLIGHT = new Map();
  let isScanning = false;
  const STORAGE_KEY = 'drivehelper_marks';

  // İşaretleri localStorage'dan yükle
  function loadMarks() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        Object.entries(data).forEach(([k, v]) => MARKS.set(k, v));
      }
    } catch (e) {
      console.error('Marks load error:', e);
    }
  }

  // İşaretleri localStorage'a kaydet
  function saveMarks() {
    try {
      const data = Object.fromEntries(MARKS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Marks save error:', e);
    }
  }

  // İşaret tipleri
  const MARK_TYPES = [
    { id: 'none', icon: '⚪', label: 'Temizle' },
    { id: 'done', icon: '✅', label: 'Tamamlandı' },
    { id: 'wait', icon: '⏳', label: 'Bekliyor' },
    { id: 'star', icon: '⭐', label: 'Önemli' },
    { id: 'warn', icon: '⚠️', label: 'Dikkat' },
    { id: 'no', icon: '❌', label: 'İptal' }
  ];

  function ensureBar() {
    let bar = document.getElementById("dh_bar");
    if (bar) return bar;

    bar = document.createElement("div");
    bar.id = "dh_bar";

    const status = document.createElement("span");
    status.id = "dh_status";
    status.textContent = "DriveHelper";

    const btnScan = document.createElement("button");
    btnScan.textContent = "📊 Tara";
    btnScan.onclick = () => scanAllFolders();

    const btnClear = document.createElement("button");
    btnClear.textContent = "🗑️ Temizle";
    btnClear.onclick = () => clearAll();

    bar.appendChild(status);
    bar.appendChild(btnScan);
    bar.appendChild(btnClear);
    document.documentElement.appendChild(bar);
    return bar;
  }

  function setStatus(text, level = "") {
    ensureBar();
    const el = document.getElementById("dh_status");
    if (el) el.textContent = "DriveHelper: " + text;
    const bar = document.getElementById("dh_bar");
    if (bar) {
      bar.style.background =
        level === "ok" ? "rgba(15, 157, 88, 0.95)" :
          level === "warn" ? "rgba(251, 188, 4, 0.95)" :
            level === "err" ? "rgba(234, 67, 53, 0.95)" :
              "rgba(26, 115, 232, 0.95)";
    }
  }

  function clearAll() {
    CACHE.clear();
    MARKS.clear();
    saveMarks(); // Kayıtları da temizle
    document.querySelectorAll('.dh_counts').forEach(el => el.remove());
    document.querySelectorAll('.dh_mark').forEach(el => el.remove());
    document.querySelectorAll('.dh_mark_menu').forEach(el => el.remove());
    document.querySelectorAll('[role="row"]').forEach(r => delete r.dataset.dh_done);
    setStatus("Temizlendi", "");
  }

  function isRowFolder(row) {
    const labels = row.querySelectorAll('[aria-label]');
    for (const el of labels) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      if ((label.includes('klasör') || label.includes('klasor') || label.includes('folder')) && !label.includes('.')) {
        return true;
      }
    }
    const svg = row.querySelector('svg');
    if (svg) {
      const path = svg.innerHTML || '';
      if (path.includes('M10 4H4') || path.includes('M20 6h-8l-2-2')) {
        return true;
      }
    }
    return false;
  }

  function getFileType(name) {
    name = (name || '').toLowerCase();
    if (/\.pdf\b/i.test(name)) return 'pdf';
    if (/\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v)\b/i.test(name)) return 'video';
    if (/\.(mp3|wav|ogg|m4a|aac|flac|wma)\b/i.test(name)) return 'audio';
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|heic)\b/i.test(name)) return 'image';
    if (/\.(doc|docx|xls|xlsx|ppt|pptx|txt|rtf|odt|ods|odp)\b/i.test(name)) return 'doc';
    return 'other';
  }

  function getFolderId(row) {
    return row.getAttribute("data-id") || null;
  }

  function ensureCountsUI(row) {
    let box = row.querySelector(".dh_counts");
    if (box) return box;

    box = document.createElement("div");
    box.className = "dh_counts";

    const cells = row.querySelectorAll('[role="gridcell"]');
    const targetCell = cells[0] || row;
    targetCell.appendChild(box);
    return box;
  }

  // İşaret butonu ekle
  function ensureMarkUI(row) {
    let markBtn = row.querySelector(".dh_mark");
    if (markBtn) return markBtn;

    const itemId = getFolderId(row);
    if (!itemId) return null;

    markBtn = document.createElement("button");
    markBtn.className = "dh_mark";
    markBtn.title = "İşaretle";

    // Mevcut işareti göster
    const currentMark = MARKS.get(itemId);
    if (currentMark) {
      const markType = MARK_TYPES.find(m => m.id === currentMark);
      markBtn.textContent = markType ? markType.icon : '⚪';
    } else {
      markBtn.textContent = '⚪';
    }

    markBtn.onmousedown = (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    markBtn.onclick = (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      showMarkMenu(row, itemId, markBtn);
      return false;
    };

    const cells = row.querySelectorAll('[role="gridcell"]');
    const targetCell = cells[0] || row;
    targetCell.insertBefore(markBtn, targetCell.firstChild);
    return markBtn;
  }

  function showMarkMenu(row, itemId, markBtn) {
    // Mevcut menüyü kapat
    document.querySelectorAll('.dh_mark_menu').forEach(el => el.remove());

    const menu = document.createElement("div");
    menu.className = "dh_mark_menu";

    MARK_TYPES.forEach(mark => {
      const btn = document.createElement("button");
      btn.textContent = mark.icon + " " + mark.label;
      btn.onmousedown = (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
      };
      btn.onclick = (e) => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();

        if (mark.id === 'none') {
          MARKS.delete(itemId);
          markBtn.textContent = '⚪';
        } else {
          MARKS.set(itemId, mark.id);
          markBtn.textContent = mark.icon;
        }
        saveMarks();
        menu.remove();
        updateMarkCount();
        return false;
      };
      menu.appendChild(btn);
    });

    // Menüyü konumlandır
    const rect = markBtn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 5) + 'px';
    menu.style.left = rect.left + 'px';

    document.body.appendChild(menu);

    // Dışarı tıklayınca kapat
    setTimeout(() => {
      const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      };
      document.addEventListener('click', closeMenu);
    }, 100);
  }

  function updateMarkCount() {
    const total = MARKS.size;
    const done = [...MARKS.values()].filter(m => m === 'done').length;
    if (total > 0) {
      setStatus(done + "/" + total + " işaretli", "ok");
    }
  }

  function fmt(c) {
    const parts = [];
    if (c.pdf > 0) parts.push('<span class="dh_chip dh_pdf">📄' + c.pdf + '</span>');
    if (c.video > 0) parts.push('<span class="dh_chip dh_video">🎬' + c.video + '</span>');
    if (c.audio > 0) parts.push('<span class="dh_chip dh_audio">🎵' + c.audio + '</span>');
    if (c.image > 0) parts.push('<span class="dh_chip dh_image">🖼️' + c.image + '</span>');
    if (c.doc > 0) parts.push('<span class="dh_chip dh_doc">📝' + c.doc + '</span>');
    if (c.other > 0) parts.push('<span class="dh_chip dh_other">📁' + c.other + '</span>');

    const total = c.pdf + c.video + c.audio + c.image + c.doc + c.other;
    if (total === 0) return '<span class="dh_chip dh_empty">boş</span>';
    return parts.join("");
  }

  async function fetchFolderContents(folderId, forceRefresh = false) {
    if (!forceRefresh && CACHE.has(folderId)) {
      return CACHE.get(folderId);
    }

    if (INFLIGHT.has(folderId)) return INFLIGHT.get(folderId);

    const p = (async () => {
      const counts = await loadFolderContents(folderId);
      CACHE.set(folderId, counts);
      return counts;
    })().finally(() => INFLIGHT.delete(folderId));

    INFLIGHT.set(folderId, p);
    return p;
  }

  async function loadFolderContents(folderId) {
    try {
      const url = 'https://drive.google.com/drive/folders/' + folderId;
      const res = await fetch(url, { credentials: 'include' });
      const html = await res.text();

      const counts = { pdf: 0, video: 0, audio: 0, image: 0, doc: 0, other: 0 };
      const seenFiles = new Set();

      const tooltipMatches = html.matchAll(/data-tooltip="([^"]+)"/g);
      for (const m of tooltipMatches) {
        const name = m[1];
        if (seenFiles.has(name)) continue;

        if (/klasör|folder/i.test(name) && !/\.\w{2,4}$/i.test(name)) continue;

        const type = getFileType(name);
        if (type && type !== 'other') {
          seenFiles.add(name);
          counts[type]++;
        }
      }

      if (seenFiles.size === 0) {
        const pdfMatches = html.match(/[^"\/\\]+\.pdf(?=["'\s\],<>])/gi) || [];
        const videoMatches = html.match(/[^"\/\\]+\.(mp4|mkv|avi|mov|webm)(?=["'\s\],<>])/gi) || [];
        const audioMatches = html.match(/[^"\/\\]+\.(mp3|wav|ogg|m4a|aac|flac)(?=["'\s\],<>])/gi) || [];
        const imageMatches = html.match(/[^"\/\\]+\.(jpg|jpeg|png|gif|webp)(?=["'\s\],<>])/gi) || [];

        new Set(pdfMatches).forEach(() => counts.pdf++);
        new Set(videoMatches).forEach(() => counts.video++);
        new Set(audioMatches).forEach(() => counts.audio++);
        new Set(imageMatches).forEach(() => counts.image++);
      }

      return counts;
    } catch (e) {
      console.error('Fetch error:', folderId, e);
      return { pdf: 0, video: 0, audio: 0, image: 0, doc: 0, other: 0 };
    }
  }

  async function scanAllFolders() {
    if (isScanning) {
      setStatus("Zaten taranıyor...", "warn");
      return;
    }

    isScanning = true;
    setStatus("Klasörler aranıyor...", "warn");

    const rows = document.querySelectorAll('[role="row"][data-id]');
    const folders = [];

    for (const row of rows) {
      const folderId = getFolderId(row);
      if (!folderId) continue;
      if (isRowFolder(row)) {
        folders.push({ row, folderId });
      }
    }

    if (folders.length === 0) {
      setStatus("Klasör bulunamadı", "err");
      isScanning = false;
      return;
    }

    folders.forEach(({ row }) => {
      const box = ensureCountsUI(row);
      box.innerHTML = '<span class="dh_chip dh_loading">⏳</span>';
    });

    setStatus(folders.length + " klasör taranıyor...", "warn");

    const BATCH_SIZE = 5;
    let success = 0;

    for (let i = 0; i < folders.length; i += BATCH_SIZE) {
      const batch = folders.slice(i, i + BATCH_SIZE);

      setStatus(Math.min(i + BATCH_SIZE, folders.length) + "/" + folders.length + " taranıyor...", "warn");

      await Promise.all(batch.map(async ({ row, folderId }) => {
        const box = ensureCountsUI(row);
        try {
          const counts = await fetchFolderContents(folderId, true);
          box.innerHTML = fmt(counts);
          const total = counts.pdf + counts.video + counts.audio + counts.image + counts.doc + counts.other;
          if (total > 0) success++;
        } catch (e) {
          box.innerHTML = '<span class="dh_chip dh_err">❌</span>';
        }
        row.dataset.dh_done = "1";
      }));
    }

    setStatus("✅ " + success + "/" + folders.length + " tarandı", success > 0 ? "ok" : "err");
    isScanning = false;
  }

  function getCurrentFolderId() {
    const m = location.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function showCachedResults() {
    const rows = document.querySelectorAll('[role="row"][data-id]');

    for (const row of rows) {
      const itemId = getFolderId(row);
      if (!itemId) continue;

      // İşaret butonunu ekle (tüm satırlara)
      ensureMarkUI(row);

      // Sadece klasörler için sayım göster
      if (!isRowFolder(row)) continue;

      if (CACHE.has(itemId)) {
        const box = ensureCountsUI(row);
        box.innerHTML = fmt(CACHE.get(itemId));
        row.dataset.dh_done = "1";
      }
    }
  }

  let lastFileCount = 0;
  let currentParentFolder = null;

  function watchCurrentFolder() {
    const currentFolderId = getCurrentFolderId();
    if (!currentFolderId) return;

    const rows = document.querySelectorAll('[role="row"][data-id]');
    let fileCount = 0;

    for (const row of rows) {
      if (!isRowFolder(row)) {
        fileCount++;
      }
    }

    if (currentParentFolder === currentFolderId && fileCount !== lastFileCount && lastFileCount > 0) {
      updateCurrentFolderCache(currentFolderId);
    }

    lastFileCount = fileCount;
    currentParentFolder = currentFolderId;
  }

  async function updateCurrentFolderCache(folderId) {
    const rows = document.querySelectorAll('[role="row"][data-id]');
    const counts = { pdf: 0, video: 0, audio: 0, image: 0, doc: 0, other: 0 };

    for (const row of rows) {
      if (isRowFolder(row)) continue;

      let name = '';
      const nameEl = row.querySelector('[data-tooltip]');
      if (nameEl) {
        name = nameEl.getAttribute('data-tooltip') || '';
      }

      const type = getFileType(name);
      if (type) counts[type]++;
    }

    CACHE.set(folderId, counts);
    setStatus("Güncellendi!", "ok");

    setTimeout(() => {
      if (!isScanning) {
        const cacheSize = CACHE.size;
        if (cacheSize > 0) {
          setStatus(cacheSize + " klasör önbellekte", "ok");
        } else {
          setStatus("Hazır", "");
        }
      }
    }, 2000);
  }

  function init() {
    loadMarks(); // İşaretleri yükle
    ensureBar();
    setStatus("Hazır", "");

    let lastUrl = location.href;

    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(showCachedResults, 500);
      }

      watchCurrentFolder();
    }, 1000);

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (!isScanning && !debounceTimer) {
        debounceTimer = setTimeout(() => {
          showCachedResults();
          debounceTimer = null;
        }, 800);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    setTimeout(showCachedResults, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }
})();

