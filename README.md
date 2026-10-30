# 🪷 Photo Frame Studio — ภาพกิจกรรมมหากุศล (`bunludham`)

เว็บแอปพลิเคชันใส่กรอบรูปกิจกรรมมหากุศล พร้อมระบบจัดการ Admin, ระบบบันทึกความทรงจำ (Storage v3) และระบบสมาชิก **LINE Login v2.1 (OAuth 2.1 + PKCE + OpenID Connect)** พัฒนาด้วย **Vanilla HTML5, CSS3, JavaScript (ES6+)** แบบ Zero-build สามารถเปิดใช้งานแบบ Static หรือโฮสต์ผ่าน **GitHub Pages** ได้โดยตรง 100% พร้อม Backend API บน **Cloudflare Workers + D1 (SQLite)**

---

## ✨ จุดเด่นและฟีเจอร์หลัก (Key Features)

### 📸 หน้าเว็บหลักและสตูดิโอสร้างภาพ (`index.html`, `create.html`, `user.html`)
- **ใช้งานได้ทันทีโดยไม่ต้องล็อกอิน**: ผู้เยี่ยมชมทั่วไปสามารถเลือกรูป ใส่กรอบ ปรับแต่ง และดาวน์โหลดภาพได้ทันทีแม้ทำงานแบบ Offline
- **ใส่กรอบรูปกิจกรรม**: มีกรอบรูปมาตรฐานให้เลือกหลากหลาย (เช่น สวดมนต์ข้ามปี, กฐิน, มุทิตาจิต, ปิติเจริญ, บุญอนามัย)
- **เครื่องมือจัดการภาพบน Canvas**:
  - อัปโหลดรูปภาพจากอุปกรณ์ หรือถ่ายภาพผ่านกล้อง
  - ซูม ย่อ-ขยาย (Zoom), เลื่อนตำแหน่ง (Pan / Drag), หมุนภาพ (Rotate), พลิกภาพแนวนอน (Flip Horizontal)
  - ปรับความสว่างและคอนทราสต์ (Brightness & Contrast Filters)
- **ส่งออกไฟล์ภาพคุณภาพสูง**: ดาวน์โหลดไฟล์รูปภาพพร้อมกรอบความละเอียดคมชัด (HD PNG)
- **กำกับชื่อและคำอธิษฐาน**: ใส่ข้อความชื่อผู้จัดทำและคำพรลงบนภาพ
- **คำคมข้อคิดประจำวัน (Quote of the Day)** และ **กิจกรรมชุมชน (Community Activity Wall)**

### 💚 ระบบสมาชิก LINE Login v2.1 & PDPA Consent (Optional Full-Stack Membership)
- **มาตรฐานความปลอดภัย LINE OAuth 2.1 + PKCE (`S256`) + OIDC**: ยืนยันลายเซ็น `id_token` (`HS256` / `ES256` JWKS), ตรวจสอบ `state`, `nonce`, และผูกเซสชันด้วย `HttpOnly` Cookie + `X-CSRF-Token`
- **จัดการข้อมูลสมาชิกและความยินยอม PDPA**: แก้ไขชื่อที่แสดง คำแนะนำตัว เบอร์โทร/อีเมลติดต่อ และตั้งค่าความยินยอมนโยบายความเป็นส่วนตัว พร้อมบันทึก Audit Trail

