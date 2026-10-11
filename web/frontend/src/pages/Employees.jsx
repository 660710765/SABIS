// Employee master data used by the calculation: pay type, rate and bank account (BR-03).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useRun } from '../components/toast.jsx';
import { Button, Field, Money, PageHead, PayTag } from '../components/ui.jsx';

const BLANK = { name: '', type: 'monthly', rate: '', bank: '', account: '', active: 1 };

export default function Employees() {
  const run = useRun();
  const [list, setList] = useState(null);
  const [selId, setSelId] = useState(null);

  const load = useCallback(async () => setList(await api('GET', '/api/employees')), []);
  useEffect(() => { run(load); }, [load, run]);

  if (list === null) return <p className="gt-sub">กำลังโหลด…</p>;
  const emp = list.find((e) => e.id === selId) || null;

  const save = (body) => run(async () => {
    const saved = emp
      ? await api('PATCH', `/api/employees/${emp.id}`, body)
      : await api('POST', '/api/employees', body);
    await load();
    setSelId(saved.id);
  }, 'บันทึกข้อมูลพนักงานแล้ว');

  return (
    <>
      <PageHead kicker="ข้อมูลหลักสำหรับคำนวณเงินเดือน" title="พนักงานและอัตราค่าจ้าง" />
      <div className="gt-cols">
        <div className="gt-col-main">
          <div className="gt-tbl-wrap">
            <table className="gt-tbl">
              <thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ประเภท</th><th className="num">อัตราค่าจ้าง</th><th>บัญชีรับเงิน</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} className={e.id === selId ? 'is-sel' : undefined}>
                    <td><span className="gp-code">{e.code}</span></td>
                    <td>{e.name}</td>
                    <td><PayTag kind={e.type} /></td>
                    <td className="num"><Money amount={e.rate} /> <span className="gt-muted" style={{ fontSize: 12 }}>{e.type === 'monthly' ? '/เดือน' : '/วัน'}</span></td>
                    <td>{e.bank ? <>{e.bank} <span className="gp-code">{e.account}</span></> : <span className="gt-muted">เงินสด</span>}</td>
                    <td>{e.active ? 'ทำงานอยู่' : <span className="gt-muted">พ้นสภาพ</span>}</td>
                    <td><button type="button" className="link-btn" onClick={() => setSelId(e.id)}>แก้ไข</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="gt-sub">อัตราที่เปลี่ยนจะใช้กับรอบที่ประมวลผลหลังจากนี้ รอบที่ประมวลผลแล้วเก็บอัตราเดิมไว้ พนักงานใหม่เข้าระบบด้วยรหัสพนักงาน รหัสผ่านเริ่มต้น 1234</p>
        </div>
        <div className="gt-col-side">
          <EmployeeForm key={emp ? emp.id : 'new'} emp={emp} onSave={save} onNew={() => setSelId(null)} />
        </div>
      </div>
    </>
  );
}

function EmployeeForm({ emp, onSave, onNew }) {
  const [form, setForm] = useState(() => emp
    ? { name: emp.name, type: emp.type, rate: emp.rate, bank: emp.bank || '', account: emp.account || '', active: emp.active }
    : BLANK);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className="gt-card" onSubmit={(e) => { e.preventDefault(); onSave({ ...form, active: Number(form.active) }); }}>
      <div className="gt-between">
        <h2 className="gt-h3">{emp ? `แก้ไข ${emp.code}` : 'เพิ่มพนักงาน'}</h2>
        {emp && <button type="button" className="link-btn" onClick={onNew}>เพิ่มคนใหม่</button>}
      </div>
      <Field label="ชื่อ-สกุล" required value={form.name} onChange={set('name')} />
      <Field label="ประเภทการจ้าง" value={form.type} onChange={set('type')}
        options={[['monthly', 'พนักงานรายเดือน (โอนเข้าบัญชี)'], ['daily', 'พนักงานรายวัน (เงินสด)']]} />
      <Field label="อัตราค่าจ้าง" type="number" min="0" step="0.01" required suffix="บาท" value={form.rate} onChange={set('rate')}
        hint="รายเดือน = เงินเดือนต่อเดือน · รายวัน = ค่าจ้างต่อวัน" />
      <Field label="ธนาคาร" value={form.bank} onChange={set('bank')} hint="จำเป็นสำหรับพนักงานรายเดือน (BR-03)" />
      <Field label="เลขบัญชี" value={form.account} onChange={set('account')} />
      {emp && <Field label="สถานะ" value={form.active} onChange={set('active')}
        options={[[1, 'ทำงานอยู่'], [0, 'พ้นสภาพ (ไม่ดึงเข้ารอบใหม่)']]} />}
      <Button type="submit" variant="primary" block>{emp ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน'}</Button>
    </form>
  );
}
