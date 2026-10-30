/**
 * Storage.js — Photo Frame Studio Storage Engine (v3)
 * ------------------------------------------------------------
 * Manages:
 *  - FrameStore: Frame list & visual metadata (photoArea) [canonical key: pfs_frames_v3]
 *  - QuoteStore: Message library (Admin quotes & placement) [canonical key: pfs_quotes_v2]
 *  - ActivityStore: Community submissions, reactions, statistics & moderation [canonical key: pfs_activities_v2]
 *  - StorageBackup: Validated Backup/Restore & Reset Defaults across canonical stores
 *
 * All data is stored in localStorage with asynchronous API.
 */

// =========================================================================
// Shared Validation & Hash Helpers
// =========================================================================
const PFS_STORAGE_CONSTANTS = Object.freeze({
  FRAMES_V3_KEY: 'pfs_frames_v3',
  FRAMES_V2_LEGACY_KEY: 'pfs_frames_v2',
  FRAMES_V2_BACKUP_KEY: 'pfs_frames_v2_backup',
  FRAMES_MIGRATION_META_KEY: 'pfs_frames_migration_v3',
  FRAMES_SEED_HASH_KEY: 'pfs_frames_seed_hash_v3',
  QUOTES_KEY: 'pfs_quotes_v2',
  QUOTES_SEED_HASH_KEY: 'pfs_quotes_seed_hash',
  ACTIVITIES_KEY: 'pfs_activities_v2',
  CREATIONS_COUNT_KEY: 'pfs_creations_count_v2',
  GAS_URL_KEY: 'pfs_gas_url',
  SYNC_PING_KEY: 'pfs_sync_ping_v3'
});

function computeSeedHash(seedText) {
  return String(seedText.length) + '_' + seedText.slice(0, 40);
}

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function isValidFrameRecord(f, { strict = false } = {}) {
  if (!isPlainObject(f)) return false;
  if (typeof f.id !== 'string' || f.id.trim().length === 0) return false;
  if (typeof f.name !== 'string' || f.name.trim().length === 0) return false;
  if (typeof f.filename !== 'string' || f.filename.trim().length === 0) return false;
  if (f.filename.trim().toLowerCase().startsWith('javascript:')) return false;
  if (f.thumbnail !== undefined && f.thumbnail !== null) {
    if (typeof f.thumbnail !== 'string') return false;
    if (f.thumbnail.trim().toLowerCase().startsWith('javascript:')) return false;
  }

  const validStatuses = ['ACTIVE', 'DRAFT', 'HIDDEN'];
  if (strict) {
    if (!validStatuses.includes(f.status)) return false;
    if (typeof f.canvasWidth !== 'number' || !Number.isFinite(f.canvasWidth) || f.canvasWidth <= 0) return false;
    if (typeof f.canvasHeight !== 'number' || !Number.isFinite(f.canvasHeight) || f.canvasHeight <= 0) return false;
    if (!isPlainObject(f.photoArea)) return false;
    const pa = f.photoArea;
    if (
      typeof pa.x !== 'number' || !Number.isFinite(pa.x) ||
      typeof pa.y !== 'number' || !Number.isFinite(pa.y) ||
      typeof pa.width !== 'number' || !Number.isFinite(pa.width) || pa.width <= 0 ||
      typeof pa.height !== 'number' || !Number.isFinite(pa.height) || pa.height <= 0
    ) {
      return false;
    }
    if (pa.borderRadius !== undefined && (typeof pa.borderRadius !== 'number' || !Number.isFinite(pa.borderRadius) || pa.borderRadius < 0)) {
      return false;
    }
  } else {
    if (f.status !== undefined && !validStatuses.includes(f.status)) return false;
    if (f.canvasWidth !== undefined && (typeof Number(f.canvasWidth) !== 'number' || !Number.isFinite(Number(f.canvasWidth)) || Number(f.canvasWidth) <= 0)) {
      return false;
    }
    if (f.canvasHeight !== undefined && (typeof Number(f.canvasHeight) !== 'number' || !Number.isFinite(Number(f.canvasHeight)) || Number(f.canvasHeight) <= 0)) {
      return false;
    }
  }
  return true;
}

function normalizeFrameRecord(raw) {
  const f = JSON.parse(JSON.stringify(raw));
  f.id = f.id.trim();
  f.name = f.name.trim();
  f.category = typeof f.category === 'string' && f.category.trim() ? f.category.trim() : 'อื่น ๆ';
  f.keywords = Array.isArray(f.keywords) ? f.keywords.filter(k => typeof k === 'string').map(k => k.trim()).filter(Boolean) : [];
  f.canvasWidth = Number(f.canvasWidth) > 0 ? Number(f.canvasWidth) : 1600;
  f.canvasHeight = Number(f.canvasHeight) > 0 ? Number(f.canvasHeight) : 1600;
  f.status = ['ACTIVE', 'DRAFT', 'HIDDEN'].includes(f.status) ? f.status : 'ACTIVE';
  f.sortOrder = typeof f.sortOrder === 'number' && Number.isFinite(f.sortOrder) ? f.sortOrder : 1;
  if (!isPlainObject(f.photoArea)) {
    f.photoArea = { x: 0, y: 0, width: f.canvasWidth, height: f.canvasHeight, borderRadius: 0 };
  } else {
    f.photoArea = {
      x: Number.isFinite(Number(f.photoArea.x)) ? Number(f.photoArea.x) : 0,
      y: Number.isFinite(Number(f.photoArea.y)) ? Number(f.photoArea.y) : 0,
      width: Number(f.photoArea.width) > 0 ? Number(f.photoArea.width) : f.canvasWidth,
      height: Number(f.photoArea.height) > 0 ? Number(f.photoArea.height) : f.canvasHeight,
      borderRadius: Number(f.photoArea.borderRadius) >= 0 ? Number(f.photoArea.borderRadius) : 0
    };
  }
  return f;
}

function isValidQuoteRecord(q) {
  if (!isPlainObject(q)) return false;
  if (typeof q.id !== 'string' || q.id.trim().length === 0) return false;
  if (typeof q.text !== 'string' || q.text.trim().length === 0) return false;
  if (q.category !== undefined && (typeof q.category !== 'string' || q.category.trim().length === 0)) return false;
  if (q.status !== undefined && !['ACTIVE', 'HIDDEN'].includes(q.status)) return false;
  if (q.placements !== undefined && (!Array.isArray(q.placements) || !q.placements.every(p => typeof p === 'string'))) return false;
  return true;
}

