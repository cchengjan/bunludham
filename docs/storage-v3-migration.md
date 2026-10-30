# Storage v3 Migration, Cross-Tab Sync & Backup Architecture

This document details the `LocalStorage` Storage v3 architecture in [`shared/storage.js`](../shared/storage.js), the historical `v2`/`v3` defects discovered during the engineering audit, and the deterministic fixes implemented across [`shared/storage.js`](../shared/storage.js), [`app.js`](../app.js), and [`admin.js`](../admin.js).

---

## 1. Root-Cause Audit of Legacy `v2` / `v3` Defects

Prior to the Storage v3 overhaul, `shared/storage.js` had migrated frame persistence from `pfs_frames_v2` to `pfs_frames_v3`, while downstream consumers in `app.js` and `admin.js` still referenced `pfs_frames_v2` directly:

| Defect ID | Location | Root Cause | Impact |
|---|---|---|---|
| **B1 — Cross-Tab Listener Mismatch** | `app.js` | `window.addEventListener('storage', ...)` checked `e.key === 'pfs_frames_v2'` instead of `'pfs_frames_v3'`, did not invalidate `FrameStore`'s in-memory cache, and risked duplicate listener registration if initialized multiple times. | Frame additions, edits, reordering, or toggles in `admin.html` never updated open `index.html` / `create.html` tabs until manual page reload. |
| **B2 — Unvalidated Backup & Restore** | `admin.js` | Export read raw `pfs_frames_v2` (often empty/stale) instead of canonical `FrameStore` v3 data. Restore wrote unchecked JSON directly into `pfs_frames_v2`, bypassed schema validation, lacked rollback on partial write failure, and never updated `pfs_frames_v3`. | Exporting backups omitted v3 frames; importing backups silently failed to update v3 frames or corrupted `LocalStorage` on malformed JSON. |
| **B3 — Incomplete Reset Defaults** | `admin.js` | Reset removed `pfs_frames_v2` instead of resetting `pfs_frames_v3` + `pfs_frames_seed_hash`, and left stale cache entries in memory. | Clicking "Reset Defaults" failed to restore the canonical seed frames/quotes or regressed after reload. |
| **B4 — Non-Idempotent `v2 -> v3` Migration** | `shared/storage.js` | Legacy `pfs_frames_v2` data needed deterministic, non-destructive migration into `pfs_frames_v3` without ever overwriting an already-valid `pfs_frames_v3` store. | Risk of stale `v2` records clobbering newer `v3` edits or losing user-created `v2` frames before backup. |

---

## 2. Canonical Storage v3 Key Inventory

| Key | Store / Owner | Format | Purpose |
|---|---|---|---|
| `pfs_frames_v3` | `FrameStore` | JSON Array of Frame objects | Canonical v3 frame definitions (built-in + custom frames, active flags, sort order, metadata) |
| `pfs_frames_seed_hash` | `FrameStore` | String hash | Tracks seed signature of `config/frames.json` for safe seed synchronization |
| `pfs_frames_v2` | Legacy (Read-only) | JSON Array | Legacy v2 frame store; read **only** when `pfs_frames_v3` is absent or invalid |
| `pfs_frames_v2_backup` | `FrameStore.migrateFromV2` | JSON Wrapper `{ backedUpAt, frames }` | Non-destructive backup created automatically during `v2 -> v3` migration |
| `pfs_quotes_v1` | `QuoteStore` | JSON Array of Quote objects | Canonical Dharma quotes store |
| `pfs_quotes_seed_hash` | `QuoteStore` | String hash | Tracks seed signature of `config/quotes.json` |
| `pfs_activities_v1` | `ActivityStore` | JSON Array of Activity objects | Community activity wall entries |
| `pfs_stats_v1` | `StatsStore` | JSON Object | Local usage counters (renders, downloads, shares) |
| `pfs_drive_config` | `DriveSync` | JSON Object | Optional Google Apps Script Web App URL & sync flags (untouched by frame reset) |

> **Security Invariant**: Authentication tokens, LINE OAuth tokens, CSRF tokens, and session identifiers are **never** stored in `LocalStorage` or `SessionStorage`.

---

## 3. Deterministic `v2 -> v3` Migration Rules (`FrameStore.migrateFromV2`)

1. **Valid `v3` Always Wins**:
   - If `pfs_frames_v3` exists and parses as a valid non-empty array of frame objects (`validateFrameRecord`), `migrateFromV2()` returns `{ migrated: false, status: 'v3_already_valid' }` without touching `pfs_frames_v3`.