### ⚙️ ระบบผู้ดูแลระบบ & Storage v3 (`admin.html`)
- **จัดการกรอบรูปและคำคมข้อคิด**: เพิ่ม แก้ไข ซ่อน/แสดง จัดลำดับ หรือลบรายการกรอบรูป พร้อมซิงก์ข้ามแท็บแบบเรียลไทม์ (`pfs_frames_v3` Cross-Tab Sync)
- **สำรอง กู้คืน และรีเซ็ตข้อมูลอย่างปลอดภัย (StorageBackup v3.0)**: ตรวจสอบโครงสร้างข้อมูลทุกครั้งก่อนกู้คืน รองรับไฟล์สำรอง `v2.0` และ `v3.0` พร้อมระบบ Rollback อัตโนมัติหากเกิดข้อผิดพลาด
- **Offline & Cloud Sync**:
  - ทำงานแบบ **Offline LocalStorage (`v3`)** ได้ 100% โดยไม่ต้องพึ่งพาเซิร์ฟเวอร์
  - รองรับการเชื่อมต่อกับ **Google Apps Script (`backend/Code.gs`)** เพื่อซิงก์ภาพขึ้น Google Drive / Google Sheets
  - รองรับการตรวจสอบสิทธิ์ผู้ดูแลระบบฝั่งเซิร์ฟเวอร์ (`role = 'ADMIN'`) ผ่าน Cloudflare Workers API

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
bunludham/
├── index.html                  # หน้าแลนดิ้งหลัก แกลเลอรีกรอบรูป คำคม และปุ่มเข้าสู่ระบบ LINE
├── create.html                 # หน้าสตูดิโอสร้างและปรับแต่งภาพพร้อมกรอบ
├── user.html                   # ทางลัดเข้าสู่หน้าสตูดิโอผู้ใช้งาน
├── admin.html                  # หน้าแผงควบคุมระบบ (Admin Dashboard)
├── style.css                   # สไตล์หลักและสไตล์ระบบสมาชิก LINE
├── admin.css                   # สไตล์สำหรับหน้าผู้ดูแลระบบ
├── app.js                      # ตรรกะการทำงานฝั่งผู้ใช้งาน (Canvas, Events, Cross-tab Sync)
├── admin.js                    # ตรรกะการจัดการข้อมูล Admin & Validated Backup/Restore
├── config.js                   # ตั้งค่า Public Endpoints (API Base URL & GAS Endpoint — ปลอด Secret)
├── test_runner.html            # หน้าทดสอบระบบอัตโนมัติบนเบราว์เซอร์ (16 Tests)
├── assets/frames/              # ไฟล์ภาพกรอบรูป (.png) และภาพขนาดย่อ (.thumb.png)
├── config/
│   ├── frames.json             # ฐานข้อมูลกรอบรูปเริ่มต้น
│   └── quotes.json             # ฐานข้อมูลคำคมข้อคิดเริ่มต้น
├── shared/
│   ├── storage.js              # โมดูลจัดการ Storage v3, Migration v2->v3, Backup & Cross-Tab Sync
│   ├── drive-sync.js           # โมดูลเชื่อมต่อ Google Drive / GAS Web App
│   ├── api-client.js           # ไคลเอนต์เชื่อมต่อ Backend API (HttpOnly Cookie + In-Memory CSRF)
│   └── member-auth.js          # คอมโพเนนต์ UI ปุ่ม LINE Login, โปรไฟล์สมาชิก และความยินยอม PDPA
├── backend/
│   ├── Code.gs                 # สคริปต์ Google Apps Script เดิมสำหรับเชื่อมต่อ Google Drive
│   ├── package.json            # สคริปต์พัฒนา รันฐานข้อมูล และรัน Automated Tests
│   ├── wrangler.toml           # ค่าตั้งต้นสำหรับ Deploy ขึ้น Cloudflare Workers + D1
│   ├── .dev.vars.example       # ตัวอย่างไฟล์ตั้งค่าตัวแปรความลับสำหรับการพัฒนาในเครื่อง
│   ├── migrations/             # SQLite / D1 Schema Migrations
│   ├── seeds/                  # ข้อมูลตัวอย่างสำหรับการพัฒนาในเครื่องเท่านั้น
│   ├── scripts/                # Local Dev Server & Migration CLI
│   ├── src/                    # โค้ดหลักของ Cloudflare Worker API (Auth, OIDC, Members, Admin, Security)
│   └── tests/                  # ชุดทดสอบอัตโนมัติฝั่ง Node.js (28 Tests / 5 Suites)
└── docs/                       # เอกสารสถาปัตยกรรม ความปลอดภัย API การทดสอบ และการติดตั้งระบบจริง
```

---

## 🚀 วิธีเปิดใช้งานและพัฒนาในเครื่อง (Getting Started)

### 1. ใช้งานโหมด Static / Offline ทันที (ไม่ต้องรัน Backend)
- เปิดไฟล์ [`index.html`](index.html) หรือรันผ่าน Static Server เช่น `python3 -m http.server 8080`
- ระบบแต่งภาพและกรอบรูปทั้งหมดทำงานบนเบราว์เซอร์ได้ทันที 100%

### 2. รันระบบเต็มรูปแบบพร้อม Backend LINE Login API ในเครื่อง (Node.js `>= 22.5`)
```bash
cp backend/.dev.vars.example backend/.dev.vars
npm --prefix backend run db:migrate:seed
npm --prefix backend run dev
```
จากนั้นเปิดหน้าเว็บผ่าน `http://localhost:8080` ระบบจะเชื่อมต่อกับ `http://localhost:8787/api/v1` โดยอัตโนมัติ

### 3. รันชุดทดสอบอัตโนมัติ (Automated QA)
- **Node.js Full-Stack & Security Suite (28 Tests)**:
  ```bash
  npm --prefix backend test
  ```
- **Browser QA Suite (16 Tests)**: เปิดไฟล์ [`test_runner.html`](test_runner.html) บนเว็บเบราว์เซอร์

---

## 📚 เอกสารประกอบทางวิศวกรรม (`docs/`)
- [Architecture Overview](docs/architecture.md)
- [LINE Login v2.1 & OIDC Setup Guide](docs/line-login-setup.md)
- [Backend API Reference](docs/backend-api.md)
- [Database Schema & Migrations](docs/database-schema.md)
- [Storage v3 Migration & Backup Specification](docs/storage-v3-migration.md)
- [Security Architecture & Threat Controls](docs/security.md)
- [Automated Testing & QA Matrix](docs/testing.md)
- [Deployment Runbook (GitHub Pages + Cloudflare Workers & D1)](docs/deployment.md)

---

## 🔒 ความปลอดภัยและความเป็นส่วนตัว
- ไฟล์ [`config.js`](config.js) และโค้ดฝั่ง Frontend ทั้งหมดไม่มี Secret Keys, `LINE_CHANNEL_SECRET`, หรือ Auth Tokens เก็บไว้ใน `LocalStorage`
- รูปภาพที่ประมวลผลผ่าน Canvas ดำเนินการบนเบราว์เซอร์ของผู้ใช้ (Client-side Processing)
- เซสชันสมาชิกใช้คุกกี้ `HttpOnly` แบบ Opaque โดยเก็บเฉพาะค่าแฮช `SHA-256` ในฐานข้อมูล พร้อมการป้องกัน CSRF, Open Redirect และ Rate Limiting