function normalizeQuoteRecord(raw, idx = 0) {
  const q = JSON.parse(JSON.stringify(raw));
  q.id = q.id.trim();
  q.text = q.text.trim();
  q.category = typeof q.category === 'string' && q.category.trim() ? q.category.trim() : '🙏 อนุโมทนา';
  q.status = ['ACTIVE', 'HIDDEN'].includes(q.status) ? q.status : 'ACTIVE';
  q.placements = Array.isArray(q.placements) ? q.placements.filter(p => typeof p === 'string') : ['home'];
  q.sortOrder = typeof q.sortOrder === 'number' && Number.isFinite(q.sortOrder) ? q.sortOrder : idx + 1;
  return q;
}

function isValidActivityRecord(a) {
  if (!isPlainObject(a)) return false;
  if (typeof a.id !== 'string' || a.id.trim().length === 0) return false;
  const imgUrl = a.dataUrl || a.thumbnail;
  if (typeof imgUrl !== 'string' || imgUrl.trim().length === 0) return false;
  if (imgUrl.trim().toLowerCase().startsWith('javascript:')) return false;
  if (a.status !== undefined && !['ACTIVE', 'HIDDEN'].includes(a.status)) return false;
  if (a.timestamp !== undefined && (typeof a.timestamp !== 'number' || !Number.isFinite(a.timestamp))) return false;
  return true;
}

function normalizeActivityRecord(raw) {
  const a = JSON.parse(JSON.stringify(raw));
  a.id = a.id.trim();
  a.dataUrl = a.dataUrl || a.thumbnail;
  a.thumbnail = a.thumbnail || a.dataUrl;
  a.caption = typeof a.caption === 'string' ? a.caption : '';
  a.quoteText = typeof a.quoteText === 'string' ? a.quoteText : '';
  a.eventName = typeof a.eventName === 'string' && a.eventName.trim() ? a.eventName : 'กฐินคุณยายฯ';
  a.timestamp = typeof a.timestamp === 'number' && Number.isFinite(a.timestamp) ? a.timestamp : Date.now();
  a.dateStr = typeof a.dateStr === 'string' ? a.dateStr : '';
  const r = isPlainObject(a.reactions) ? a.reactions : {};
  a.reactions = {
    love: typeof r.love === 'number' && r.love >= 0 ? r.love : 0,
    sadhu: typeof r.sadhu === 'number' && r.sadhu >= 0 ? r.sadhu : 0,
    cheer: typeof r.cheer === 'number' && r.cheer >= 0 ? r.cheer : 0
  };
  a.status = ['ACTIVE', 'HIDDEN'].includes(a.status) ? a.status : 'ACTIVE';
  a.reported = Boolean(a.reported);
  a.reports = Array.isArray(a.reports) ? a.reports : [];
  return a;
}

