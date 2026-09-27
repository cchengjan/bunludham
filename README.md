# 🪷 Photo Frame Studio — ภาพกิจกรรมมหากุศล

เว็บแอปพลิเคชันใส่กรอบรูปกิจกรรมมหากุศล พร้อมระบบจัดการ Admin และระบบบันทึกความทรงจำ พัฒนาด้วย **Vanilla HTML5, CSS3, JavaScript (ES6+)** แบบ Zero-build สามารถเปิดใช้งานได้ทันที หรือโฮสต์ผ่าน **GitHub Pages** ได้โดยตรง 100%

---

## ✨ จุดเด่นและฟีเจอร์หลัก (Key Features)

### 📸 หน้าเว็บหลัก (User Studio — `index.html`)
- **ใส่กรอบรูปกิจกรรม**: มีกรอบรูปมาตรฐานให้เลือกหลากหลาย (เช่น สวดมนต์ข้ามปี, กฐิน, มุทิตาจิต, ปิติเจริญ, บุญอนามัย)
- **เครื่องมือจัดการภาพบน Canvas**:
  - อัปโหลดรูปภาพจากอุปกรณ์ หรือถ่ายภาพผ่านกล้อง
  - ซูม ย่อ-ขยาย (Zoom), เลื่อนตำแหน่ง (Pan / Drag), หมุนภาพ (Rotate)
  - พลิกภาพแนวนอน (Flip Horizontal)
  - ปรับความสว่างและคอนทราสต์ (Brightness & Contrast Filters)
- **ส่งออกไฟล์ภาพคุณภาพสูง**: ดาวน์โหลดไฟล์รูปภาพพร้อมกรอบที่ความละเอียดคมชัด (HD)
- **กำกับชื่อและคำอธิษฐาน**: ใส่ข้อความชื่อผู้จัดทำและคำพรลงบนภาพ
- **คำคมข้อคิดประจำวัน (Quote of the Day)**: แสดงคติธรรมข้อคิดเพื่อความเป็นสิริมงคล
- **กิจกรรมชุมชน (Community Activity Wall)**: แสดงบันทึกภาพและกิจกรรมที่ผู้ใช้ร่วมสร้าง

### ⚙️ ระบบผู้ดูแลระบบ (Admin Dashboard — `admin.html`)
- **จัดการกรอบรูป (Frame Management)**: เพิ่ม แก้ไข ซ่อน/แสดง หรือลบรายการกรอบรูป
- **จัดการคำคมข้อคิด (Quotes Management)**: เพิ่มและแก้ไขชุดคำคมประจำวัน
- **Offline & Cloud Sync**:
  - ทำงานแบบ **Offline LocalStorage** ได้ 100% โดยไม่ต้องพึ่งพาเซิร์ฟเวอร์
  - รองรับการเชื่อมต่อกับ **Google Apps Script (GAS) Web App** เพื่อซิงก์ข้อมูลขึ้น Google Drive / Google Sheets ได้อย่างปลอดภัย

---

## 📁 โครงสร้างโปรเจกต์ (Project Structure)

```text
WEB/
├── index.html            # หน้าเว็บหลัก Photo Frame Studio
├── style.css             # สไตล์หลัก ดีไซน์โมเดิร์น โทนธรรมชาติและทองพรีเมียม
├── app.js                # ตรรกะการทำงานฝั่งผู้ใช้งาน (Canvas, Events, Render)
├── admin.html            # หน้าแผงควบคุมระบบ (Admin Dashboard)
├── admin.css             # สไตล์สำหรับหน้าผู้ดูแลระบบ
├── admin.js              # ตรรกะการจัดการข้อมูล Admin
├── config.js             # ตั้งค่าการเชื่อมต่อ (GAS Web App Endpoint)
├── test_runner.html      # หน้าทดสอบระบบอัตโนมัติ (Automated QA Test Runner)
├── assets/
│   └── frames/           # ไฟล์ภาพกรอบรูป (.png) และภาพขนาดย่อ (.thumb.png)
├── config/
│   ├── frames.json       # ฐานข้อมูลกรอบรูปเริ่มต้น
│   └── quotes.json       # ฐานข้อมูลคำคมข้อคิดเริ่มต้น
└── shared/
    ├── drive-sync.js     # โมดูลเชื่อมต่อ Google Drive / GAS Web App
    └── storage.js        # โมดูลจัดการ LocalStorage & Fallback
```

---

## 🚀 วิธีเปิดใช้งาน (Getting Started)

### 1. ใช้งานในเครื่อง (Local)
สามารถเปิดใช้งานได้ง่าย ๆ โดยไม่ต้องติดตั้ง Node.js หรือ build tools:
- ดับเบิลคลิกเปิดไฟล์ `index.html` บนเว็บเบราว์เซอร์ใดก็ได้ (Chrome, Safari, Edge, Firefox)
- หรือใช้ Live Server ผ่าน VS Code / ส่วนขยายเบราว์เซอร์

### 2. นำขึ้นโฮสต์ฟรีผ่าน GitHub Pages
1. Push โปรเจกต์นี้ขึ้น GitHub Repository
2. ไปที่ **Settings** ของ Repository บน GitHub
3. เลือกเมนู **Pages** ด้านซ้าย
4. ในหัวข้อ **Build and deployment > Source**: เลือก `Deploy from a branch`
5. ในหัวข้อ **Branch**: เลือกสาขา `main` และโฟลเดอร์ `/ (root)` แล้วกด **Save**
6. รอระบบ deploy สักครู่ ท่านจะได้รับลิงก์เว็บพร้อมใช้งานทันที (เช่น `https://<username>.github.io/<repo-name>/`)

---

## 🔒 ความปลอดภัยและความเป็นส่วนตัว
- ไฟล์ `config.js` ออกแบบมาให้ไม่มี Secret Keys หรือ API Tokens ที่เป็นความลับ ปลอดภัยต่อการ Public บน GitHub
- รูปภาพที่ประมวลผลผ่าน Canvas ดำเนินการบนเบราว์เซอร์ของผู้ใช้ (Client-side Processing)
