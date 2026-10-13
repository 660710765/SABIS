# Genertech Payroll

ระบบจัดการเงินเดือน — หจก. Genertech Engineering

## วิธีรัน

ต้องเปิด Docker Desktop ไว้ก่อน แล้วรันในโฟลเดอร์ `web`

```
docker compose up -d --build
```

ปิด: `docker compose stop`

## เข้าใช้งาน

**เว็บ Payroll** — http://localhost:5173

| บทบาท | ชื่อผู้ใช้ | รหัสผ่าน |
| --- | --- | --- |
| ฝ่ายบัญชี | `somsri` | `1234` |
| ผู้จัดการ | `weera` | `1234` |
| ผู้บริหาร | `somchai` | `1234` |
| พนักงาน | `EMP-0142` | `1234` |

## เข้า pgAdmin (ดูฐานข้อมูล)

1. เปิด http://localhost:5050
2. ล็อกอิน `admin@example.com` / `admin123`
3. แถบซ้ายกด **Servers → Payroll (Docker)** ใส่รหัส `payroll` แล้วติ๊ก Save password
4. ดูตารางที่ **Databases → payroll → Schemas → public → Tables**
   (คลิกขวาที่ตาราง → View/Edit Data → All Rows)

### ถ้าไม่มี server ให้เพิ่มเอง

คลิกขวา **Servers → Register → Server**

| แท็บ | ช่อง | กรอก |
| --- | --- | --- |
| General | Name | `Payroll` |
| Connection | Host name/address | `db` |
| | Port | `5432` |
| | Maintenance database | `payroll` |
| | Username | `payroll` |
| | Password | `payroll` (ติ๊ก Save password) |

> ถ้าใช้โปรแกรม pgAdmin ที่ติดตั้งในเครื่อง (ไม่ใช่หน้าเว็บ :5050) ให้ใช้ Host `localhost` และ Port `5433`