2. **Legacy `v2` Normalization**:
   - If `pfs_frames_v3` is missing (or corrupted/unparseable) and `pfs_frames_v2` contains valid frame items, each item is normalized to the v3 schema (`id`, `name`, `category`, `imageUrl`/`dataUrl`, `thumbUrl`, `active`, `order`, `createdAt`, `updatedAt`).
3. **Non-Destructive Backup**:
   - Before writing `pfs_frames_v3`, the raw `pfs_frames_v2` payload is preserved in `pfs_frames_v2_backup` (if not already backed up), and `pfs_frames_v2` is **never** automatically deleted.
4. **Corrupt `v2` Fallback**:
   - If `pfs_frames_v2` contains malformed JSON or non-array data, `migrateFromV2()` logs a warning, avoids throwing an unhandled exception, and falls back cleanly to `config/frames.json` seed initialization (`status: 'corrupt_v2_ignored'`).
5. **Idempotence**:
   - Calling `FrameStore.migrateFromV2()` or `FrameStore.init()` repeatedly produces the exact same state (`migrated: false` on subsequent runs).

---

## 4. Cross-Tab Synchronization (`bindCrossTabSync`)

`window.bindCrossTabSync(callback)` (aliased as `window.PFS_bindCrossTabSync`) provides a singleton-guarded `window.addEventListener('storage', ...)` dispatcher:

- **Watched Keys**: `pfs_frames_v3`, `pfs_quotes_v1`, `pfs_activities_v1`, `pfs_stats_v1`.
- **Ignored Keys**: Unrelated keys AND legacy `pfs_frames_v2` writes are ignored so stale tabs or scripts cannot overwrite `pfs_frames_v3`.
- **Cache Invalidation**: When `e.key === 'pfs_frames_v3'` fires from another tab, `FrameStore.invalidateCache()` clears the in-memory frame cache before invoking registered subscriber callbacks (`app.js` re-renders the frame selector immediately; `admin.js` refreshes the admin table).
- **Duplicate Listener Guard**: Repeated calls to `bindCrossTabSync` register callbacks into an internal `Set` while attaching only **one** underlying DOM `storage` event listener.

---

## 5. Validated Backup, Atomic Restore & Reset (`StorageBackup`)

### 5.1 Export (`StorageBackup.exportBackup()`)
Produces a canonical `v3.0` JSON envelope:
```json
{
  "schemaVersion": "3.0",
  "app": "bunludham-photo-frame-studio",
  "exportedAt": "2026-10-28T06:00:00.000Z",
  "data": {
    "frames": [...],
    "quotes": [...],
    "activities": [...],
    "stats": {...}
  }
}
```

### 5.2 Validated Atomic Restore (`StorageBackup.restoreBackup(rawInput)`)
1. **Parse & Envelope Check**: Accepts JSON string or object. Supports both canonical `schemaVersion: "3.0"` payloads (`payload.data.*`) and legacy `v2.0` backup objects (`payload.frames`, `payload.quotes`, `payload.activities`).
2. **Strict Schema Validation**: Every frame, quote, and activity entry is validated (`id` string, required display fields, safe types) **before** any `LocalStorage` mutation occurs. Empty or malformed payloads throw a descriptive error with Thai user-facing messaging.
3. **Atomic Snapshot & Rollback**:
   - Captures an exact snapshot of `pfs_frames_v3`, `pfs_frames_seed_hash`, `pfs_quotes_v1`, `pfs_quotes_seed_hash`, `pfs_activities_v1`, and `pfs_stats_v1`.
   - Writes normalized records via canonical store APIs (`FrameStore.replaceAll`, `QuoteStore.replaceAll`, `ActivityStore.replaceAll`).
   - If any write fails (e.g., `QuotaExceededError`), the `catch` block restores every snapshotted key and invalidates caches so partial state never persists.
4. **Return Summary**: Returns `{ ok: true, schemaVersion, restoredFrames, restoredQuotes, restoredActivities, restoredCounts: { frames, quotes, activities } }`.

### 5.3 Reset Defaults (`StorageBackup.resetDefaults()`)
- Resets `FrameStore`, `QuoteStore`, and `ActivityStore` to their canonical seed defaults (`pfs_frames_v3`, `pfs_frames_seed_hash`, `pfs_quotes_v1`, `pfs_quotes_seed_hash`, `pfs_activities_v1`).
- Preserves unrelated `LocalStorage` keys (such as `pfs_drive_config` or third-party browser state).
- Requires explicit user confirmation in `admin.js` before execution and persists cleanly across page reloads.
