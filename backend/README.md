# 🛠️ Bunludham Backend Services

โฟลเดอร์ `backend/` รองรับระบบหลังบ้าน 2 ส่วนที่ทำงานร่วมกันได้อย่างอิสระโดยไม่กระทบกัน:

1. **LINE Login v2.1 & Membership API (Cloudflare Workers + D1 / Local Node SQLite)** — ระบบสมาชิกอย่างเป็นทางการตามมาตรฐาน LINE OAuth 2.1 + PKCE + OpenID Connect, การจัดการเซสชันด้วย `HttpOnly` Cookie, ข้อมูลโปรไฟล์สมาชิก และการบันทึกความยินยอม PDPA
2. **Google Apps Script Storage (`Code.gs`)** — สคริปต์เสริมสำหรับซิงก์รูปภาพกิจกรรมและกรอบรูปขึ้น Google Drive / Google Sheets ของผู้ดูแลระบบโดยตรง

---

## ส่วนที่ 1: LINE Login v2.1 & Membership Backend (Cloudflare Workers + D1)

### ความต้องการของระบบ (Prerequisites)
- **Node.js `>= 22.5.0`** (ใช้โมดูลมาตรฐานในตัว `node:sqlite`, `node:test`, `node:crypto` โดยไม่ต้องคอมไพล์ native addon)

### คำสั่งใช้งานในเครื่อง (Local Development & QA)

```bash
# 1. คัดลอกไฟล์ตัวแปรสภาพแวดล้อมสำหรับรันในเครื่อง (ไม่ถูก commit ขึ้น Git)
cp backend/.dev.vars.example backend/.dev.vars

# 2. รัน Database Migrations พร้อมข้อมูลตัวอย่างสำหรับพัฒนา
npm --prefix backend run db:migrate:seed

# 3. เปิดเซิร์ฟเวอร์ API ในเครื่องที่พอร์ต 8787 (http://localhost:8787/api/v1/health)
npm --prefix backend run dev

# 4. รันชุดทดสอบอัตโนมัติทั้งหมด (Storage v3, Migrations, LINE OIDC, CSRF/RBAC Security, Frontend Integration)
npm --prefix backend test
```

### เอกสารทางวิศวกรรมเพิ่มเติม
- [Architecture Overview](../docs/architecture.md)
- [LINE Login v2.1 Setup Guide](../docs/line-login-setup.md)
- [Backend API Reference](../docs/backend-api.md)
- [Database Schema & Migrations](../docs/database-schema.md)
- [Security Controls](../docs/security.md)
- [Deployment Runbook (Cloudflare Workers + D1)](../docs/deployment.md)

---

## ส่วนที่ 2: ☁️ ขั้นตอนการติดตั้ง Google Apps Script สำหรับระบบจัดเก็บไฟล์ Google Drive (`Code.gs`)

คู่มือนี้สำหรับเชื่อมต่อ **Photo Frame Studio** เข้ากับ **Google Drive** และ **Google Sheets** ของคุณ เพื่อบันทึกภาพถ่าย ภาพกิจกรรม และภาพกรอบรูปอย่างปลอดภัย โดยไม่ต้องใช้เซิร์ฟเวอร์แยก

### 📌 ขั้นตอนการตั้งค่า (ใช้เวลาประมาณ 3 นาที)

