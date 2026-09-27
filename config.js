// PFS_CONFIG — ตั้งค่าการเชื่อมต่อ Google Apps Script Web App
// ไม่มี secret / api key ใด ๆ ในไฟล์นี้ ปลอดภัยต่อการเปิดเผยใน Browser
window.PFS_CONFIG = {
  // วาง URL ของ Google Apps Script Web App ที่ deploy แล้วตรงนี้ (เช่น https://script.google.com/macros/s/.../exec)
  // หากเว้นว่างไว้ ระบบจะทำงานแบบ Full Offline / Local Browser ได้อย่างสมบูรณ์ 100%
  gasWebAppUrl: '',
};
