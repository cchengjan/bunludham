// PFS_CONFIG — ตั้งค่าการเชื่อมต่อ Google Apps Script Web App
// รองรับทั้งการระบุในไฟล์โดยตรง หรือการตั้งค่าผ่านหน้า Admin (บันทึกใน LocalStorage)
window.PFS_CONFIG = {
  // หากต้องการระบุแบบตายตัว ให้ใส่ URL ที่นี่ (เช่น 'https://script.google.com/macros/s/.../exec')
  // หรือปล่อยว่างไว้ ระบบจะดึงค่าที่ตั้งผ่านหน้า Admin (LocalStorage) มาใช้อัตโนมัติ
  gasWebAppUrl: localStorage.getItem('pfs_gas_url') || '',
};
