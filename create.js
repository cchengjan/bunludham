/**
 * create.js — สตูดิโอสร้างกรอบภาพที่ระลึกกฐินคุณยายฯ (สำหรับผู้ใช้ทั่วไป)
 * ทำงานแบบ Standalone 100% รวดเร็ว ปลอดภัย ไม่ส่งข้อมูลออกนอกเครื่อง
 */
(() => {
  'use strict';

  // 1. กำหนด 3 กรอบกฐินคุณยายฯ ประจำงาน
  const KATHIN_FRAMES = [
    {
      id: 'kathin-peacock-gold',
      name: 'กฐิน ๑๑๘ ปี นกยูงทองคำ',
      subtitle: 'ริบบิ้นน้ำเงิน พระเดชพระคุณคุณยายอาจารย์',
      filename: 'assets/frames/kathin-peacock-gold.png',
      thumbnail: 'assets/frames/kathin-peacock-gold-thumb.png',
      canvasWidth: 1024,
      canvasHeight: 1024
    },
    {
      id: 'kathin-peacock-blue',
      name: 'กฐิน ๑๑๘ ปี นกยูงคู่แก้ว',
      subtitle: 'นกยูงคู่ทิพยพิมาน บัวสวรรค์มงคล',
      filename: 'assets/frames/kathin-peacock-blue.png',
      thumbnail: 'assets/frames/kathin-peacock-blue-thumb.png',
      canvasWidth: 1024,
      canvasHeight: 1024
    },
    {
      id: 'kathin-118',
      name: 'กฐิน ๑๑๘ ปี คุณยายอาจารย์',
      subtitle: 'กรอบทองคำมหารัตนอุบาสิกา จันทร์ ขนนกยูง',
      filename: 'assets/frames/kathin-118.png',
      thumbnail: 'assets/frames/kathin-118-thumb.png',
      canvasWidth: 2351,
      canvasHeight: 2351
    }
  ];

  // DOM Elements
  const screenPicker = document.getElementById('screen-picker');
  const screenEditor = document.getElementById('screen-editor');
  const threeFramesContainer = document.getElementById('threeFramesContainer');
  const backToPickerBtn = document.getElementById('backToPickerBtn');
  const activeFrameName = document.getElementById('activeFrameName');

  const canvas = document.getElementById('photoCanvas');
  const ctx = canvas.getContext('2d');
  const canvasBox = document.getElementById('canvasBox');
  const canvasOverlayUpload = document.getElementById('canvasOverlayUpload');
  const userPhotoInput = document.getElementById('userPhotoInput');
  const reselectPhotoBtn = document.getElementById('reselectPhotoBtn');

  // Controls
  const fitAreaBtn = document.getElementById('fitAreaBtn');
  const resetTransformBtn = document.getElementById('resetTransformBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomRange = document.getElementById('zoomRange');
  const zoomPercentVal = document.getElementById('zoomPercentVal');
  const createImageBtn = document.getElementById('createImageBtn');

  // Sliders & Filters
  const brightnessInput = document.getElementById('brightnessInput');
  const contrastInput = document.getElementById('contrastInput');
  const saturationInput = document.getElementById('saturationInput');
  const warmthInput = document.getElementById('warmthInput');
  const brightnessVal = document.getElementById('brightnessVal');
  const contrastVal = document.getElementById('contrastVal');
  const saturationVal = document.getElementById('saturationVal');
  const warmthVal = document.getElementById('warmthVal');
  const filterPills = document.querySelectorAll('.filter-pill');

  // Text inputs
  const userCustomText = document.getElementById('userCustomText');
  const quickQuotesList = document.getElementById('quickQuotesList');

  // Modal
  const downloadModal = document.getElementById('downloadModal');
  const downloadPreview = document.getElementById('downloadPreview');
  const directDownloadLink = document.getElementById('directDownloadLink');
  const closeDownloadModalBtn = document.getElementById('closeDownloadModalBtn');
  const toast = document.getElementById('toast');

  // State
  let currentFrame = null;
  let frameImg = new Image();
  let frameReady = false;

  let photoImg = null;
  let scale = 1;
  let coverScale = 1;
  let maxScale = 4;
  let offsetX = 0;
  let offsetY = 0;

  let adjustments = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
    filter: 'normal'
  };

  let overlayText = '';
  let selectedQuote = '';

  // -----------------------------------------------------------------
  // 1. Init: Render the 3 Kathin Frames
  // -----------------------------------------------------------------
  async function loadUserFrames() {
    let list = [];
    if (window.FrameStore) {
      try {
        list = await FrameStore.getActive();
      } catch (e) {
        console.warn('FrameStore getActive error', e);
      }
    }
    // Priority 1: marked explicitly as showInUserMode
    let userFrames = list.filter(f => f.showInUserMode === true);
    // Priority 2: category 'กฐิน' or keyword 'กฐิน'
    if (userFrames.length === 0) {
      userFrames = list.filter(f => f.category === 'กฐิน' || (f.keywords && f.keywords.includes('กฐิน')));
    }
    // Priority 3: first 3 active frames
    if (userFrames.length === 0 && list.length > 0) {
      userFrames = list.slice(0, 3);
    }
    // Priority 4: fallback static KATHIN_FRAMES
    if (!userFrames || userFrames.length === 0) {
      userFrames = KATHIN_FRAMES;
    }
    return userFrames;
  }

  async function init() {
    const frames = await loadUserFrames();
    renderFrames(frames);
    bindEvents();
    setupTouchGestures();

    // Listen for realtime updates from Admin panel!
    window.addEventListener('pfs:frames_updated', async () => {
      const updated = await loadUserFrames();
      renderFrames(updated);
      if (currentFrame) {
        const found = updated.find(f => f.id === currentFrame.id);
        if (found) {
          currentFrame = found;
          activeFrameName.textContent = found.name;
        }
      }
    });
  }

  function renderFrames(framesList = KATHIN_FRAMES) {
    threeFramesContainer.innerHTML = '';
    framesList.forEach((frame, idx) => {
      const card = document.createElement('div');
      card.className = 'kathin-frame-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', frame.name);

      const sub = frame.subtitle || (frame.category === 'กฐิน' ? 'ภาพที่ระลึกกฐินคุณยายฯ' : frame.category);
      card.innerHTML = `
        <div class="kathin-frame-preview-box">
          <img src="${frame.thumbnail || frame.filename}" alt="${frame.name}" loading="lazy">
        </div>
        <div class="kathin-frame-title">${frame.name}</div>
        <div style="font-size:0.8rem; color:#718096; margin-bottom:12px;">${sub}</div>
        <button type="button" class="kathin-frame-btn">
          ✨ เลือกกรอบนี้
        </button>
      `;

      card.addEventListener('click', () => selectFrame(frame));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectFrame(frame);
        }
      });

      threeFramesContainer.appendChild(card);
    });
  }

  function selectFrame(frame) {
    currentFrame = frame;
    activeFrameName.textContent = frame.name;

    canvas.width = frame.canvasWidth;
    canvas.height = frame.canvasHeight;

    frameReady = false;
    frameImg = new Image();
    frameImg.onload = () => {
      frameReady = true;
      if (photoImg) fitToArea();
      else draw();
    };
    frameImg.src = frame.filename;

    screenPicker.classList.add('hidden');
    screenEditor.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // -----------------------------------------------------------------
  // 2. Photo Placement & Full Frame Canvas Logic
  // -----------------------------------------------------------------
  function coverScaleFor(img) {
    return Math.max(canvas.width / img.width, canvas.height / img.height);
  }

  function clampOffsets() {
    if (!photoImg) return;
    const halfW = (photoImg.width * scale) / 2;
    const halfH = (photoImg.height * scale) / 2;
    const maxX = Math.max(0, halfW - canvas.width / 2);
    const maxY = Math.max(0, halfH - canvas.height / 2);
    offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
    offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
  }

  function fitToArea() {
    if (!photoImg) return;
    coverScale = coverScaleFor(photoImg);
    maxScale = coverScale * 4;
    scale = coverScale;
    offsetX = 0;
    offsetY = 0;
    syncZoomUi();
    draw();
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

    // Layer 1: Photo placed FULL-FRAME behind the frame
    if (photoImg && currentFrame) {
      ctx.save();
      // Clip to full canvas bounds
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.clip();

      ctx.filter = getCanvasFilterString();

      // Center photo across the full canvas
      ctx.translate(canvas.width / 2 + offsetX, canvas.height / 2 + offsetY);
      ctx.scale(scale, scale);
      ctx.drawImage(photoImg, -photoImg.width / 2, -photoImg.height / 2);

      // Warmth Tint
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

    // Layer 2: Transparent Frame Overlay on TOP
    if (frameReady) {
      ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
    }

    // Layer 3: Text / Blessing Quote Overlay
    const textToShow = overlayText || selectedQuote;
    if (textToShow && currentFrame) {
      drawTextOverlay(textToShow);
    }
  }

  function drawTextOverlay(text) {
    ctx.save();
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

    // Text
    const fontSize = Math.max(20, Math.round(canvas.width * 0.023));
    ctx.font = `600 ${fontSize}px "Noto Sans Thai", "Sarabun", sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bannerX + bannerW / 2, bannerY + bannerH / 2 + 1, bannerW - 24);

    ctx.restore();
  }

  // -----------------------------------------------------------------
  // 3. User Photo Handling
  // -----------------------------------------------------------------
  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('โปรดเลือกไฟล์รูปภาพที่ถูกต้อง');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        photoImg = img;
        canvasOverlayUpload.classList.add('hidden');
        setControlsEnabled(true);
        fitToArea();
        showToast('อัปโหลดภาพสำเร็จ ปรับตำแหน่งได้ทันที');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function setControlsEnabled(enabled) {
    fitAreaBtn.disabled = !enabled;
    resetTransformBtn.disabled = !enabled;
    zoomInBtn.disabled = !enabled;
    zoomOutBtn.disabled = !enabled;
    zoomRange.disabled = !enabled;
    createImageBtn.disabled = !enabled;
  }

  function syncZoomUi() {
    if (!photoImg) return;
    const pct = Math.round((scale / coverScale) * 100);
    zoomRange.value = pct;
    zoomPercentVal.textContent = pct + '%';
  }

  // -----------------------------------------------------------------
  // 4. Interactive Drag & Touch Gestures
  // -----------------------------------------------------------------
  function setupTouchGestures() {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let pinchStartDist = 0;
    let pinchStartScale = 1;

    function getCanvasCoords(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    }

    // Mouse events
    canvas.addEventListener('mousedown', (e) => {
      if (!photoImg) return;
      isDragging = true;
      startX = e.clientX - offsetX * (canvas.getBoundingClientRect().width / canvas.width);
      startY = e.clientY - offsetY * (canvas.getBoundingClientRect().height / canvas.height);
      canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging || !photoImg) return;
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      offsetX = (e.clientX - startX) * ratio;
      offsetY = (e.clientY - startY) * ratio;
      clampOffsets();
      draw();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        canvas.style.cursor = 'grab';
      }
    });

    // Mouse wheel zoom on desktop
    canvas.addEventListener('wheel', (e) => {
      if (!photoImg) return;
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      scale = Math.max(coverScale, Math.min(maxScale, scale * zoomFactor));
      clampOffsets();
      syncZoomUi();
      draw();
    }, { passive: false });

    // Touch events
    canvas.addEventListener('touchstart', (e) => {
      if (!photoImg) return;
      if (e.touches.length === 1) {
        isDragging = true;
        const touch = e.touches[0];
        const ratio = canvas.getBoundingClientRect().width / canvas.width;
        startX = touch.clientX - offsetX * ratio;
        startY = touch.clientY - offsetY * ratio;
      } else if (e.touches.length === 2) {
        isDragging = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        pinchStartScale = scale;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      if (!photoImg) return;
      e.preventDefault(); // Prevent page scroll during canvas interaction

      if (e.touches.length === 1 && isDragging) {
        const touch = e.touches[0];
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        offsetX = (touch.clientX - startX) * ratio;
        offsetY = (touch.clientY - startY) * ratio;
        clampOffsets();
        draw();
      } else if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (pinchStartDist > 0) {
          const ratio = currentDist / pinchStartDist;
          scale = Math.max(coverScale, Math.min(maxScale, pinchStartScale * ratio));
          clampOffsets();
          syncZoomUi();
          draw();
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      if (e.touches.length === 0) {
        isDragging = false;
        pinchStartDist = 0;
      }
    });
  }

  // -----------------------------------------------------------------
  // 5. Event Binding
  // -----------------------------------------------------------------
  function bindEvents() {
    // Back to picker
    backToPickerBtn.addEventListener('click', () => {
      screenEditor.classList.add('hidden');
      screenPicker.classList.remove('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Upload triggers
    canvasOverlayUpload.addEventListener('click', () => userPhotoInput.click());
    reselectPhotoBtn.addEventListener('click', () => userPhotoInput.click());

    userPhotoInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
      }
    });

    // Drag and drop onto canvas
    ['dragenter', 'dragover'].forEach(eventName => {
      canvasBox.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        canvasBox.style.outline = '3px dashed var(--gold)';
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      canvasBox.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        canvasBox.style.outline = 'none';
      });
    });

    canvasBox.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        document.getElementById(targetId)?.classList.remove('hidden');
      });
    });

    // Transform buttons
    fitAreaBtn.addEventListener('click', fitToArea);
    resetTransformBtn.addEventListener('click', () => {
      fitToArea();
      adjustments = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, filter: 'normal' };
      brightnessInput.value = 0;
      contrastInput.value = 0;
      saturationInput.value = 0;
      warmthInput.value = 0;
      brightnessVal.textContent = '0';
      contrastVal.textContent = '0';
      saturationVal.textContent = '0';
      warmthVal.textContent = '0';
      filterPills.forEach(p => p.classList.toggle('active', p.getAttribute('data-filter') === 'normal'));
      draw();
    });

    // Zoom controls
    zoomRange.addEventListener('input', (e) => {
      if (!photoImg) return;
      const pct = parseInt(e.target.value, 10);
      scale = coverScale * (pct / 100);
      clampOffsets();
      zoomPercentVal.textContent = pct + '%';
      draw();
    });

    zoomInBtn.addEventListener('click', () => {
      if (!photoImg) return;
      let pct = parseInt(zoomRange.value, 10) + 15;
      pct = Math.min(400, pct);
      zoomRange.value = pct;
      scale = coverScale * (pct / 100);
      clampOffsets();
      zoomPercentVal.textContent = pct + '%';
      draw();
    });

    zoomOutBtn.addEventListener('click', () => {
      if (!photoImg) return;
      let pct = parseInt(zoomRange.value, 10) - 15;
      pct = Math.max(100, pct);
      zoomRange.value = pct;
      scale = coverScale * (pct / 100);
      clampOffsets();
      zoomPercentVal.textContent = pct + '%';
      draw();
    });

    // Sliders
    brightnessInput.addEventListener('input', (e) => {
      adjustments.brightness = parseInt(e.target.value, 10);
      brightnessVal.textContent = adjustments.brightness;
      draw();
    });

    contrastInput.addEventListener('input', (e) => {
      adjustments.contrast = parseInt(e.target.value, 10);
      contrastVal.textContent = adjustments.contrast;
      draw();
    });

    saturationInput.addEventListener('input', (e) => {
      adjustments.saturation = parseInt(e.target.value, 10);
      saturationVal.textContent = adjustments.saturation;
      draw();
    });

    warmthInput.addEventListener('input', (e) => {
      adjustments.warmth = parseInt(e.target.value, 10);
      warmthVal.textContent = adjustments.warmth;
      draw();
    });

    // Preset filter pills
    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        adjustments.filter = pill.getAttribute('data-filter');
        draw();
      });
    });

    // Text inputs
    userCustomText.addEventListener('input', (e) => {
      overlayText = e.target.value.trim();
      draw();
    });

    // Quick Quotes
    document.querySelectorAll('.quote-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.getAttribute('data-quote');
        if (selectedQuote === q) {
          selectedQuote = '';
          chip.classList.remove('selected');
        } else {
          document.querySelectorAll('.quote-chip').forEach(c => c.classList.remove('selected'));
          selectedQuote = q;
          chip.classList.add('selected');
        }
        draw();
      });
    });

    // Create Image & Direct Download
    createImageBtn.addEventListener('click', () => {
      if (!photoImg) return;
      draw(); // Fresh 1:1 render

      const dataUrl = canvas.toDataURL('image/png', 1.0);
      downloadPreview.src = dataUrl;

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const safeFrameName = (currentFrame ? currentFrame.name : 'กฐินคุณยายฯ').replace(/\s+/g, '_');
      const filename = `${safeFrameName}_${dateStr}.png`;

      directDownloadLink.href = dataUrl;
      directDownloadLink.setAttribute('download', filename);

      downloadModal.classList.add('open');
    });

    closeDownloadModalBtn.addEventListener('click', () => {
      downloadModal.classList.remove('open');
    });

    downloadModal.addEventListener('click', (e) => {
      if (e.target === downloadModal) {
        downloadModal.classList.remove('open');
      }
    });
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  }

  // Run
  document.addEventListener('DOMContentLoaded', init);
})();
