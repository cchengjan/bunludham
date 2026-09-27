/**
 * Photo Frame Studio — Admin Controller
 * Implements Phase 6, 7, 13, 14, 15, and 18
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // DOM Elements
  // ---------------------------------------------------------------
  const adminToast = document.getElementById('adminToast');

  // Tabs
  const tabNavBtns = document.querySelectorAll('.tab-nav-btn');
  const tabContents = document.querySelectorAll('.admin-tab-content');

  // Tab 1: Frames
  const frameListContainer = document.getElementById('frameListContainer');
  const emptyFrameList = document.getElementById('emptyFrameList');
  const btnAddFrame = document.getElementById('btnAddFrame');
  const frameEditorCard = document.getElementById('frameEditorCard');
  const frameEditorTitle = document.getElementById('frameEditorTitle');

  const framePngInput = document.getElementById('framePngInput');
  const framePngPreview = document.getElementById('framePngPreview');
  const frameDimsTxt = document.getElementById('frameDimsTxt');

  const inputFrameName = document.getElementById('inputFrameName');
  const inputFrameCategory = document.getElementById('inputFrameCategory');
  const inputFrameKeywords = document.getElementById('inputFrameKeywords');
  const selectFrameStatus = document.getElementById('selectFrameStatus');

  // Visual Photo Area Editor Elements
  const visualAreaEditor = document.getElementById('visualAreaEditor');
  const visualEditorFrameImg = document.getElementById('visualEditorFrameImg');
  const visualBox = document.getElementById('visualBox');
  const visualHandle = document.getElementById('visualHandle');

  const numAreaX = document.getElementById('numAreaX');
  const numAreaY = document.getElementById('numAreaY');
  const numAreaW = document.getElementById('numAreaW');
  const numAreaH = document.getElementById('numAreaH');
  const numAreaR = document.getElementById('numAreaR');

  const btnPreviewRealPhoto = document.getElementById('btnPreviewRealPhoto');
  const btnResetArea = document.getElementById('btnResetArea');
  const btnSaveFrame = document.getElementById('btnSaveFrame');
  const btnCancelFrame = document.getElementById('btnCancelFrame');

  // Tab 2: Quotes
  const quoteListContainer = document.getElementById('quoteListContainer');
  const btnAddQuote = document.getElementById('btnAddQuote');
  const quoteEditorCard = document.getElementById('quoteEditorCard');
  const quoteEditorTitle = document.getElementById('quoteEditorTitle');
  const inputQuoteText = document.getElementById('inputQuoteText');
  const selectQuoteCategory = document.getElementById('selectQuoteCategory');
  const selectQuoteStatus = document.getElementById('selectQuoteStatus');
  const btnSaveQuote = document.getElementById('btnSaveQuote');
  const btnCancelQuote = document.getElementById('btnCancelQuote');

  // Tab 3: Moderation
  const moderationGrid = document.getElementById('moderationGrid');
  const emptyModList = document.getElementById('emptyModList');

  // Tab 4: Google Drive
  const inputGasUrl = document.getElementById('inputGasUrl');
  const btnSaveGasConfig = document.getElementById('btnSaveGasConfig');
  const btnTestDrive = document.getElementById('btnTestDrive');

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------
  let editingFrame = null;
  let editingQuote = null;
  let currentFrameNatW = 1600;
  let currentFrameNatH = 1600;

  let isDraggingBox = false;
  let isResizingHandle = false;
  let startX = 0, startY = 0;
  let boxOrigX = 0, boxOrigY = 0, boxOrigW = 0, boxOrigH = 0;
  let isShowingRealPhotoPreview = false;

  function showToast(text, isErr = false) {
    adminToast.textContent = text;
    adminToast.className = 'toast show ' + (isErr ? 'err' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => adminToast.classList.remove('show'), 3500);
  }

  // ---------------------------------------------------------------
  // Tab Navigation
  // ---------------------------------------------------------------
  tabNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabNavBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      document.getElementById(targetId).classList.remove('hidden');

      if (targetId === 'tab-quotes') renderQuotesList();
      if (targetId === 'tab-moderation') renderModerationList();
      if (targetId === 'tab-drive') initDriveConfig();
    });
  });

  // ---------------------------------------------------------------
  // Phase 6: Frame Manager
  // ---------------------------------------------------------------
  async function renderFrameList() {
    const frames = await FrameStore.getAll();
    frameListContainer.innerHTML = '';
    emptyFrameList.classList.toggle('hidden', frames.length > 0);

    frames.forEach((frame, idx) => {
      const row = document.createElement('div');
      row.className = 'frame-row';
      row.innerHTML = `
        <img src="${frame.thumbnail || frame.filename}" class="frame-row-thumb" alt="${frame.name}">
        <div class="frame-row-meta">
          <div class="frame-row-name">${frame.name}</div>
          <div class="frame-row-sub">
            <span class="badge ${frame.status}">${frame.status}</span>
            <span>หมวด: <strong>${frame.category}</strong></span>
            <span>ขนาด: ${frame.canvasWidth}x${frame.canvasHeight}</span>
            <span>พื้นที่ใส่ภาพ: X:${frame.photoArea.x} Y:${frame.photoArea.y} W:${frame.photoArea.width} H:${frame.photoArea.height}</span>
          </div>
        </div>
        <div class="frame-actions-cell">
          <button type="button" class="small edit-btn">✏️ แก้ไข</button>
          <button type="button" class="small dup-btn">📑 ทำซ้ำ</button>
          <button type="button" class="small status-btn">${frame.status === 'ACTIVE' ? 'ซ่อน' : 'เปิด'}</button>
          <button type="button" class="small move-up-btn" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="small move-down-btn" ${idx === frames.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="small danger del-btn">ลบ</button>
        </div>
      `;

      row.querySelector('.edit-btn').addEventListener('click', () => openFrameEditor(frame));
      row.querySelector('.dup-btn').addEventListener('click', async () => {
        await FrameStore.duplicate(frame.id);
        showToast('ทำซ้ำกรอบเรียบร้อยแล้ว');
        renderFrameList();
      });
      row.querySelector('.status-btn').addEventListener('click', async () => {
        const nextStatus = frame.status === 'ACTIVE' ? 'HIDDEN' : 'ACTIVE';
        await FrameStore.setStatus(frame.id, nextStatus);
        renderFrameList();
      });
      row.querySelector('.move-up-btn').addEventListener('click', async () => {
        await FrameStore.move(frame.id, -1);
        renderFrameList();
      });
      row.querySelector('.move-down-btn').addEventListener('click', async () => {
        await FrameStore.move(frame.id, 1);
        renderFrameList();
      });
      row.querySelector('.del-btn').addEventListener('click', async () => {
        if (confirm(`คุณแน่ใจว่าต้องการลบกรอบ "${frame.name}" หรือไม่?`)) {
          await FrameStore.remove(frame.id);
          showToast('ลบกรอบแล้ว');
          renderFrameList();
        }
      });

      frameListContainer.appendChild(row);
    });
  }

  // ---------------------------------------------------------------
  // Phase 7: Visual Photo Area Editor & Form
  // ---------------------------------------------------------------
  function openFrameEditor(frame = null) {
    editingFrame = frame ? JSON.parse(JSON.stringify(frame)) : {
      id: '',
      name: '',
      category: 'กฐิน',
      keywords: [],
      filename: 'assets/frames/kathin-118.png',
      thumbnail: 'assets/frames/kathin-118-thumb.png',
      canvasWidth: 1600,
      canvasHeight: 1600,
      photoArea: { x: 200, y: 200, width: 1200, height: 1000, borderRadius: 120 },
      status: 'ACTIVE',
      sortOrder: 1
    };

    frameEditorTitle.textContent = frame ? `แก้ไขกรอบ: ${frame.name}` : 'เพิ่มกรอบใหม่';
    inputFrameName.value = editingFrame.name;
    inputFrameCategory.value = editingFrame.category;
    inputFrameKeywords.value = (editingFrame.keywords || []).join(', ');
    selectFrameStatus.value = editingFrame.status;

    framePngPreview.src = editingFrame.thumbnail || editingFrame.filename;
    visualEditorFrameImg.src = editingFrame.filename;

    currentFrameNatW = editingFrame.canvasWidth || 1600;
    currentFrameNatH = editingFrame.canvasHeight || 1600;
    frameDimsTxt.textContent = `ขนาด Canvas: ${currentFrameNatW} x ${currentFrameNatH} px`;

    // Populate numeric inputs
    numAreaX.value = editingFrame.photoArea.x;
    numAreaY.value = editingFrame.photoArea.y;
    numAreaW.value = editingFrame.photoArea.width;
    numAreaH.value = editingFrame.photoArea.height;
    numAreaR.value = editingFrame.photoArea.borderRadius || 0;

    syncBoxFromNumbers();
    frameEditorCard.classList.remove('hidden');
    frameEditorCard.scrollIntoView({ behavior: 'smooth' });
  }

  // PNG File Upload
  framePngInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const tempImg = new Image();
    tempImg.onload = () => {
      currentFrameNatW = tempImg.naturalWidth;
      currentFrameNatH = tempImg.naturalHeight;
      frameDimsTxt.textContent = `ขนาด Canvas: ${currentFrameNatW} x ${currentFrameNatH} px`;
      
      editingFrame.filename = url;
      editingFrame.thumbnail = url;
      editingFrame.canvasWidth = currentFrameNatW;
      editingFrame.canvasHeight = currentFrameNatH;

      framePngPreview.src = url;
      visualEditorFrameImg.src = url;

      // Default photoArea
      editingFrame.photoArea = {
        x: Math.round(currentFrameNatW * 0.12),
        y: Math.round(currentFrameNatH * 0.12),
        width: Math.round(currentFrameNatW * 0.76),
        height: Math.round(currentFrameNatH * 0.7),
        borderRadius: Math.round(currentFrameNatW * 0.05)
      };

      numAreaX.value = editingFrame.photoArea.x;
      numAreaY.value = editingFrame.photoArea.y;
      numAreaW.value = editingFrame.photoArea.width;
      numAreaH.value = editingFrame.photoArea.height;
      numAreaR.value = editingFrame.photoArea.borderRadius;

      syncBoxFromNumbers();
    };
    tempImg.src = url;
  });

  // Sync Box Visual from Numeric Inputs
  function syncBoxFromNumbers() {
    const x = parseFloat(numAreaX.value) || 0;
    const y = parseFloat(numAreaY.value) || 0;
    const w = parseFloat(numAreaW.value) || 100;
    const h = parseFloat(numAreaH.value) || 100;
    const r = parseFloat(numAreaR.value) || 0;

    const scaleX = visualAreaEditor.clientWidth / currentFrameNatW;
    const scaleY = visualAreaEditor.clientHeight / currentFrameNatH;

    visualBox.style.left = `${x * scaleX}px`;
    visualBox.style.top = `${y * scaleY}px`;
    visualBox.style.width = `${w * scaleX}px`;
    visualBox.style.height = `${h * scaleY}px`;
    visualBox.style.borderRadius = `${r * scaleX}px`;
  }

  // Two-way binding: Numeric inputs changed -> Update Visual Box
  [numAreaX, numAreaY, numAreaW, numAreaH, numAreaR].forEach(input => {
    input.addEventListener('input', syncBoxFromNumbers);
  });

  // Two-way binding: Dragging Box visually -> Update Numeric Inputs
  visualBox.addEventListener('pointerdown', e => {
    if (e.target === visualHandle) return; // handled separately
    isDraggingBox = true;
    startX = e.clientX;
    startY = e.clientY;
    boxOrigX = parseFloat(numAreaX.value) || 0;
    boxOrigY = parseFloat(numAreaY.value) || 0;
    visualBox.setPointerCapture(e.pointerId);
  });

  visualBox.addEventListener('pointermove', e => {
    if (!isDraggingBox) return;
    const scaleX = visualAreaEditor.clientWidth / currentFrameNatW;
    const scaleY = visualAreaEditor.clientHeight / currentFrameNatH;

    const dx = (e.clientX - startX) / scaleX;
    const dy = (e.clientY - startY) / scaleY;

    const newX = Math.round(Math.max(0, Math.min(currentFrameNatW - parseFloat(numAreaW.value), boxOrigX + dx)));
    const newY = Math.round(Math.max(0, Math.min(currentFrameNatH - parseFloat(numAreaH.value), boxOrigY + dy)));

    numAreaX.value = newX;
    numAreaY.value = newY;
    syncBoxFromNumbers();
  });

  function endDrag(e) {
    if (isDraggingBox) {
      isDraggingBox = false;
      try { visualBox.releasePointerCapture(e.pointerId); } catch(err){}
    }
  }
  visualBox.addEventListener('pointerup', endDrag);
  visualBox.addEventListener('pointercancel', endDrag);

  // Resize Handle -> Update Width and Height
  visualHandle.addEventListener('pointerdown', e => {
    e.stopPropagation();
    isResizingHandle = true;
    startX = e.clientX;
    startY = e.clientY;
    boxOrigW = parseFloat(numAreaW.value) || 100;
    boxOrigH = parseFloat(numAreaH.value) || 100;
    visualHandle.setPointerCapture(e.pointerId);
  });

  visualHandle.addEventListener('pointermove', e => {
    if (!isResizingHandle) return;
    const scaleX = visualAreaEditor.clientWidth / currentFrameNatW;
    const scaleY = visualAreaEditor.clientHeight / currentFrameNatH;

    const dw = (e.clientX - startX) / scaleX;
    const dh = (e.clientY - startY) / scaleY;

    const newW = Math.round(Math.max(50, Math.min(currentFrameNatW - parseFloat(numAreaX.value), boxOrigW + dw)));
    const newH = Math.round(Math.max(50, Math.min(currentFrameNatH - parseFloat(numAreaY.value), boxOrigH + dh)));

    numAreaW.value = newW;
    numAreaH.value = newH;
    syncBoxFromNumbers();
  });

  function endResize(e) {
    if (isResizingHandle) {
      isResizingHandle = false;
      try { visualHandle.releasePointerCapture(e.pointerId); } catch(err){}
    }
  }
  visualHandle.addEventListener('pointerup', endResize);
  visualHandle.addEventListener('pointercancel', endResize);

  // Reset Area to Center
  btnResetArea.addEventListener('click', () => {
    const w = Math.round(currentFrameNatW * 0.75);
    const h = Math.round(currentFrameNatH * 0.68);
    const x = Math.round((currentFrameNatW - w) / 2);
    const y = Math.round((currentFrameNatH - h) / 2);

    numAreaX.value = x;
    numAreaY.value = y;
    numAreaW.value = w;
    numAreaH.value = h;
    numAreaR.value = Math.round(w * 0.1);
    syncBoxFromNumbers();
  });

  // Preview Real Photo
  btnPreviewRealPhoto.addEventListener('click', () => {
    isShowingRealPhotoPreview = !isShowingRealPhotoPreview;
    if (isShowingRealPhotoPreview) {
      visualBox.style.backgroundImage = 'radial-gradient(circle, #fde047 10%, #0d9488 90%)';
      btnPreviewRealPhoto.textContent = '👁 ปิด Preview';
    } else {
      visualBox.style.backgroundImage = '';
      btnPreviewRealPhoto.textContent = '👁 Preview ภาพจริงในกรอบ';
    }
  });

  // Save Frame
  btnSaveFrame.addEventListener('click', async () => {
    const name = inputFrameName.value.trim();
    if (!name) {
      showToast('กรุณากรอกชื่อกรอบภาพ', true);
      return;
    }

    editingFrame.name = name;
    editingFrame.category = inputFrameCategory.value.trim() || 'อื่น ๆ';
    editingFrame.keywords = inputFrameKeywords.value.split(',').map(s => s.trim()).filter(Boolean);
    editingFrame.status = selectFrameStatus.value;
    editingFrame.canvasWidth = currentFrameNatW;
    editingFrame.canvasHeight = currentFrameNatH;
    editingFrame.photoArea = {
      x: parseInt(numAreaX.value, 10) || 0,
      y: parseInt(numAreaY.value, 10) || 0,
      width: parseInt(numAreaW.value, 10) || 100,
      height: parseInt(numAreaH.value, 10) || 100,
      borderRadius: parseInt(numAreaR.value, 10) || 0
    };

    await FrameStore.save(editingFrame);
    showToast('บันทึกกรอบภาพเรียบร้อยแล้ว');
    frameEditorCard.classList.add('hidden');
    renderFrameList();
  });

  btnCancelFrame.addEventListener('click', () => {
    frameEditorCard.classList.add('hidden');
  });

  btnAddFrame.addEventListener('click', () => openFrameEditor(null));

  // ---------------------------------------------------------------
  // Phase 13, 14, 15: Quote / Message Library
  // ---------------------------------------------------------------
  async function renderQuotesList() {
    const quotes = await QuoteStore.getAll();
    quoteListContainer.innerHTML = '';

    quotes.forEach((q, idx) => {
      const row = document.createElement('div');
      row.className = 'frame-row';
      row.style.gridTemplateColumns = '1fr auto';
      row.innerHTML = `
        <div class="frame-row-meta">
          <div class="frame-row-name" style="white-space:normal; font-size:0.95rem;">
            “${q.text}”
          </div>
          <div class="frame-row-sub">
            <span class="badge ${q.status}">${q.status}</span>
            <span>หมวด: <strong>${q.category}</strong></span>
            <span>ตำแหน่ง: ${(q.placements || []).join(', ')}</span>
          </div>
        </div>
        <div class="frame-actions-cell">
          <button type="button" class="small edit-q-btn">✏️ แก้ไข</button>
          <button type="button" class="small dup-q-btn">📑 ทำซ้ำ</button>
          <button type="button" class="small status-q-btn">${q.status === 'ACTIVE' ? 'ซ่อน' : 'เปิด'}</button>
          <button type="button" class="small danger del-q-btn">ลบ</button>
        </div>
      `;

      row.querySelector('.edit-q-btn').addEventListener('click', () => openQuoteEditor(q));
      row.querySelector('.dup-q-btn').addEventListener('click', async () => {
        await QuoteStore.duplicate(q.id);
        showToast('ทำซ้ำข้อความเรียบร้อย');
        renderQuotesList();
      });
      row.querySelector('.status-q-btn').addEventListener('click', async () => {
        await QuoteStore.toggleStatus(q.id);
        renderQuotesList();
      });
      row.querySelector('.del-q-btn').addEventListener('click', async () => {
        if (confirm('คุณแน่ใจว่าต้องการลบข้อความนี้?')) {
          await QuoteStore.remove(q.id);
          showToast('ลบข้อความแล้ว');
          renderQuotesList();
        }
      });

      quoteListContainer.appendChild(row);
    });
  }

  function openQuoteEditor(quote = null) {
    editingQuote = quote ? JSON.parse(JSON.stringify(quote)) : {
      id: '',
      text: '',
      category: '🙏 อนุโมทนา',
      status: 'ACTIVE',
      placements: ['home', 'editor', 'activity']
    };

    quoteEditorTitle.textContent = quote ? 'แก้ไขข้อความ' : 'เพิ่มข้อความใหม่';
    inputQuoteText.value = editingQuote.text;
    selectQuoteCategory.value = editingQuote.category;
    selectQuoteStatus.value = editingQuote.status;

    // Checkboxes
    document.querySelectorAll('input[name="qPlace"]').forEach(cb => {
      cb.checked = (editingQuote.placements || []).includes(cb.value);
    });

    quoteEditorCard.classList.remove('hidden');
    quoteEditorCard.scrollIntoView({ behavior: 'smooth' });
  }

  btnSaveQuote.addEventListener('click', async () => {
    const text = inputQuoteText.value.trim();
    if (!text) {
      showToast('กรุณากรอกข้อความ', true);
      return;
    }

    const placements = [];
    document.querySelectorAll('input[name="qPlace"]:checked').forEach(cb => placements.push(cb.value));

    editingQuote.text = text;
    editingQuote.category = selectQuoteCategory.value;
    editingQuote.status = selectQuoteStatus.value;
    editingQuote.placements = placements;

    await QuoteStore.save(editingQuote);
    showToast('บันทึกข้อความเรียบร้อย');
    quoteEditorCard.classList.add('hidden');
    renderQuotesList();
  });

  btnCancelQuote.addEventListener('click', () => {
    quoteEditorCard.classList.add('hidden');
  });

  btnAddQuote.addEventListener('click', () => openQuoteEditor(null));

  // ---------------------------------------------------------------
  // Phase 18: Moderation List
  // ---------------------------------------------------------------
  async function renderModerationList() {
    const submissions = await ActivityStore.getAll();
    moderationGrid.innerHTML = '';
    emptyModList.classList.toggle('hidden', submissions.length > 0);

    submissions.forEach(sub => {
      const card = document.createElement('div');
      card.className = 'mod-card' + (sub.reported ? ' reported' : '');
      card.innerHTML = `
        <img src="${sub.thumbnail || sub.dataUrl}" class="mod-thumb" alt="">
        <div>
          <div style="font-weight:600; font-size:0.9rem;">${sub.eventName}</div>
          <div style="font-size:0.75rem; color:var(--muted);">${sub.dateStr}</div>
          ${sub.caption ? `<div style="font-size:0.82rem; margin-top:4px;">“${sub.caption}”</div>` : ''}
          <div style="margin-top:6px; display:flex; gap:6px; align-items:center;">
            <span class="badge ${sub.status}">${sub.status}</span>
            ${sub.reported ? `<span class="badge" style="background:#FEE2E2; color:#B91C1C;">⚠️ ถูกรายงาน (${sub.reports ? sub.reports.length : 1})</span>` : ''}
          </div>
          ${sub.reported && sub.reports && sub.reports.length > 0 ? `
            <div style="font-size:0.75rem; color:#B91C1C; margin-top:4px;">
              เหตุผล: ${sub.reports.map(r => r.reason).join(', ')}
            </div>
          ` : ''}
        </div>
        <div style="display:flex; gap:6px; margin-top:auto;">
          <button type="button" class="small toggle-vis-btn">
            ${sub.status === 'ACTIVE' ? 'ซ่อนภาพ' : 'เปิดแสดงภาพ'}
          </button>
          <button type="button" class="small danger del-mod-btn">ลบถาวร</button>
        </div>
      `;

      card.querySelector('.toggle-vis-btn').addEventListener('click', async () => {
        const nextStatus = sub.status === 'ACTIVE' ? 'HIDDEN' : 'ACTIVE';
        await ActivityStore.setStatus(sub.id, nextStatus);
        renderModerationList();
      });

      card.querySelector('.del-mod-btn').addEventListener('click', async () => {
        if (confirm('คุณแน่ใจว่าต้องการลบภาพนี้ออกจากระบบอย่างถาวร?')) {
          await ActivityStore.delete(sub.id);
          showToast('ลบภาพเรียบร้อย');
          renderModerationList();
        }
      });

      moderationGrid.appendChild(card);
    });
  }

  // ---------------------------------------------------------------
  // Phase 8: Google Drive Config
  // ---------------------------------------------------------------
  function initDriveConfig() {
    inputGasUrl.value = (window.PFS_CONFIG && window.PFS_CONFIG.gasWebAppUrl) || '';
  }

  btnSaveGasConfig.addEventListener('click', () => {
    const val = inputGasUrl.value.trim();
    if (!window.PFS_CONFIG) window.PFS_CONFIG = {};
    window.PFS_CONFIG.gasWebAppUrl = val;
    showToast('บันทึกการตั้งค่า Google Drive สำเร็จ');
  });

  btnTestDrive.addEventListener('click', async () => {
    const url = inputGasUrl.value.trim();
    if (!url) {
      showToast('กรุณากรอก Google Apps Script Web App URL ก่อนทดสอบ', true);
      return;
    }
    showToast('กำลังทดสอบการเชื่อมต่อ...');
    try {
      const res = await fetch(url);
      showToast('เชื่อมต่อสำเร็จ! Google Apps Script ตอบรับแล้ว', false);
    } catch (e) {
      showToast('ไม่สามารถเชื่อมต่อได้: ' + e.message, true);
    }
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  renderFrameList();
})();
