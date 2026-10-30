// PFS_CONFIG — ตั้งค่าการเชื่อมต่อระบบเสริม (Google Apps Script & Membership Backend API)
// หมายเหตุความปลอดภัย: ห้ามเก็บ Channel Secret, Session Secret หรือ Access Token ไว้ในไฟล์นี้หรือใน LocalStorage เด็ดขาด
(function () {
  'use strict';

  var savedGasUrl = '';
  try {
    if (typeof localStorage !== 'undefined') {
      savedGasUrl = localStorage.getItem('pfs_gas_url') || '';
    }
  } catch (_) {}

  var metaApiEl = (typeof document !== 'undefined' && document.querySelector)
    ? document.querySelector('meta[name="pfs-api-base-url"]')
    : null;
  var metaApiUrl = metaApiEl && metaApiEl.content ? metaApiEl.content.trim() : '';

  var isLocalhost = Boolean(
    typeof window !== 'undefined' &&
    window.location &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  );

  var existing = (typeof window !== 'undefined' && window.PFS_CONFIG) ? window.PFS_CONFIG : {};

  var resolvedConfig = {
    // URL ของ Google Apps Script Web App สำหรับสำรองภาพขึ้น Google Drive (ไม่บังคับ)
    gasWebAppUrl: existing.gasWebAppUrl || savedGasUrl || '',

    // URL ของ Backend API สำหรับระบบสมาชิก LINE Login v2.1 (Cloudflare Workers)
    // ในโหมดพัฒนาบนเครื่อง (localhost) จะชี้ไปยัง http://localhost:8787 อัตโนมัติ และหากออฟไลน์หน้าเว็บยังทำงานได้ตามปกติ
    apiBaseUrl: existing.apiBaseUrl !== undefined
      ? existing.apiBaseUrl
      : (metaApiUrl || (isLocalhost ? 'http://localhost:8787' : 'https://bunludham-membership-api.cchengjan63-a3b.workers.dev')),

    // เวอร์ชันนโยบายความเป็นส่วนตัวปัจจุบัน
    privacyPolicyVersion: existing.privacyPolicyVersion || '2026-01'
  };

  if (typeof window !== 'undefined') {
    window.PFS_CONFIG = resolvedConfig;
  }
})();
