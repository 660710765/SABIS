# Genertech Payroll

ระบบจัดการเงินเดือน (Payroll) ของ หจก. Genertech Engineering — คำนวณ → อนุมัติ → จ่ายเงิน → สลิปพนักงาน

แยกเป็น 2 ส่วน:

- `backend/` — API เขียนด้วย Go ใช้ฐานข้อมูล PostgreSQL (จัดการผ่าน pgAdmin)
- `frontend/` — หน้าเว็บ React (Vite) เรียก API ผ่าน `/api`

## สิ่งที่ต้องมี

- PostgreSQL (รุ่น 14 ขึ้นไป) และ pgAdmin 4 — ตัวติดตั้ง PostgreSQL บน Windows มี pgAdmin มาให้แล้ว
- Go 1.24 ขึ้นไป
- Node.js 20 ขึ้นไป (สำหรับ frontend)

## เริ่มใช้งาน

### 1. ตั้งค่าฐานข้อมูล

```
cd backend
copy .env.example .env
```

แก้ `DATABASE_URL` ใน `.env` ให้เป็นรหัสผ่านของผู้ใช้ PostgreSQL (ตัวเดียวกับที่ใช้ล็อกอินใน pgAdmin)

```
DATABASE_URL=postgres://postgres:รหัสผ่าน@localhost:5432/payroll?sslmode=disable
```

ไม่ต้องสร้างฐานข้อมูลเอง — ตอนรัน backend ครั้งแรกจะสร้างฐานข้อมูล `payroll` ตาราง และข้อมูลตัวอย่างให้อัตโนมัติ
(ถ้าอยากสร้างเองใน pgAdmin: คลิกขวา Databases → Create → Database ชื่อ `payroll` แล้วเปิด Query Tool รัน `backend/internal/store/schema.sql`)

### 2. รัน backend (API ที่ :8080)

```
cd backend
go run ./cmd/server
```

### 3. รัน frontend (http://localhost:5173)

```
cd frontend
npm install
npm run dev
```

Vite จะส่งคำขอ `/api` ต่อไปให้ backend ที่ `http://localhost:8080` (เปลี่ยนได้ด้วย `API_URL` ใน `frontend/.env`)

| บทบาท | ชื่อผู้ใช้ | รหัสผ่าน |
| --- | --- | --- |
| ฝ่ายบัญชี | `somsri` | `1234` |
| ผู้จัดการ (อนุมัติ) | `weera` | `1234` |
| พนักงาน | รหัสพนักงาน เช่น `EMP-0142` | `1234` |

### ใช้งานจริง

- backend: `go build -o payroll-api.exe ./cmd/server` แล้วรันไฟล์นั้น (ตั้ง `DATABASE_URL` และ `PORT` ผ่าน environment หรือ `.env`)
- frontend: `npm run build` ได้ไฟล์ static ใน `frontend/dist/` นำไปวางบน web server (เช่น nginx) และตั้งให้ `/api` proxy ไปที่ backend
  ให้อยู่ domain เดียวกัน เพราะ session cookie เป็นแบบ `SameSite=Strict`

## ดูข้อมูลใน pgAdmin

เปิด pgAdmin → Servers → PostgreSQL → Databases → `payroll` → Schemas → public → Tables

| ตาราง | เก็บอะไร |
| --- | --- |
| `employees` | พนักงานและอัตราค่าจ้าง |
| `users` | บัญชีผู้ใช้และบทบาท (รหัสผ่านเก็บแบบ scrypt hash) |
| `sessions` | session ที่ล็อกอินอยู่ (เก็บ hash ของ token) |
| `periods` | รอบการจ่ายและสถานะ (ร่าง → รออนุมัติ → อนุมัติ → จ่ายแล้ว) |
| `attendance` | วันทำงาน วันขาด และชั่วโมง OT ต่อคนต่อรอบ |
| `payroll_lines` | ผลคำนวณเงินเดือนต่อคนต่อรอบ |
| `audit_log` | ประวัติการแก้ไขและการดำเนินการ |

เริ่มข้อมูลใหม่ทั้งหมด: ลบฐานข้อมูล `payroll` ใน pgAdmin แล้วรัน backend ใหม่

## ทดสอบ

```
cd backend
go test ./...
```

เทสต์ที่ต้องใช้ฐานข้อมูลจะรันเมื่อตั้ง `TEST_DATABASE_URL` (เทสต์สร้าง schema ชั่วคราวแล้วลบทิ้งเอง ไม่แตะตารางจริง):

```
set TEST_DATABASE_URL=postgres://postgres:รหัสผ่าน@localhost:5432/payroll?sslmode=disable
go test ./...
```

## โครงสร้าง

```
web/
├── backend/                  Go API
│   ├── cmd/server/main.go    อ่านค่า config, ต่อฐานข้อมูล, เปิด HTTP server
│   ├── internal/api/         routes, ตรวจสิทธิ์ตามบทบาท (BR-14), session cookie
│   ├── internal/store/       PostgreSQL: schema.sql, ขั้นตอนรอบการจ่าย + Audit Log,
│   │                         ข้อมูลพนักงาน, ล็อกอิน, ข้อมูลตัวอย่าง
│   └── internal/payroll/     สูตรคำนวณ (BR-01 – BR-11)
└── frontend/                 React (Vite)
    ├── index.html
    ├── vite.config.js        proxy /api → backend
    ├── public/
    └── src/
        ├── App.jsx           ล็อกอิน เมนูตามบทบาท และ React Router
        ├── api.js            fetch wrapper
        ├── pages/            คำนวณเงินเดือน, อนุมัติ, จ่ายเงิน, พนักงาน, สลิป, ล็อกอิน
        ├── components/
        └── styles/
```

## กฎการคำนวณที่ใช้

- รายเดือน: ได้ครึ่งหนึ่งของเงินเดือนต่อรอบ ขาดงานหักวันละ เงินเดือน ÷ 30
- รายวัน: ค่าจ้างต่อวัน × วันทำงานจริง
- OT: 1.5 เท่าของค่าจ้างต่อชั่วโมง (รายเดือน = เงินเดือน ÷ 30 ÷ 8, รายวัน = ค่าจ้าง ÷ 8)
- ภาษีหัก ณ ที่จ่าย: คำนวณรายได้ทั้งปี (× 24 รอบ) หักค่าใช้จ่าย 50% (ไม่เกิน 100,000) และลดหย่อนส่วนตัว 60,000 แล้วคิดอัตราก้าวหน้า หาร 24
- ยังไม่รวมประกันสังคม และลดหย่อนอื่นนอกจากลดหย่อนส่วนตัว
