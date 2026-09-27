/**
 * DriveSync — เชื่อมต่อ Google Drive ผ่าน Google Apps Script Web App
 * ------------------------------------------------------------------
 * ทำงานเฉพาะเมื่อ window.PFS_CONFIG.gasWebAppUrl ถูกตั้งค่า
 * ปลอดภัย: ไม่มีการเก็บ Google Credentials / Client Secrets ใดๆ ใน Frontend
 *
 * โครงสร้างโฟลเดอร์ Google Drive ปลายทาง:
 * Photo Frame Studio/
 * ├── Frames/
 * ├── Original Photos/
 * ├── Finished Images/
 * └── Activity Images/
 */
const DriveSync = (() => {
  function getUrl() {
    return (window.PFS_CONFIG && window.PFS_CONFIG.gasWebAppUrl) || '';
  }

  function isConfigured() {
    return !!getUrl();
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        resolve(res.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * @param {'original'|'finished'|'frame'|'activity'} kind
   * @param {Blob} blob
   * @param {string} filename
   * @param {object} meta ข้อมูลเสริม เช่น { frameId, frameName, caption }
   */
  async function upload(kind, blob, filename, meta = {}) {
    const url = getUrl();
    if (!url) throw new Error('ยังไม่ได้ตั้งค่า Google Drive backend (PFS_CONFIG.gasWebAppUrl ว่างอยู่)');

    const dataBase64 = await blobToBase64(blob);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        type: kind,
        filename,
        mimeType: blob.type || 'image/png',
        dataBase64,
        ...meta,
      }),
    });

    if (!res.ok) throw new Error('อัปโหลดไม่สำเร็จ: HTTP ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'อัปโหลดไม่สำเร็จ');
    return json;
  }

  return {
    isConfigured,
    getUrl,
    uploadOriginal: (blob, filename, meta) => upload('original', blob, filename, meta),
    uploadFinished: (blob, filename, meta) => upload('finished', blob, filename, meta),
    uploadFrame: (blob, filename, meta) => upload('frame', blob, filename, meta),
    uploadActivity: (blob, filename, meta) => upload('activity', blob, filename, meta),
  };
})();
