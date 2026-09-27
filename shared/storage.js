/**
 * Storage.js — Photo Frame Studio Storage Engine
 * ------------------------------------------------------------
 * Manages:
 *  - FrameStore: Frame list & visual metadata (photoArea)
 *  - QuoteStore: Message library (Admin quotes & placement)
 *  - ActivityStore: Community submissions, reactions, statistics & moderation
 *
 * All data is stored in localStorage with asynchronous API.
 */

// =========================================================================
// 1. FrameStore
// =========================================================================
const FrameStore = (() => {
  const STORAGE_KEY = 'pfs_frames_v2';
  const SEED_URL = 'config/frames.json';
  const ALT_SEED_URL = '../config/frames.json';

  const HASH_KEY = 'pfs_frames_seed_hash';
  let cache = null;

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

  async function ensureLoaded() {
    if (cache) return cache;

    // Check if server seed has updated on GitHub (Method B)
    try {
      let seedRes = await fetch(SEED_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (!seedRes.ok) seedRes = await fetch(ALT_SEED_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (seedRes && seedRes.ok) {
        const seedText = await seedRes.text();
        const serverHash = String(seedText.length) + '_' + seedText.slice(0, 40);
        const lastHash = localStorage.getItem(HASH_KEY);

        if (serverHash !== lastHash) {
          const serverFrames = JSON.parse(seedText);
          const rawLocal = localStorage.getItem(STORAGE_KEY);
          let localCustom = [];
          if (rawLocal) {
            try {
              const localList = JSON.parse(rawLocal);
              if (Array.isArray(localList)) {
                const serverIds = new Set(serverFrames.map(f => f.id));
                localCustom = localList.filter(f => !serverIds.has(f.id));
              }
            } catch (err) {}
          }
          cache = [...serverFrames, ...localCustom];
          localStorage.setItem(HASH_KEY, serverHash);
          persist();
          return cache;
        }
      }
    } catch (e) {
      // offline or fetch failed, fallback to local storage
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        cache = JSON.parse(raw);
        if (Array.isArray(cache) && cache.length > 0) return cache;
      } catch (e) {
        console.warn('[FrameStore] Cache corrupt, reloading seed');
      }
    }

    try {
      let res = await fetch(SEED_URL, { cache: 'no-store' });
      if (!res.ok) res = await fetch(ALT_SEED_URL, { cache: 'no-store' });
      cache = await res.json();
    } catch (e) {
      console.warn('[FrameStore] Failed fetching seed, using defaults', e);
      cache = [
        {
          id: "kathin-peacock-gold",
          name: "กฐิน ๑๑๘ ปี นกยูงทองคำ",
          category: "กฐิน",
          keywords: ["กฐิน", "๑๑๘ ปี", "นกยูงทองคำ", "คุณยายอาจารย์", "ริบบิ้นน้ำเงิน"],
          filename: "assets/frames/kathin-peacock-gold.png",
          thumbnail: "assets/frames/kathin-peacock-gold-thumb.png",
          canvasWidth: 1024,
          canvasHeight: 1024,
          photoArea: { x: 0, y: 0, width: 1024, height: 1024, borderRadius: 0 },
          status: "ACTIVE",
          sortOrder: 1,
          showInUserMode: true
        },
        {
          id: "kathin-peacock-blue",
          name: "กฐิน ๑๑๘ ปี นกยูงคู่แก้ว",
          category: "กฐิน",
          keywords: ["กฐิน", "๑๑๘ ปี", "นกยูงคู่", "ดอกบัว", "คุณยายอาจารย์"],
          filename: "assets/frames/kathin-peacock-blue.png",
          thumbnail: "assets/frames/kathin-peacock-blue-thumb.png",
          canvasWidth: 1024,
          canvasHeight: 1024,
          photoArea: { x: 0, y: 0, width: 1024, height: 1024, borderRadius: 0 },
          status: "ACTIVE",
          sortOrder: 2,
          showInUserMode: true
        },
        {
          id: "kathin-118",
          name: "กฐิน ๑๑๘ ปี คุณยายอาจารย์",
          category: "กฐิน",
          keywords: ["กฐิน", "งานบุญ", "คุณยายอาจารย์"],
          filename: "assets/frames/kathin-118.png",
          thumbnail: "assets/frames/kathin-118-thumb.png",
          canvasWidth: 2351,
          canvasHeight: 2351,
          photoArea: { x: 0, y: 0, width: 2351, height: 2351, borderRadius: 0 },
          status: "ACTIVE",
          sortOrder: 3,
          showInUserMode: true
        }
      ];
    }
    persist();
    return cache;
  }

  function nextSortOrder(list) {
    return list.reduce((max, f) => Math.max(max, f.sortOrder || 0), 0) + 1;
  }

  const api = {
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
      const idx = cache.findIndex((f) => f.id === frame.id);
      if (idx >= 0) cache[idx] = frame;
      else cache.push(frame);
      persist();
      return frame;
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

    invalidateCache() {
      cache = null;
    },

    genId,

    async resetToSeed() {
      cache = null;
      localStorage.removeItem(STORAGE_KEY);
      await ensureLoaded();
    }
  };

  return api;
})();


// =========================================================================
// 2. QuoteStore — Message / Quote Library
// =========================================================================
const QuoteStore = (() => {
  const STORAGE_KEY = 'pfs_quotes_v2';
  const SEED_URL = 'config/quotes.json';
  const ALT_SEED_URL = '../config/quotes.json';
  const HASH_KEY = 'pfs_quotes_seed_hash';

  let cache = null;

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      window.dispatchEvent(new CustomEvent('pfs:quotes_updated'));
    } catch (err) {
      console.error('[QuoteStore] persist failed:', err);
    }
  }

  function genId() {
    return 'quote_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  async function ensureLoaded() {
    if (cache) return cache;

    // Check if server seed has updated on GitHub (Method B)
    try {
      let seedRes = await fetch(SEED_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (!seedRes.ok) seedRes = await fetch(ALT_SEED_URL + '?v=' + Date.now(), { cache: 'no-store' });
      if (seedRes && seedRes.ok) {
        const seedText = await seedRes.text();
        const serverHash = String(seedText.length) + '_' + seedText.slice(0, 40);
        const lastHash = localStorage.getItem(HASH_KEY);

        if (serverHash !== lastHash) {
          cache = JSON.parse(seedText);
          localStorage.setItem(HASH_KEY, serverHash);
          persist();
          return cache;
        }
      }
    } catch (e) {
      // offline or fetch failed
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        cache = JSON.parse(raw);
        if (Array.isArray(cache) && cache.length > 0) return cache;
      } catch (e) {
        console.warn('[QuoteStore] Corrupt cache, reloading');
      }
    }

    try {
      let res = await fetch(SEED_URL, { cache: 'no-store' });
      if (!res.ok) res = await fetch(ALT_SEED_URL, { cache: 'no-store' });
      cache = await res.json();
    } catch (e) {
      cache = [
        {
          id: "quote-1",
          text: "อนุโมทนาบุญใหญ่ ขอให้เจริญด้วยอายุ วรรณะ สุขะ พละ และปฏิภาณ",
          category: "🙏 อนุโมทนา",
          status: "ACTIVE",
          placements: ["home", "final", "activity", "share"],
          sortOrder: 1
        }
      ];
    }
    persist();
    return cache;
  }

  const api = {
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
      const idx = cache.findIndex(q => q.id === quote.id);
      if (idx >= 0) cache[idx] = quote;
      else cache.push(quote);
      persist();
      return quote;
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
  const STORAGE_KEY = 'pfs_activities_v2';
  const CREATOR_KEY = 'pfs_creations_count_v2';
  let cache = null;

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (err) {
      console.warn('[ActivityStore] Storage limit reached, evicting oldest item');
      if (cache.length > 5) {
        cache.shift();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)); } catch(e){}
      }
    }
  }

  function ensureLoaded() {
    if (cache) return cache;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        cache = JSON.parse(raw);
        if (Array.isArray(cache)) return cache;
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

    async getStats() {
      ensureLoaded();
      const totalCreations = parseInt(localStorage.getItem(CREATOR_KEY) || '0', 10);
      const activeItems = cache.filter(a => a.status === 'ACTIVE');
      
      let totalReactions = 0;
      cache.forEach(item => {
        if (item.reactions) {
          totalReactions += (item.reactions.love || 0) + (item.reactions.sadhu || 0) + (item.reactions.cheer || 0);
        }
      });

      // Genuine stats: participants count based on distinct submissions
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

// Cross-tab Synchronization (Realtime Same-Device Sync)
window.addEventListener('storage', (e) => {
  if (e.key === 'pfs_frames_v2') {
    FrameStore.invalidateCache();
    window.dispatchEvent(new CustomEvent('pfs:frames_updated'));
  }
  if (e.key === 'pfs_quotes_v2') {
    QuoteStore.invalidateCache();
    window.dispatchEvent(new CustomEvent('pfs:quotes_updated'));
  }
});