function parseValidFrameList(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return null;
  try {
    const parsed = JSON.parse(rawStr);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed.every(item => isValidFrameRecord(item, { strict: false }))) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

// =========================================================================
// 1. FrameStore
// =========================================================================
const FrameStore = (() => {
  const STORAGE_KEY = PFS_STORAGE_CONSTANTS.FRAMES_V3_KEY;
  const OLD_STORAGE_KEY = PFS_STORAGE_CONSTANTS.FRAMES_V2_LEGACY_KEY;
  const LEGACY_BACKUP_KEY = PFS_STORAGE_CONSTANTS.FRAMES_V2_BACKUP_KEY;
  const MIGRATION_META_KEY = PFS_STORAGE_CONSTANTS.FRAMES_MIGRATION_META_KEY;
  const SEED_URL = 'frames.json';
  const ALT_SEED_URL = 'config/frames.json';
  const HASH_KEY = PFS_STORAGE_CONSTANTS.FRAMES_SEED_HASH_KEY;

  const DEFAULT_SEED_FRAMES = [
    {
      id: 'kathin-peacock-gold',
      name: 'กฐิน ๑๑๘ ปี นกยูงทองคำ',
      category: 'กฐิน',
      keywords: ['กฐิน', '๑๑๘ ปี', 'นกยูงทองคำ', 'คุณยายอาจารย์', 'ริบบิ้นน้ำเงิน'],
      filename: 'assets/frames/kathin-peacock-gold.png',
      thumbnail: 'assets/frames/kathin-peacock-gold-thumb.png',
      canvasWidth: 1024,
      canvasHeight: 1024,
      photoArea: { x: 0, y: 0, width: 1024, height: 1024, borderRadius: 0 },
      status: 'ACTIVE',
      sortOrder: 1,
      showInUserMode: true
    },
    {
      id: 'kathin-peacock-blue',
      name: 'กฐิน ๑๑๘ ปี นกยูงคู่แก้ว',
      category: 'กฐิน',
      keywords: ['กฐิน', '๑๑๘ ปี', 'นกยูงคู่', 'ดอกบัว', 'คุณยายอาจารย์'],
      filename: 'assets/frames/kathin-peacock-blue.png',
      thumbnail: 'assets/frames/kathin-peacock-blue-thumb.png',
      canvasWidth: 1024,
      canvasHeight: 1024,
      photoArea: { x: 0, y: 0, width: 1024, height: 1024, borderRadius: 0 },
      status: 'ACTIVE',
      sortOrder: 2,
      showInUserMode: true
    },
    {
      id: 'kathin-118',
      name: 'กฐิน ๑๑๘ ปี คุณยายอาจารย์',
      category: 'กฐิน',
      keywords: ['กฐิน', 'งานบุญ', 'นกยูง', 'จันทร์ ขนนกยูง', 'คุณยายอาจารย์'],
      filename: 'assets/frames/kathin-118.png',
      thumbnail: 'assets/frames/kathin-118-thumb.png',
      canvasWidth: 2351,
      canvasHeight: 2351,
      photoArea: { x: 0, y: 0, width: 2351, height: 2351, borderRadius: 0 },
      status: 'ACTIVE',
      sortOrder: 3,
      showInUserMode: true
    },
    {
      id: 'muthita',
      name: 'มุทิตาสักการะ มหารัตนกตัญญู',
      category: 'มุทิตาสักการะ',
      keywords: ['มุทิตา', 'สักการะ', 'กตัญญู', 'พระเถระ'],
      filename: 'assets/frames/muthita.png',
      thumbnail: 'assets/frames/muthita-thumb.png',
      canvasWidth: 1600,
      canvasHeight: 1600,
      photoArea: { x: 0, y: 0, width: 1600, height: 1600, borderRadius: 0 },
      status: 'ACTIVE',
      sortOrder: 4
    },
    {
      id: 'boon-anamai',
      name: 'มหาทานบารมี ตักบาตรพระ',
      category: 'งานบุญ',
      keywords: ['งานบุญ', 'ตักบาตร', 'ทานบารมี', 'บุญกุศล'],
      filename: 'assets/frames/boon-anamai.png',
      thumbnail: 'assets/frames/boon-anamai-thumb.png',
      canvasWidth: 1600,
      canvasHeight: 1600,
      photoArea: { x: 0, y: 0, width: 1600, height: 1600, borderRadius: 0 },
      status: 'ACTIVE',
      sortOrder: 5
    },
    {
      id: 'piti-charoen',
      name: 'พิธีเจริญพระพุทธมนต์ มิ่งมงคล',
      category: 'พิธี',
      keywords: ['พิธี', 'เจริญพระพุทธมนต์', 'มงคล', 'สิริมงคล'],
      filename: 'assets/frames/piti-charoen.png',
      thumbnail: 'assets/frames/piti-charoen-thumb.png',
      canvasWidth: 1600,
      canvasHeight: 1600,
      photoArea: { x: 0, y: 0, width: 1600, height: 1600, borderRadius: 0 },
      status: 'ACTIVE',
      sortOrder: 6
    },
    {
      id: 'suan-mon',
      name: 'ปฏิบัติธรรมกลั่นใจใส สว่างบริสุทธิ์',
      category: 'อื่น ๆ',
      keywords: ['ปฏิบัติธรรม', 'สมาธิ', 'กลั่นใจใส', 'ภาวนา'],
      filename: 'assets/frames/suan-mon.png',
      thumbnail: 'assets/frames/suan-mon-thumb.png',
      canvasWidth: 1600,
      canvasHeight: 1600,
      photoArea: { x: 0, y: 0, width: 1600, height: 1600, borderRadius: 0 },
      status: 'ACTIVE',
      sortOrder: 7
    }
  ];

  let cache = null;

  function sanitizeFrame(f) {
    if (!f) return f;
    if (f.id === 'kathin-peacock-blue') {
      f.filename = 'assets/frames/kathin-peacock-blue.png';
      f.thumbnail = 'assets/frames/kathin-peacock-blue-thumb.png';
      f.canvasWidth = 1024;
      f.canvasHeight = 1024;
      f.showInUserMode = true;
      if (f.photoArea) {
        f.photoArea.width = 1024;
        f.photoArea.height = 1024;
      }
    } else if (f.id === 'kathin-peacock-gold') {
      if (!f.filename || f.filename.startsWith('blob:')) {
        f.filename = 'assets/frames/kathin-peacock-gold.png';
      }
      if (!f.thumbnail || f.thumbnail.startsWith('blob:')) {
        f.thumbnail = 'assets/frames/kathin-peacock-gold-thumb.png';
      }
      f.canvasWidth = 1024;
      f.canvasHeight = 1024;
      f.showInUserMode = true;
    } else if (f.id === 'kathin-118') {
      if (!f.filename || f.filename.startsWith('blob:')) {
        f.filename = 'assets/frames/kathin-118.png';
      }
      if (!f.thumbnail || f.thumbnail.startsWith('blob:')) {
        f.thumbnail = 'assets/frames/kathin-118-thumb.png';
      }
      f.showInUserMode = true;
    }
    return f;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      window.dispatchEvent(new CustomEvent('pfs:frames_updated'));
    } catch (err) {
      console.error('[FrameStore] persist failed:', err);
      throw new Error('พื้นที่จัดเก็บในเบราว์เซอร์เต็ม ลองลดขนาดภาพ');
    }
  }

  function genId() {
    return 'frame_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  async function fetchServerSeedText() {
    try {
      let seedRes = await fetch(SEED_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (!seedRes.ok) seedRes = await fetch(ALT_SEED_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (seedRes && seedRes.ok) {
        return await seedRes.text();
      }
    } catch (e) {
      // Offline or fetch unavailable
    }
    return null;
  }

  /**
   * Deterministic, idempotent migration from pfs_frames_v2 -> pfs_frames_v3.
   * Rules:
   *  1. If valid canonical v3 data already exists, ALWAYS prefer v3 and never overwrite with v2.
   *  2. If v3 is missing/corrupt and valid v2 exists:
   *     - Back up raw v2 string to pfs_frames_v2_backup before writing v3.
   *     - Do NOT delete pfs_frames_v2 automatically.
   *     - Normalize & sanitize frames, write to pfs_frames_v3, and record migration metadata.
   *  3. If v2 is corrupt/invalid, leave v2 untouched, record status, and return migrated: false.
   */
  function migrateFromV2() {
    const existingV3 = parseValidFrameList(localStorage.getItem(STORAGE_KEY));
    if (existingV3) {
      return {
        migrated: false,
        status: 'preserved_v3',
        count: existingV3.length,
        frames: existingV3.map(f => sanitizeFrame(normalizeFrameRecord(f)))
      };
    }

    const rawV2 = localStorage.getItem(OLD_STORAGE_KEY);
    if (!rawV2) {
      return { migrated: false, status: 'no_legacy_v2', count: 0, frames: null };
    }

    let parsedV2;
    try {
      parsedV2 = JSON.parse(rawV2);
    } catch (e) {
      localStorage.setItem(MIGRATION_META_KEY, JSON.stringify({
        version: 3,
        fromVersion: 2,
        status: 'rejected_corrupt_json',
        checkedAt: new Date().toISOString()
      }));
      return { migrated: false, status: 'rejected_corrupt_json', count: 0, frames: null };
    }

    if (!Array.isArray(parsedV2) || parsedV2.length === 0) {
      localStorage.setItem(MIGRATION_META_KEY, JSON.stringify({
        version: 3,
        fromVersion: 2,
        status: 'rejected_invalid_collection',
        checkedAt: new Date().toISOString()
      }));
      return { migrated: false, status: 'rejected_invalid_collection', count: 0, frames: null };
    }

    // Filter/validate source records; require all records in legacy array to be valid frame objects
    const seenIds = new Set();
    const migratedFrames = [];
    for (const item of parsedV2) {
      if (!isValidFrameRecord(item, { strict: false })) {
        localStorage.setItem(MIGRATION_META_KEY, JSON.stringify({
          version: 3,
          fromVersion: 2,
          status: 'rejected_invalid_item',
          checkedAt: new Date().toISOString()
        }));
        return { migrated: false, status: 'rejected_invalid_item', count: 0, frames: null };
      }
      const norm = sanitizeFrame(normalizeFrameRecord(item));
      if (!seenIds.has(norm.id)) {
        seenIds.add(norm.id);
        migratedFrames.push(norm);
      }
    }

    // Back up legacy v2 data before writing canonical v3 (never delete v2 automatically)
    if (!localStorage.getItem(LEGACY_BACKUP_KEY)) {
      localStorage.setItem(LEGACY_BACKUP_KEY, rawV2);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedFrames));
    localStorage.setItem(MIGRATION_META_KEY, JSON.stringify({
      version: 3,
      fromVersion: 2,
      status: 'migrated',
      count: migratedFrames.length,
      migratedAt: new Date().toISOString()
    }));

    return {
      migrated: true,
      status: 'migrated',
      count: migratedFrames.length,
      frames: migratedFrames
    };
  }

  async function syncSeedHashWithServer() {
    const seedText = await fetchServerSeedText();
    if (seedText) {
      localStorage.setItem(HASH_KEY, computeSeedHash(seedText));
    }
  }

  async function ensureLoaded() {
    if (cache) return cache.map(sanitizeFrame);

    // 1. Run deterministic v2 -> v3 migration check first (idempotent; preserves valid v3)
    const migration = migrateFromV2();
    const existingV3 = migration.frames || parseValidFrameList(localStorage.getItem(STORAGE_KEY));

    // 2. Check server seed for Method B master updates
    const seedText = await fetchServerSeedText();
    if (seedText) {
      try {
        const serverHash = computeSeedHash(seedText);
        const lastHash = localStorage.getItem(HASH_KEY);
        const parsedSeed = JSON.parse(seedText);

        if (Array.isArray(parsedSeed) && parsedSeed.length > 0) {
          const serverFrames = parsedSeed.map(f => sanitizeFrame(normalizeFrameRecord(f)));

          if (!existingV3) {
            // Fresh store or after reset: initialize from server seed
            cache = serverFrames;
            localStorage.setItem(HASH_KEY, serverHash);
            persist();
            return cache;
          }

          if (lastHash === null) {
            // Canonical v3 already populated (e.g. migrated from v2 or pre-seeded):
            // preserve existing v3 records and record baseline seed hash without overwriting user edits
            const existingIds = new Set(existingV3.map(f => f.id));
            const missingSeedFrames = migration.migrated
              ? serverFrames.filter(sf => !existingIds.has(sf.id))
              : [];
            cache = [...existingV3, ...missingSeedFrames].map(sanitizeFrame);
            localStorage.setItem(HASH_KEY, serverHash);
            if (missingSeedFrames.length > 0) {
              persist();
            }
            return cache;
          }

          if (serverHash !== lastHash) {
            // Genuine server seed update on GitHub (Method B): refresh server frames + keep local custom frames
            const serverIds = new Set(serverFrames.map(f => f.id));
            const localCustom = existingV3.filter(f => !serverIds.has(f.id));
            cache = [...serverFrames, ...localCustom].map(sanitizeFrame);
            localStorage.setItem(HASH_KEY, serverHash);
            persist();
            return cache;
          }
        }
      } catch (e) {
        console.warn('[FrameStore] Invalid server seed JSON, falling back to local cache', e);
      }
    }

    // 3. Use valid canonical v3 local storage
    if (existingV3 && existingV3.length > 0) {
      cache = existingV3.map(f => sanitizeFrame(normalizeFrameRecord(f)));
      return cache;
    }

    // 4. Offline fallback to built-in seed defaults
    cache = JSON.parse(JSON.stringify(DEFAULT_SEED_FRAMES)).map(sanitizeFrame);
    persist();
    return cache;
  }

  function nextSortOrder(list) {
    return list.reduce((max, f) => Math.max(max, f.sortOrder || 0), 0) + 1;
  }

  const api = {
    STORAGE_KEY,
    OLD_STORAGE_KEY,
    LEGACY_BACKUP_KEY,
    MIGRATION_META_KEY,
    HASH_KEY,

    async getAll() {
      const list = await ensureLoaded();
      return [...list].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    async getActive() {
      const all = await api.getAll();
      return all.filter((f) => f.status === 'ACTIVE');
    },

    async getCategories() {
      const active = await api.getActive();
      const set = new Set(active.map((f) => f.category).filter(Boolean));
      const requiredOrder = ['ทั้งหมด', 'กฐิน', 'มุทิตาสักการะ', 'งานบุญ', 'พิธี', 'อื่น ๆ'];
      const dynamicCats = Array.from(set).filter(c => !requiredOrder.includes(c));
      return [...requiredOrder, ...dynamicCats];
    },

    async getById(id) {
      const all = await api.getAll();
      return all.find((f) => f.id === id) || null;
    },

    async save(frame) {
      await ensureLoaded();
      if (!frame.id) frame.id = genId();
      if (!frame.sortOrder) frame.sortOrder = nextSortOrder(cache);
      const normalized = sanitizeFrame(normalizeFrameRecord(frame));
      const idx = cache.findIndex((f) => f.id === normalized.id);
      if (idx >= 0) cache[idx] = normalized;
      else cache.push(normalized);
      persist();
      return normalized;
    },

    async remove(id) {
      await ensureLoaded();
      cache = cache.filter((f) => f.id !== id);
      persist();
    },

    async duplicate(id) {
      const src = await api.getById(id);
      if (!src) return null;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = genId();
      copy.name = src.name + ' (สำเนา)';
      copy.status = 'DRAFT';
      copy.sortOrder = nextSortOrder(await api.getAll());
      await api.save(copy);
      return copy;
    },

    async move(id, direction) {
      const all = await api.getAll();
      const idx = all.findIndex((f) => f.id === id);
      const swapIdx = idx + direction;
      if (idx < 0 || swapIdx < 0 || swapIdx >= all.length) return;
      const a = all[idx];
      const b = all[swapIdx];
      const tmp = a.sortOrder;
      a.sortOrder = b.sortOrder;
      b.sortOrder = tmp;
      await api.save(a);
      await api.save(b);
    },

    async setStatus(id, status) {
      const f = await api.getById(id);
      if (!f) return;
      f.status = status;
      await api.save(f);
    },

    async replaceAll(frames) {
      if (!Array.isArray(frames)) {
        throw new Error('รายการกรอบภาพต้องเป็น Array');
      }
      cache = frames.map(f => sanitizeFrame(normalizeFrameRecord(f)));
      await syncSeedHashWithServer();
      persist();
      return [...cache];
    },

    hasValidV3Data() {
      return Boolean(parseValidFrameList(localStorage.getItem(STORAGE_KEY)));
    },

    migrateFromV2,

    invalidateCache() {
      cache = null;
    },

    genId,

    async resetToSeed() {
      cache = null;
      const rawV2 = localStorage.getItem(OLD_STORAGE_KEY);
      if (rawV2 && !localStorage.getItem(LEGACY_BACKUP_KEY)) {
        try {
          localStorage.setItem(LEGACY_BACKUP_KEY, rawV2);
        } catch (e) {}
      }
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(OLD_STORAGE_KEY);
      localStorage.removeItem(HASH_KEY);
      localStorage.removeItem(MIGRATION_META_KEY);
      await ensureLoaded();
    }
  };

  return api;
})();


// =========================================================================
// 2. QuoteStore — Message / Quote Library
// =========================================================================
const QuoteStore = (() => {
  const STORAGE_KEY = PFS_STORAGE_CONSTANTS.QUOTES_KEY;
  const SEED_URL = 'config/quotes.json';
  const ALT_SEED_URL = '../config/quotes.json';
  const HASH_KEY = PFS_STORAGE_CONSTANTS.QUOTES_SEED_HASH_KEY;

  let cache = null;

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      window.dispatchEvent(new CustomEvent('pfs:quotes_updated'));
    } catch (err) {
      console.error('[QuoteStore] persist failed:', err);
      throw new Error('พื้นที่จัดเก็บในเบราว์เซอร์เต็ม ไม่สามารถบันทึกคำคมได้');
    }
  }

  function genId() {
    return 'quote_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  async function fetchServerSeedText() {
    try {
      let seedRes = await fetch(SEED_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (!seedRes.ok) seedRes = await fetch(ALT_SEED_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (seedRes && seedRes.ok) {
        return await seedRes.text();
      }
    } catch (e) {
      // offline or fetch failed
    }
    return null;
  }

  function parseExistingQuotes() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidQuoteRecord)) {
        return parsed.map((q, idx) => normalizeQuoteRecord(q, idx));
      }
    } catch (e) {
      console.warn('[QuoteStore] Corrupt cache, reloading');
    }
    return null;
  }

  async function syncSeedHashWithServer() {
    const seedText = await fetchServerSeedText();
    if (seedText) {
      localStorage.setItem(HASH_KEY, computeSeedHash(seedText));
    }
  }

  async function ensureLoaded() {
    if (cache) return cache;

    const existing = parseExistingQuotes();
    const seedText = await fetchServerSeedText();

    if (seedText) {
      try {
        const serverHash = computeSeedHash(seedText);
        const lastHash = localStorage.getItem(HASH_KEY);
        const parsedSeed = JSON.parse(seedText);

        if (Array.isArray(parsedSeed) && parsedSeed.length > 0) {
          if (!existing) {
            cache = parsedSeed.map((q, idx) => normalizeQuoteRecord(q, idx));
            localStorage.setItem(HASH_KEY, serverHash);
            persist();
            return cache;
          }

          if (lastHash === null) {
            cache = existing;
            localStorage.setItem(HASH_KEY, serverHash);
            return cache;
          }

          if (serverHash !== lastHash) {
            cache = parsedSeed.map((q, idx) => normalizeQuoteRecord(q, idx));
            localStorage.setItem(HASH_KEY, serverHash);
            persist();
            return cache;
          }
        }
      } catch (e) {
        // fallback to existing or default
      }
    }

    if (existing) {
      cache = existing;
      return cache;
    }

    cache = [
      {
        id: 'quote-1',
        text: 'อนุโมทนาบุญใหญ่ ขอให้เจริญด้วยอายุ วรรณะ สุขะ พละ และปฏิภาณ',
        category: '🙏 อนุโมทนา',
        status: 'ACTIVE',
        placements: ['home', 'final', 'activity', 'share'],
        sortOrder: 1
      }
    ];
    persist();
    return cache;
  }

  const api = {
    STORAGE_KEY,
    HASH_KEY,

    async getAll() {
      const list = await ensureLoaded();
      return [...list].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    },

    async getActive() {
      const all = await api.getAll();
      return all.filter(q => q.status === 'ACTIVE');
    },

    async getByPlacement(placement) {
      const active = await api.getActive();
      return active.filter(q => Array.isArray(q.placements) && q.placements.includes(placement));
    },

    async getByCategory(category) {
      const active = await api.getActive();
      return active.filter(q => q.category === category);
    },

    async getCategories() {
      return [
        '🙏 อนุโมทนา',
        '🌸 คำอวยพร',
        '✨ ข้อคิด',
        '🪷 ธรรมะ',
        '💛 กำลังใจ',
        '🎉 กิจกรรม',
        '📸 สำหรับภาพ'
      ];
    },

    async save(quote) {
      await ensureLoaded();
      if (!quote.id) quote.id = genId();
      if (!quote.sortOrder) quote.sortOrder = (cache.length || 0) + 1;
      const normalized = normalizeQuoteRecord(quote, cache.length);
      const idx = cache.findIndex(q => q.id === normalized.id);
      if (idx >= 0) cache[idx] = normalized;
      else cache.push(normalized);
      persist();
      return normalized;
    },

    async remove(id) {
      await ensureLoaded();
      cache = cache.filter(q => q.id !== id);
      persist();
    },

    async duplicate(id) {
      await ensureLoaded();
      const src = cache.find(q => q.id === id);
      if (!src) return null;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = genId();
      copy.text = src.text + ' (สำเนา)';
      copy.sortOrder = (cache.length || 0) + 1;
      await api.save(copy);
      return copy;
    },

    async toggleStatus(id) {
      await ensureLoaded();
      const q = cache.find(item => item.id === id);
      if (q) {
        q.status = q.status === 'ACTIVE' ? 'HIDDEN' : 'ACTIVE';
        persist();
      }
      return q;
    },

    async replaceAll(quotes) {
      if (!Array.isArray(quotes)) {
        throw new Error('รายการคำคมต้องเป็น Array');
      }
      cache = quotes.map((q, idx) => normalizeQuoteRecord(q, idx));
      await syncSeedHashWithServer();
      persist();
      return [...cache];
    },

    async resetToSeed() {
      cache = null;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(HASH_KEY);
      await ensureLoaded();
    },

    invalidateCache() {
      cache = null;
    }
  };

  return api;
})();


