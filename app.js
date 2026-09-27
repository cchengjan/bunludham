/**
 * Photo Frame Studio — Client Application
 * Full implementation covering Phase 2 through Phase 22
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // DOM Elements
  // ---------------------------------------------------------------
  const screenPicker = document.getElementById('screen-picker');
  const screenEditor = document.getElementById('screen-editor');

  const searchInput = document.getElementById('searchInput');
  const categoryChips = document.getElementById('categoryChips');
  const frameGrid = document.getElementById('frameGrid');
  const emptyState = document.getElementById('emptyState');

  const backToPicker = document.getElementById('backToPicker');
  const frameNameTxt = document.getElementById('frameNameTxt');
  const fileInput = document.getElementById('fileInput');
  const choosePhotoLabel = document.getElementById('choosePhotoLabel');

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = document.getElementById('placeholder');

  const fitBtn = document.getElementById('fitBtn');
  const resetBtn = document.getElementById('resetBtn');
  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const zoomVal = document.getElementById('zoomVal');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');

  // Adjustments & Filters
  const brightnessInput = document.getElementById('brightnessInput');
  const brightnessVal = document.getElementById('brightnessVal');
  const contrastInput = document.getElementById('contrastInput');
  const contrastVal = document.getElementById('contrastVal');
  const saturationInput = document.getElementById('saturationInput');
  const saturationVal = document.getElementById('saturationVal');
  const warmthInput = document.getElementById('warmthInput');
  const warmthVal = document.getElementById('warmthVal');
  const filterPresetBtns = document.querySelectorAll('.preset-btn');

  // Text / Quote
  const userCustomText = document.getElementById('userCustomText');
  const quickQuotesList = document.getElementById('quickQuotesList');

  // Action Buttons
  const createImageBtn = document.getElementById('createImageBtn');
  const uploadOriginalBtn = document.getElementById('uploadOriginalBtn');
  const toast = document.getElementById('toast');

  // Modals
  const celebrationModal = document.getElementById('celebrationModal');
  const celebrationPreview = document.getElementById('celebrationPreview');
  const modalDownloadBtn = document.getElementById('modalDownloadBtn');
  const modalSubmitActivityBtn = document.getElementById('modalSubmitActivityBtn');
  const modalCloseBtn = document.getElementById('modalCloseBtn');

  const confirmActivityModal = document.getElementById('confirmActivityModal');
  const activityCaptionInput = document.getElementById('activityCaptionInput');
  const btnConfirmSendActivity = document.getElementById('btnConfirmSendActivity');
  const btnCancelSendActivity = document.getElementById('btnCancelSendActivity');

  const reportModal = document.getElementById('reportModal');
  const reportReasonSelect = document.getElementById('reportReasonSelect');
  const btnSubmitReport = document.getElementById('btnSubmitReport');
  const btnCancelReport = document.getElementById('btnCancelReport');

  // Wall & Stats
  const activityGrid = document.getElementById('activityGrid');
  const statParticipants = document.getElementById('statParticipants');
  const statCreations = document.getElementById('statCreations');
  const statReactions = document.getElementById('statReactions');
  const heroQuoteDisplay = document.getElementById('heroQuoteDisplay');

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let allActiveFrames = [];
  let currentCategory = 'ทั้งหมด';
  let currentSearch = '';

  let currentFrame = null;
  const frameImg = new Image();
  let frameReady = false;

  let photoImg = null;
  let photoBlob = null;

  // Transform
  let scale = 1, offsetX = 0, offsetY = 0, coverScale = 1, maxScale = 1;

  // Adjustments
  let adjustments = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
    filter: 'original'
  };

  // Text
  let overlayText = '';
  let selectedAdminQuote = '';

  // History (Undo / Redo)
  const undoStack = [];
  const redoStack = [];
  let isPerformingHistoryAction = false;

  // Generated Result
  let lastExportBlob = null;
  let lastExportDataUrl = null;
  let activeReportingId = null;

  // ---------------------------------------------------------------
  // Toast Helper
  // ---------------------------------------------------------------
  function showToast(text, type = 'normal') {
    toast.textContent = text;
    toast.className = 'toast-msg show ' + (type === 'ok' ? 'ok' : type === 'err' ? 'err' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  // ---------------------------------------------------------------
  // Undo / Redo Management
  // ---------------------------------------------------------------
  function snapshotState() {
    return {
      scale,
      offsetX,
      offsetY,
      adjustments: { ...adjustments },
      overlayText,
      selectedAdminQuote
    };
  }

  function pushHistory() {
    if (isPerformingHistoryAction) return;
    undoStack.push(snapshotState());
    if (undoStack.length > 25) undoStack.shift();
    redoStack.length = 0; // Clear redo
    updateHistoryButtons();
  }

  function applyState(st) {
    isPerformingHistoryAction = true;
    scale = st.scale;
    offsetX = st.offsetX;
    offsetY = st.offsetY;
    adjustments = { ...st.adjustments };
    overlayText = st.overlayText;
    selectedAdminQuote = st.selectedAdminQuote;

    // Sync UI controls
    brightnessInput.value = adjustments.brightness;
    brightnessVal.textContent = adjustments.brightness;
    contrastInput.value = adjustments.contrast;
    contrastVal.textContent = adjustments.contrast;
    saturationInput.value = adjustments.saturation;
    saturationVal.textContent = adjustments.saturation;
    warmthInput.value = adjustments.warmth;
    warmthVal.textContent = adjustments.warmth;
    userCustomText.value = overlayText;

    filterPresetBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === adjustments.filter);
    });

    draw();
    isPerformingHistoryAction = false;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  undoBtn.addEventListener('click', () => {
    if (undoStack.length === 0) return;
    redoStack.push(snapshotState());
    const prev = undoStack.pop();
    applyState(prev);
  });

  redoBtn.addEventListener('click', () => {
    if (redoStack.length === 0) return;
    undoStack.push(snapshotState());
    const next = redoStack.pop();
    applyState(next);
  });

  // ---------------------------------------------------------------
  // Phase 3: Frame Gallery & Search
  // ---------------------------------------------------------------
  function frameMatchesSearch(frame, term) {
    if (!term) return true;
    const haystack = [frame.name, frame.category, ...(frame.keywords || [])].join(' ').toLowerCase();
    return haystack.includes(term.toLowerCase());
  }

  function renderCategoryChips(categories) {
    categoryChips.innerHTML = '';
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn' + (cat === currentCategory ? ' active' : '');
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        currentCategory = cat;
        renderGrid();
        [...categoryChips.children].forEach(c => c.classList.toggle('active', c.textContent === cat));
      });
      categoryChips.appendChild(btn);
    });
  }

  function renderGrid() {
    const filtered = allActiveFrames.filter(f => {
      const inCategory = currentCategory === 'ทั้งหมด' || f.category === currentCategory;
      return inCategory && frameMatchesSearch(f, currentSearch);
    });

    frameGrid.innerHTML = '';
    emptyState.classList.toggle('hidden', filtered.length > 0);

    filtered.forEach(frame => {
      const card = document.createElement('div');
      card.className = 'frame-card';
      card.innerHTML = `
        <div class="frame-thumb-box">
          <img src="${frame.thumbnail || frame.filename}" alt="${frame.name}" loading="lazy">
        </div>
        <div class="frame-card-info">
          <div class="frame-card-name">${frame.name}</div>
          <div class="frame-card-meta">
            <span class="frame-card-category">${frame.category || 'ทั่วไป'}</span>
            <span class="frame-card-action">เลือกกรอบ →</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => selectFrame(frame));
      frameGrid.appendChild(card);
    });
  }

  searchInput.addEventListener('input', e => {
    currentSearch = e.target.value.trim();
    renderGrid();
  });

  async function initPicker() {
    allActiveFrames = await FrameStore.getActive();
    const categories = await FrameStore.getCategories();
    renderCategoryChips(categories);
    renderGrid();
  }

  // ---------------------------------------------------------------
  // Phase 4: Photo Editor & Canvas System
  // ---------------------------------------------------------------
  function selectFrame(frame) {
    currentFrame = frame;
    frameNameTxt.textContent = frame.name;
    frameReady = false;

    frameImg.onload = () => {
      frameReady = true;
      canvas.width = frame.canvasWidth;
      canvas.height = frame.canvasHeight;
      stage.style.aspectRatio = `${frame.canvasWidth} / ${frame.canvasHeight}`;
      if (photoImg) fitToArea();
      else draw();
    };
    frameImg.src = frame.filename;

    screenPicker.classList.add('hidden');
    screenEditor.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  backToPicker.addEventListener('click', () => {
    screenEditor.classList.add('hidden');
    screenPicker.classList.remove('hidden');
  });

  function area() {
    // ให้ทุกกรอบวางภาพได้เต็มเฟรม (Full-frame canvas)
    return {
      x: 0,
      y: 0,
      width: canvas.width || (currentFrame && currentFrame.canvasWidth) || 1024,
      height: canvas.height || (currentFrame && currentFrame.canvasHeight) || 1024,
      borderRadius: 0
    };
  }

  function coverScaleFor(img) {
    const a = area();
    return Math.max(a.width / img.width, a.height / img.height);
  }

  function clampOffsets() {
    const a = area();
    const halfW = (photoImg.width * scale) / 2;
    const halfH = (photoImg.height * scale) / 2;
    const maxX = Math.max(0, halfW - a.width / 2);
    const maxY = Math.max(0, halfH - a.height / 2);
    offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
    offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
  }

  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  // ---------------------------------------------------------------
  // Phase 5: Photo Adjustments & Filters in Canvas
  // ---------------------------------------------------------------
  function getCanvasFilterString() {
    const b = 100 + adjustments.brightness;
    const c = 100 + adjustments.contrast;
    const s = 100 + adjustments.saturation;

    let fStr = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;

    switch (adjustments.filter) {
      case 'warm':
        fStr += ' sepia(20%)';
        break;
      case 'soft':
        fStr += ' brightness(105%) contrast(92%)';
        break;
      case 'classic':
        fStr += ' contrast(115%) sepia(10%)';
        break;
      case 'bw':
        fStr += ' grayscale(100%)';
        break;
      default:
        break;
    }
    return fStr;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (photoImg && currentFrame) {
      const a = area();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.clip();

      // Apply Filter & Color Adjustments
      ctx.filter = getCanvasFilterString();

      ctx.translate(canvas.width / 2 + offsetX, canvas.height / 2 + offsetY);
      ctx.scale(scale, scale);
      ctx.drawImage(photoImg, -photoImg.width / 2, -photoImg.height / 2);

      // Warmth Tint Overlay
      if (adjustments.warmth !== 0) {
        ctx.save();
        ctx.globalCompositeOperation = adjustments.warmth > 0 ? 'soft-light' : 'color';
        const alpha = Math.abs(adjustments.warmth) / 100 * 0.45;
        ctx.fillStyle = adjustments.warmth > 0 ? `rgba(245, 158, 11, ${alpha})` : `rgba(59, 130, 246, ${alpha})`;
        ctx.fillRect(-photoImg.width / 2, -photoImg.height / 2, photoImg.width, photoImg.height);
        ctx.restore();
      }

      ctx.restore();
    }

    // Frame Artwork always rendered on TOP layer at 1:1 scale
    if (frameReady) {
      ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
    }

    // Phase 16: Render Custom User Message / Blessing Overlay
    const textToShow = overlayText || selectedAdminQuote;
    if (textToShow && currentFrame) {
      drawTextOverlay(textToShow);
    }

    zoomVal.textContent = photoImg ? Math.round((scale / coverScale) * 100) + '%' : '100%';
  }

  function drawTextOverlay(text) {
    ctx.save();
    
    // Bottom banner inside photo area
    const bannerH = Math.max(50, Math.round(canvas.height * 0.055));
    const bannerY = canvas.height - bannerH - Math.round(canvas.height * 0.045);
    const bannerW = Math.round(canvas.width * 0.82);
    const bannerX = (canvas.width - bannerW) / 2;

    // Glassmorphism pill
    roundRectPath(ctx, bannerX, bannerY, bannerW, bannerH, bannerH / 2);
    ctx.fillStyle = 'rgba(12, 74, 69, 0.82)';
    ctx.fill();
    ctx.lineWidth = Math.max(2, Math.round(canvas.width * 0.0018));
    ctx.strokeStyle = 'rgba(212, 175, 55, 0.7)';
    ctx.stroke();

    // Text styling
    const fontSize = Math.max(20, Math.round(canvas.width * 0.023));
    ctx.font = `600 ${fontSize}px "Noto Sans Thai", "Sarabun", sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bannerX + bannerW / 2, bannerY + bannerH / 2 + 1, bannerW - 24);

    ctx.restore();
  }

  function fitToArea() {
    if (!photoImg || !currentFrame) return;
    coverScale = coverScaleFor(photoImg);
    maxScale = coverScale * 4;
    scale = coverScale;
    offsetX = 0;
    offsetY = 0;
    draw();
  }

  function setControlsEnabled(on) {
    [fitBtn, resetBtn, zoomIn, zoomOut, createImageBtn].forEach(b => (b.disabled = !on));
    uploadOriginalBtn.disabled = !on;
  }

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    photoBlob = file;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      photoImg = img;
      fitToArea();
      placeholder.style.display = 'none';
      choosePhotoLabel.innerHTML = '<span>🔄</span> เปลี่ยนรูปภาพ';
      setControlsEnabled(true);
      pushHistory();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

  fitBtn.addEventListener('click', () => {
    pushHistory();
    fitToArea();
  });

  resetBtn.addEventListener('click', () => {
    pushHistory();
    adjustments = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, filter: 'original' };
    overlayText = '';
    selectedAdminQuote = '';
    userCustomText.value = '';
    brightnessInput.value = 0;
    contrastInput.value = 0;
    saturationInput.value = 0;
    warmthInput.value = 0;
    brightnessVal.textContent = '0';
    contrastVal.textContent = '0';
    saturationVal.textContent = '0';
    warmthVal.textContent = '0';
    filterPresetBtns.forEach(b => b.classList.toggle('active', b.dataset.filter === 'original'));
    fitToArea();
  });

  zoomIn.addEventListener('click', () => {
    if (!photoImg) return;
    pushHistory();
    scale = Math.min(maxScale, scale * 1.15);
    clampOffsets();
    draw();
  });

  zoomOut.addEventListener('click', () => {
    if (!photoImg) return;
    pushHistory();
    scale = Math.max(coverScale, scale / 1.15);
    clampOffsets();
    draw();
  });

  // Slider adjustments
  brightnessInput.addEventListener('input', e => {
    adjustments.brightness = parseInt(e.target.value, 10);
    brightnessVal.textContent = adjustments.brightness;
    draw();
  });
  brightnessInput.addEventListener('change', pushHistory);

  contrastInput.addEventListener('input', e => {
    adjustments.contrast = parseInt(e.target.value, 10);
    contrastVal.textContent = adjustments.contrast;
    draw();
  });
  contrastInput.addEventListener('change', pushHistory);

  saturationInput.addEventListener('input', e => {
    adjustments.saturation = parseInt(e.target.value, 10);
    saturationVal.textContent = adjustments.saturation;
    draw();
  });
  saturationInput.addEventListener('change', pushHistory);

  warmthInput.addEventListener('input', e => {
    adjustments.warmth = parseInt(e.target.value, 10);
    warmthVal.textContent = adjustments.warmth;
    draw();
  });
  warmthInput.addEventListener('change', pushHistory);

  // Preset Filters
  filterPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pushHistory();
      filterPresetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      adjustments.filter = btn.dataset.filter;
      draw();
    });
  });

  // Custom User Text
  userCustomText.addEventListener('input', e => {
    overlayText = e.target.value.trim();
    if (overlayText) selectedAdminQuote = '';
    draw();
  });
  userCustomText.addEventListener('change', pushHistory);

  // Editor Tabs
  document.querySelectorAll('.editor-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.editor-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.remove('hidden');
    });
  });

  // ---------------------------------------------------------------
  // Pointer Events (Mouse, Touch, Pinch-to-zoom, Double-tap)
  // ---------------------------------------------------------------
  const pointers = new Map();
  let dragStart = null, pinchStart = null, lastTapTime = 0;

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  canvas.addEventListener('pointerdown', e => {
    if (!photoImg) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, getPos(e));

    const now = Date.now();
    if (pointers.size === 1 && now - lastTapTime < 300) {
      pushHistory();
      fitToArea();
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    if (pointers.size === 1) {
      const p = pointers.get(e.pointerId);
      dragStart = { ox: offsetX, oy: offsetY, sx: p.x, sy: p.y };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      dragStart = null;
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, getPos(e));

    if (pointers.size === 1 && dragStart) {
      const p = pointers.get(e.pointerId);
      offsetX = dragStart.ox + (p.x - dragStart.sx);
      offsetY = dragStart.oy + (p.y - dragStart.sy);
      clampOffsets();
      draw();
    } else if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      scale = Math.min(maxScale, Math.max(coverScale, pinchStart.scale * (dist / pinchStart.dist)));
      clampOffsets();
      draw();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      dragStart = { ox: offsetX, oy: offsetY, sx: p.x, sy: p.y };
    } else if (pointers.size === 0) {
      if (dragStart) pushHistory();
      dragStart = null;
    }
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', e => {
    if (!photoImg) return;
    e.preventDefault();
    scale = Math.min(maxScale, Math.max(coverScale, scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    clampOffsets();
    draw();
  }, { passive: false });

  // ---------------------------------------------------------------
  // Phase 9 & 10: Image Creation, Celebration & Confirmation
  // ---------------------------------------------------------------
  createImageBtn.addEventListener('click', () => {
    if (!photoImg) return;

    // Full export
    canvas.toBlob(blob => {
      if (!blob) return;
      lastExportBlob = blob;
      lastExportDataUrl = canvas.toDataURL('image/png');

      // Show Celebration Modal
      celebrationPreview.src = lastExportDataUrl;
      celebrationModal.classList.add('open');

      // Record creation stat
      ActivityStore.recordCreation();
      updateStats();
    }, 'image/png');
  });

  function currentFileBaseName() {
    const safe = (currentFrame ? currentFrame.name : 'photo-frame').replace(/[^\p{L}\p{N}_-]+/gu, '-');
    return `${safe}-${Date.now()}`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Modal Download Button
  modalDownloadBtn.addEventListener('click', async () => {
    if (!lastExportBlob) return;
    const filename = currentFileBaseName() + '.png';
    triggerDownload(lastExportBlob, filename);
    showToast('ดาวน์โหลดภาพเรียบร้อยแล้ว', 'ok');

    // Google Drive sync if configured
    if (DriveSync.isConfigured()) {
      try {
        await DriveSync.uploadFinished(lastExportBlob, filename, {
          frameId: currentFrame.id,
          frameName: currentFrame.name
        });
        showToast('สำรองภาพขึ้น Google Drive สำเร็จ', 'ok');
      } catch (err) {
        console.warn('Drive sync:', err);
      }
    }
  });

  // Modal Submit to Community Button
  modalSubmitActivityBtn.addEventListener('click', () => {
    celebrationModal.classList.remove('open');
    activityCaptionInput.value = '';
    confirmActivityModal.classList.add('open');
  });

  modalCloseBtn.addEventListener('click', () => {
    celebrationModal.classList.remove('open');
  });

  // Confirm Submit to Activity Wall
  btnConfirmSendActivity.addEventListener('click', async () => {
    if (!lastExportDataUrl) return;

    // Create compressed thumbnail for wall performance
    const thumbDataUrl = celebrationPreview.src;
    const caption = activityCaptionInput.value.trim();

    await ActivityStore.addSubmission({
      dataUrl: lastExportDataUrl,
      thumbnail: thumbDataUrl,
      caption,
      eventName: currentFrame ? currentFrame.name : 'กฐินคุณยายฯ',
      quoteText: overlayText || selectedAdminQuote
    });

    confirmActivityModal.classList.remove('open');
    showToast('ส่งภาพเข้าร่วมกิจกรรมเรียบร้อยแล้ว อนุโมทนาบุญครับ 🙏', 'ok');

    // Upload to Drive activity images if configured
    if (DriveSync.isConfigured() && lastExportBlob) {
      try {
        await DriveSync.uploadActivity(lastExportBlob, currentFileBaseName() + '-activity.png', {
          frameName: currentFrame.name,
          caption
        });
      } catch(e) {}
    }

    // Refresh Wall & Stats
    await renderActivityWall();
    await updateStats();

    // Scroll to activity wall
    document.getElementById('activity-wall').scrollIntoView({ behavior: 'smooth' });
  });

  btnCancelSendActivity.addEventListener('click', () => {
    confirmActivityModal.classList.remove('open');
  });

  // ---------------------------------------------------------------
  // Phase 10, 11, 17: Activity Wall, Reactions & Quote Cards
  // ---------------------------------------------------------------
  async function renderActivityWall() {
    const submissions = await ActivityStore.getActive();
    const quotes = await QuoteStore.getByPlacement('activity');

    activityGrid.innerHTML = '';

    if (submissions.length === 0 && quotes.length === 0) {
      activityGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <p style="font-size:1.05rem; font-weight:600; color:var(--deep-teal); margin-bottom:6px;">ยังไม่มีภาพในกิจกรรม</p>
          <p>ร่วมเป็นท่านแรกที่สร้างภาพและส่งภาพเข้าร่วมกิจกรรมมหากุศลนี้</p>
        </div>
      `;
      return;
    }

    // Mix submissions with quote cards
    let qIdx = 0;
    submissions.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'activity-card';
      card.innerHTML = `
        <div class="activity-card-header">
          <span class="activity-event-name">${item.eventName}</span>
          <span class="activity-date">${item.dateStr}</span>
        </div>
        <div class="activity-img-wrap">
          <img src="${item.thumbnail || item.dataUrl}" alt="Activity" loading="lazy">
        </div>
        ${item.caption ? `<p class="activity-caption">${item.caption}</p>` : ''}
        <div class="activity-reactions-bar">
          <button type="button" class="reaction-btn" data-id="${item.id}" data-type="sadhu">
            <span>🙏</span>
            <span>สาธุ</span>
            <span class="reaction-count">${item.reactions.sadhu || 0}</span>
          </button>
          <button type="button" class="reaction-btn" data-id="${item.id}" data-type="love">
            <span>❤️</span>
            <span class="reaction-count">${item.reactions.love || 0}</span>
          </button>
          <button type="button" class="reaction-btn" data-id="${item.id}" data-type="cheer">
            <span>👍</span>
            <span class="reaction-count">${item.reactions.cheer || 0}</span>
          </button>
          <button type="button" class="activity-menu-btn" data-id="${item.id}" title="รายงานเนื้อหา">⋯</button>
        </div>
      `;

      activityGrid.appendChild(card);

      // Interleave inspirational quote card every 3-4 cards
      if ((index + 1) % 3 === 0 && qIdx < quotes.length) {
        const q = quotes[qIdx++];
        const qCard = document.createElement('div');
        qCard.className = 'activity-quote-card';
        qCard.innerHTML = `
          <div class="activity-quote-symbol">🪷</div>
          <div class="activity-quote-body">“${q.text}”</div>
          <div class="activity-quote-tag">${q.category}</div>
        `;
        activityGrid.appendChild(qCard);
      }
    });

    // Attach reaction handlers
    activityGrid.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const type = btn.dataset.type;
        btn.classList.add('reacted');
        const updated = await ActivityStore.react(id, type);
        if (updated) {
          btn.querySelector('.reaction-count').textContent = updated[type];
        }
        updateStats();
      });
    });

    // Report content handlers
    activityGrid.querySelectorAll('.activity-menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeReportingId = btn.dataset.id;
        reportModal.classList.add('open');
      });
    });
  }

  // Report Modal handlers
  btnSubmitReport.addEventListener('click', async () => {
    if (!activeReportingId) return;
    const reason = reportReasonSelect.value;
    await ActivityStore.report(activeReportingId, reason);
    reportModal.classList.remove('open');
    showToast('ขอบคุณสำหรับรายงาน ทีมงานจะตรวจสอบเนื้อหานี้', 'ok');
    activeReportingId = null;
  });

  btnCancelReport.addEventListener('click', () => {
    reportModal.classList.remove('open');
    activeReportingId = null;
  });

  // ---------------------------------------------------------------
  // Phase 12: Activity Statistics (Genuine System Data)
  // ---------------------------------------------------------------
  async function updateStats() {
    const stats = await ActivityStore.getStats();
    if (!stats.hasData) {
      statParticipants.textContent = '0';
      statCreations.textContent = '0';
      statReactions.textContent = '0';
    } else {
      statParticipants.textContent = stats.totalParticipants.toLocaleString('th-TH');
      statCreations.textContent = stats.totalCreations.toLocaleString('th-TH');
      statReactions.textContent = stats.totalReactions.toLocaleString('th-TH');
    }
  }

  // ---------------------------------------------------------------
  // Phase 13, 14, 15: Quote Library Integration
  // ---------------------------------------------------------------
  async function initQuotes() {
    // Hero Quote (home placement)
    const homeQuotes = await QuoteStore.getByPlacement('home');
    if (homeQuotes.length > 0) {
      const randomQ = homeQuotes[Math.floor(Math.random() * homeQuotes.length)];
      heroQuoteDisplay.textContent = `“${randomQ.text}”`;
    }

    // Editor Quick Quotes (editor placement)
    const editorQuotes = await QuoteStore.getByPlacement('editor');
    quickQuotesList.innerHTML = '';
    editorQuotes.forEach(q => {
      const chip = document.createElement('div');
      chip.className = 'quick-quote-chip';
      chip.textContent = `${q.category}: ${q.text}`;
      chip.addEventListener('click', () => {
        quickQuotesList.querySelectorAll('.quick-quote-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedAdminQuote = q.text;
        overlayText = '';
        userCustomText.value = '';
        pushHistory();
        draw();
      });
      quickQuotesList.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------
  // Realtime Sync from Admin Changes
  // ---------------------------------------------------------------
  window.addEventListener('pfs:frames_updated', async () => {
    try {
      await initPicker();
    } catch (e) {
      console.warn('Realtime frames update error:', e);
    }
  });

  window.addEventListener('pfs:quotes_updated', async () => {
    try {
      await initQuotes();
    } catch (e) {
      console.warn('Realtime quotes update error:', e);
    }
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  async function boot() {
    await initPicker();
    await initQuotes();
    await updateStats();
    await renderActivityWall();
  }

  boot();
})();