#### 1. สร้างโปรเจกต์ Google Apps Script
1. ไปที่เว็บไซต์: [https://script.google.com/](https://script.google.com/)
2. คลิกปุ่ม **"โครงการใหม่" (New Project)** ทางด้านซ้ายบน
3. ตั้งชื่อโครงการ เช่น `Photo Frame Studio Backend`

#### 2. นำโค้ดไปวาง
1. ในหน้าแก้ไขโค้ด จะเห็นไฟล์ชื่อ `Code.gs`
2. ลบโค้ดเดิมออกทั้งหมด แล้วคัดลอกเนื้อหาจากไฟล์ [`backend/Code.gs`](Code.gs) ไปวางแทนที่
3. กดปุ่มบันทึก (ไอคอนรูปแผ่นดิสก์ 💾 หรือกด `Ctrl + S` / `Cmd + S`)

#### 3. Deploy เป็น Web App
1. คลิกปุ่ม **"การทำให้ใช้งานได้" (Deploy)** สีน้ำเงินด้านขวาบน -> เลือก **"การทำให้ใช้งานได้รายการใหม่" (New deployment)**
2. คลิกไอคอนรูปฟันเฟือง ⚙️ ข้าง "เลือกประเภท" -> เลือก **"เว็บแอป" (Web app)**
3. ตั้งค่าดังนี้:
   - **คำอธิบาย (Description)**: `v1.0 - Photo Frame Studio Storage`
   - **ดำเนินการในฐานะ (Execute as)**: **`ฉัน (Me)`** *(สำคัญมาก เพื่อให้สคริปต์ใช้สิทธิ์บันทึกลง Drive ของคุณ)*
   - **ผู้มีสิทธิ์เข้าถึง (Who has access)**: **`ทุกคน (Anyone)`** *(สำคัญมาก เพื่อให้เว็บแอปส่งภาพขึ้น Drive ได้)*
4. คลิกปุ่ม **"ทำให้ใช้งานได้" (Deploy)**

#### 4. ให้สิทธิ์การเข้าถึง (Authorize)
1. ในการ Deploy ครั้งแรก Google จะแสดงหน้าต่างขอสิทธิ์เข้าถึง ให้คลิก **"ให้สิทธิ์เข้าถึง" (Authorize access)**
2. เลือกบัญชี Google ของท่าน
3. หากมีหน้าต่างเตือนว่า *"Google ยังไม่ได้ยืนยันแอปนี้"* (Google hasn't verified this app):
   - คลิก **ขั้นสูง (Advanced)** ที่มุมล่างซ้าย
   - คลิก **ไปยัง Photo Frame Studio Backend (ไม่ปลอดภัย)** / *Go to ... (unsafe)*
   - คลิก **อนุญาต (Allow)**

#### 5. คัดลอก Web App URL
1. เมื่อเสร็จสิ้น จะมีหน้าต่างแสดง **URL เว็บแอป (Web App URL)** เช่น:
   ```text
   https://script.google.com/macros/s/AKfycbx.../exec
   ```
2. คัดลอก (Copy) ลิงก์ URL ดังกล่าว

#### 6. นำ URL มาใส่ในระบบ
1. เข้าไปที่หน้า Admin ของเว็บ: [admin.html](../admin.html)
2. ไปที่แท็บ **☁️ Google Drive**
3. วาง URL ลงในช่อง **Google Apps Script Web App URL** แล้วกด **"💾 บันทึกการตั้งค่า"**
4. กดปุ่ม **"⚡ ทดสอบการเชื่อมต่อ"** เพื่อตรวจสอบสถานะ

### 📁 โครงสร้างโฟลเดอร์ที่จะถูกสร้างบน Google Drive
เมื่อมีการอัปโหลดภาพเข้ามา สคริปต์จะสร้างโฟลเดอร์เหล่านี้ใน Google Drive ของคุณโดยอัตโนมัติ:

```text
Google Drive/
└── Photo Frame Studio/
    ├── Photo_Log           # Google Sheets บันทึกวันเวลา ชื่อภาพ ลิงก์ไฟล์
    ├── Finished Images/    # ภาพที่ผู้ใช้ดาวน์โหลดสำเร็จ
    ├── Activity Images/    # ภาพที่ส่งเข้าร่วมกำแพงกิจกรรม (Community Wall)
    ├── Frames/             # ภาพกรอบรูปที่ Admin เพิ่มเข้ามาใหม่
    └── Original Photos/    # ภาพต้นฉบับของผู้ร่วมกิจกรรม
```