// =========================================================================
// 3. ActivityStore — Community Activity Wall, Reactions & Moderation
// =========================================================================
const ActivityStore = (() => {
  const STORAGE_KEY = PFS_STORAGE_CONSTANTS.ACTIVITIES_KEY;
  const CREATOR_KEY = PFS_STORAGE_CONSTANTS.CREATIONS_COUNT_KEY;
  let cache = null;

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      window.dispatchEvent(new CustomEvent('pfs:activities_updated'));
    } catch (err) {
      console.warn('[ActivityStore] Storage limit reached, evicting oldest item');
      if (cache.length > 5) {
        cache.shift();
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
          window.dispatchEvent(new CustomEvent('pfs:activities_updated'));
          return;
        } catch (e) {}
      }
      throw new Error('พื้นที่จัดเก็บกิจกรรมเต็ม ไม่สามารถบันทึกได้');
    }
  }

  function ensureLoaded() {
    if (cache) return cache;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cache = parsed.filter(isValidActivityRecord).map(normalizeActivityRecord);
          return cache;
        }
      } catch (e) {}
    }
    cache = [];
    return cache;
  }

  function genId() {
    return 'act_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function formatThaiDate(dateObj) {
    const d = dateObj || new Date();
    const months = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear() + 543;
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} • ${hours}:${mins} น.`;
  }

  const api = {
    STORAGE_KEY,
    CREATOR_KEY,

    async getAll() {
      ensureLoaded();
      return [...cache].sort((a, b) => b.timestamp - a.timestamp);
    },

    async getActive() {
      const all = await api.getAll();
      return all.filter(item => item.status === 'ACTIVE');
    },

    async addSubmission({ dataUrl, thumbnail, caption, eventName, quoteText }) {
      ensureLoaded();
      const now = new Date();
      const submission = {
        id: genId(),
        dataUrl,
        thumbnail: thumbnail || dataUrl,
        caption: caption || '',
        quoteText: quoteText || '',
        eventName: eventName || 'กฐินคุณยายฯ',
        dateStr: formatThaiDate(now),
        timestamp: now.getTime(),
        reactions: {
          love: 0,
          sadhu: 0,
          cheer: 0
        },
        status: 'ACTIVE',
        reported: false,
        reports: []
      };

      cache.unshift(submission);
      persist();

      // Track creations
      api.recordCreation();
      return submission;
    },

    recordCreation() {
      const count = parseInt(localStorage.getItem(CREATOR_KEY) || '0', 10) + 1;
      localStorage.setItem(CREATOR_KEY, String(count));
    },

    async react(id, reactionType) {
      ensureLoaded();
      const item = cache.find(a => a.id === id);
      if (!item) return null;
      if (!item.reactions) item.reactions = { love: 0, sadhu: 0, cheer: 0 };
      if (typeof item.reactions[reactionType] === 'number') {
        item.reactions[reactionType]++;
      } else {
        item.reactions[reactionType] = 1;
      }
      persist();
      return item.reactions;
    },

    async report(id, reason) {
      ensureLoaded();
      const item = cache.find(a => a.id === id);
      if (!item) return false;
      item.reported = true;
      if (!item.reports) item.reports = [];
      item.reports.push({
        reason: reason || 'เนื้อหาไม่เหมาะสม',
        date: new Date().toISOString()
      });
      persist();
      return true;
    },

    async setStatus(id, status) {
      ensureLoaded();
      const item = cache.find(a => a.id === id);
      if (item) {
        item.status = status;
        persist();
      }
      return item;
    },

    async delete(id) {
      ensureLoaded();
      cache = cache.filter(a => a.id !== id);
      persist();
    },

    async replaceAll(activities) {
      if (!Array.isArray(activities)) {
        throw new Error('รายการกิจกรรมต้องเป็น Array');
      }
      cache = activities.map(normalizeActivityRecord);
      persist();
      return [...cache];
    },

    async resetToDefaults() {
      cache = [];
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CREATOR_KEY);
      window.dispatchEvent(new CustomEvent('pfs:activities_updated'));
    },

    invalidateCache() {
      cache = null;
    },

    async getStats() {
      ensureLoaded();
      const totalCreations = parseInt(localStorage.getItem(CREATOR_KEY) || '0', 10);

      let totalReactions = 0;
      cache.forEach(item => {
        if (item.reactions) {
          totalReactions += (item.reactions.love || 0) + (item.reactions.sadhu || 0) + (item.reactions.cheer || 0);
        }
      });

      const totalParticipants = cache.length;

      return {
        hasData: totalCreations > 0 || totalParticipants > 0 || totalReactions > 0,
        totalCreations: Math.max(totalCreations, totalParticipants),
        totalParticipants,
        totalReactions
      };
    }
  };

  return api;
})();


// =========================================================================
// 4. StorageBackup — Validated Backup, Atomic Restore & Reset Defaults (v3)
// =========================================================================
const StorageBackup = (() => {
  const SUPPORTED_VERSIONS = new Set(['1.0', '2.0', '3.0', 1, 2, 3]);

  function validateGasUrl(urlVal) {
    if (urlVal === undefined || urlVal === null || urlVal === '') return { ok: true, value: '' };
    if (typeof urlVal !== 'string') return { ok: false, error: 'ค่า gasWebAppUrl ต้องเป็นข้อความ (string)' };
    const trimmed = urlVal.trim();
    if (!trimmed) return { ok: true, value: '' };
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:') {
        return { ok: false, error: 'URL ของ Google Apps Script ต้องขึ้นต้นด้วย https://' };
      }
      return { ok: true, value: trimmed };
    } catch (e) {
      return { ok: false, error: 'รูปแบบ URL ของ Google Apps Script ไม่ถูกต้อง' };
    }
  }

  function validateBackup(rawInput) {
    const errors = [];
    let data = rawInput;

    if (typeof rawInput === 'string') {
      if (!rawInput.trim()) {
        return { valid: false, errors: ['ไฟล์สำรองข้อมูลว่างเปล่า'] };
      }
      try {
        data = JSON.parse(rawInput);
      } catch (e) {
        return { valid: false, errors: ['ไฟล์ไม่ใช่รูปแบบ JSON ที่ถูกต้อง'] };
      }
    }

    if (!isPlainObject(data)) {
      return { valid: false, errors: ['โครงสร้างหลักของไฟล์ Backup ต้องเป็น JSON Object'] };
    }

    if (data.version !== undefined && !SUPPORTED_VERSIONS.has(data.version)) {
      errors.push(`ไม่รองรับเวอร์ชันของไฟล์สำรองข้อมูล (${String(data.version)})`);
    }

    const hasFramesKey = Object.prototype.hasOwnProperty.call(data, 'frames');
    const hasQuotesKey = Object.prototype.hasOwnProperty.call(data, 'quotes');
    const hasActivitiesKey = Object.prototype.hasOwnProperty.call(data, 'activities');

    if (!hasFramesKey && !hasQuotesKey && !hasActivitiesKey) {
      errors.push('ไม่พบข้อมูล frames, quotes หรือ activities ในไฟล์สำรองข้อมูล');
    }

    const isLegacyBackup = data.version === undefined || data.version === '1.0' || data.version === '2.0' || data.version === 1 || data.version === 2;

    let normalizedFrames = null;
    if (hasFramesKey) {
      if (!Array.isArray(data.frames)) {
        errors.push('ข้อมูล frames ต้องเป็น Array');
      } else {
        const seenIds = new Set();
        normalizedFrames = [];
        data.frames.forEach((f, idx) => {
          if (!isValidFrameRecord(f, { strict: !isLegacyBackup })) {
            errors.push(`ข้อมูลกรอบภาพลำดับที่ ${idx + 1} ไม่ถูกต้องตามโครงสร้าง`);
            return;
          }
          const norm = normalizeFrameRecord(f);
          if (seenIds.has(norm.id)) {
            errors.push(`พบรหัสกรอบภาพซ้ำกัน: ${norm.id}`);
            return;
          }
          seenIds.add(norm.id);
          normalizedFrames.push(norm);
        });
      }
    }

    let normalizedQuotes = null;
    if (hasQuotesKey) {
      if (!Array.isArray(data.quotes)) {
        errors.push('ข้อมูล quotes ต้องเป็น Array');
      } else {
        const seenQuoteIds = new Set();
        normalizedQuotes = [];
        data.quotes.forEach((q, idx) => {
          if (!isValidQuoteRecord(q)) {
            errors.push(`ข้อมูลคำคมลำดับที่ ${idx + 1} ไม่ถูกต้องตามโครงสร้าง`);
            return;
          }
          const norm = normalizeQuoteRecord(q, idx);
          if (seenQuoteIds.has(norm.id)) {
            errors.push(`พบรหัสคำคมซ้ำกัน: ${norm.id}`);
            return;
          }
          seenQuoteIds.add(norm.id);
          normalizedQuotes.push(norm);
        });
      }
    }

    let normalizedActivities = null;
    if (hasActivitiesKey) {
      if (!Array.isArray(data.activities)) {
        errors.push('ข้อมูล activities ต้องเป็น Array');
      } else {
        const seenActIds = new Set();
        normalizedActivities = [];
        data.activities.forEach((a, idx) => {
          if (!isValidActivityRecord(a)) {
            errors.push(`ข้อมูลกิจกรรมลำดับที่ ${idx + 1} ไม่ถูกต้องตามโครงสร้าง`);
            return;
          }
          const norm = normalizeActivityRecord(a);
          if (seenActIds.has(norm.id)) {
            errors.push(`พบรหัสกิจกรรมซ้ำกัน: ${norm.id}`);
            return;
          }
          seenActIds.add(norm.id);
          normalizedActivities.push(norm);
        });
      }
    }

    let normalizedSettings = null;
    if (data.settings !== undefined) {
      if (!isPlainObject(data.settings)) {
        errors.push('ข้อมูล settings ต้องเป็น Object');
      } else if (data.settings.gasWebAppUrl !== undefined) {
        const gasCheck = validateGasUrl(data.settings.gasWebAppUrl);
        if (!gasCheck.ok) {
          errors.push(gasCheck.error);
        } else {
          normalizedSettings = { gasWebAppUrl: gasCheck.value };
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      normalized: {
        version: '3.0',
        sourceVersion: data.version || 'legacy',
        frames: normalizedFrames,
        quotes: normalizedQuotes,
        activities: normalizedActivities,
        settings: normalizedSettings
      }
    };
  }

  function snapshotKeys(keys) {
    const snap = new Map();
    for (const k of keys) {
      snap.set(k, localStorage.getItem(k));
    }
    return snap;
  }

  function restoreSnapshot(snap) {
    for (const [k, val] of snap.entries()) {
      try {
        if (val === null) localStorage.removeItem(k);
        else localStorage.setItem(k, val);
      } catch (e) {}
    }
    FrameStore.invalidateCache();
    QuoteStore.invalidateCache();
    ActivityStore.invalidateCache();
  }

  function notifyCrossTabSync(reason) {
    try {
      localStorage.setItem(PFS_STORAGE_CONSTANTS.SYNC_PING_KEY, JSON.stringify({
        reason,
        at: Date.now()
      }));
    } catch (e) {}
  }

  async function exportBackup() {
    const frames = await FrameStore.getAll();
    const quotes = await QuoteStore.getAll();
    const activities = await ActivityStore.getAll();
    const gasUrl = localStorage.getItem(PFS_STORAGE_CONSTANTS.GAS_URL_KEY) || '';

    return {
      schema: 'bunludham-pfs-backup',
      version: '3.0',
      storageVersion: 3,
      exportedAt: new Date().toISOString(),
      settings: { gasWebAppUrl: gasUrl },
      frames,
      quotes,
      activities
    };
  }

  async function restoreBackup(rawInput) {
    const validation = validateBackup(rawInput);
    if (!validation.valid) {
      throw new Error('ไฟล์สำรองข้อมูลไม่ผ่านการตรวจสอบ: ' + validation.errors.join('; '));
    }

    const keysToGuard = [
      PFS_STORAGE_CONSTANTS.FRAMES_V3_KEY,
      PFS_STORAGE_CONSTANTS.FRAMES_V2_LEGACY_KEY,
      PFS_STORAGE_CONSTANTS.FRAMES_V2_BACKUP_KEY,
      PFS_STORAGE_CONSTANTS.FRAMES_SEED_HASH_KEY,
      PFS_STORAGE_CONSTANTS.FRAMES_MIGRATION_META_KEY,
      PFS_STORAGE_CONSTANTS.QUOTES_KEY,
      PFS_STORAGE_CONSTANTS.QUOTES_SEED_HASH_KEY,
      PFS_STORAGE_CONSTANTS.ACTIVITIES_KEY,
      PFS_STORAGE_CONSTANTS.GAS_URL_KEY
    ];
    const snap = snapshotKeys(keysToGuard);

    try {
      const { frames, quotes, activities, settings } = validation.normalized;

      if (frames !== null) {
        const rawV2 = localStorage.getItem(PFS_STORAGE_CONSTANTS.FRAMES_V2_LEGACY_KEY);
        if (rawV2 && !localStorage.getItem(PFS_STORAGE_CONSTANTS.FRAMES_V2_BACKUP_KEY)) {
          localStorage.setItem(PFS_STORAGE_CONSTANTS.FRAMES_V2_BACKUP_KEY, rawV2);
        }
        await FrameStore.replaceAll(frames);
      }

      if (quotes !== null) {
        await QuoteStore.replaceAll(quotes);
      }

      if (activities !== null) {
        await ActivityStore.replaceAll(activities);
      }

      if (settings && settings.gasWebAppUrl !== undefined) {
        if (settings.gasWebAppUrl) {
          localStorage.setItem(PFS_STORAGE_CONSTANTS.GAS_URL_KEY, settings.gasWebAppUrl);
        } else {
          localStorage.removeItem(PFS_STORAGE_CONSTANTS.GAS_URL_KEY);
        }
        if (window.PFS_CONFIG) {
          window.PFS_CONFIG.gasWebAppUrl = settings.gasWebAppUrl;
        }
      }

      notifyCrossTabSync('restore');

      return {
        restoredFrames: frames ? frames.length : 0,
        restoredQuotes: quotes ? quotes.length : 0,
        restoredActivities: activities ? activities.length : 0,
        restoredCounts: {
          frames: frames !== null ? frames.length : null,
          quotes: quotes !== null ? quotes.length : null,
          activities: activities !== null ? activities.length : null
        }
      };
    } catch (err) {
      restoreSnapshot(snap);
      throw new Error('กู้คืนข้อมูลไม่สำเร็จและคงข้อมูลเดิมไว้แล้ว: ' + err.message);
    }
  }

  async function resetAllDefaults() {
    await FrameStore.resetToSeed();
    await QuoteStore.resetToSeed();
    await ActivityStore.resetToDefaults();
    notifyCrossTabSync('reset_defaults');
  }

  return {
    validateBackup,
    exportBackup,
    restoreBackup,
    resetAllDefaults
  };
})();


// =========================================================================
// 5. Cross-tab Synchronization (Realtime Same-Device Sync — Storage v3)
// =========================================================================
function handleCrossTabStorageEvent(e) {
  if (!e || typeof e.key !== 'string') return false;

  if (e.key === PFS_STORAGE_CONSTANTS.FRAMES_V3_KEY) {
    FrameStore.invalidateCache();
    window.dispatchEvent(new CustomEvent('pfs:frames_updated', {
      detail: { source: 'cross-tab', key: e.key }
    }));
    return true;
  }

  // Legacy v2 compatibility: ONLY honor if canonical v3 data does NOT exist,
  // ensuring old v2 writes can never overwrite or invalidate valid v3 data.
  if (e.key === PFS_STORAGE_CONSTANTS.FRAMES_V2_LEGACY_KEY) {
    if (!FrameStore.hasValidV3Data()) {
      FrameStore.invalidateCache();
      window.dispatchEvent(new CustomEvent('pfs:frames_updated', {
        detail: { source: 'cross-tab-legacy-v2', key: e.key }
      }));
      return true;
    }
    return false;
  }

  if (e.key === PFS_STORAGE_CONSTANTS.QUOTES_KEY) {
    QuoteStore.invalidateCache();
    window.dispatchEvent(new CustomEvent('pfs:quotes_updated', {
      detail: { source: 'cross-tab', key: e.key }
    }));
    return true;
  }

  if (e.key === PFS_STORAGE_CONSTANTS.ACTIVITIES_KEY) {
    ActivityStore.invalidateCache();
    window.dispatchEvent(new CustomEvent('pfs:activities_updated', {
      detail: { source: 'cross-tab', key: e.key }
    }));
    return true;
  }

  return false;
}

function bindCrossTabSync() {
  if (window.__pfsStorageSyncListener) {
    return false;
  }
  window.__pfsStorageSyncListener = handleCrossTabStorageEvent;
  window.addEventListener('storage', window.__pfsStorageSyncListener);
  return true;
}

bindCrossTabSync();

window.PFS_STORAGE_CONSTANTS = PFS_STORAGE_CONSTANTS;
window.FrameStore = FrameStore;
window.QuoteStore = QuoteStore;
window.ActivityStore = ActivityStore;
window.StorageBackup = StorageBackup;
window.bindCrossTabSync = bindCrossTabSync;
window.PFS_bindCrossTabSync = bindCrossTabSync;


