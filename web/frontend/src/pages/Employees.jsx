// Employee master data used by the calculation: pay type, rate and bank account (BR-03).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useRun } from '../components/toast.jsx';
import { Button, Field, Money, PageHead, PayTag } from '../components/ui.jsx';

export default function Employees() {
  const run = useRun();
  const [list, setList] = useState(null);
  const [selId, setSelId] = useState(null);

  const load = useCallback(async () => setList(await api('GET', '/api/employees')), []);
  useEffect(() => { run(load); }, [load, run]);

  if (list === null) return <p className="gt-sub">กำลังโหลด…</p>;
  const emp = list.find((e) => e.id === selId) || null;

  const save = (body) => run(async () => {
    await api('PATCH', `/api/employees/${emp.id}`, body);
    await load();
  }, 'บันทึกข้อมูลพนักงานแล้ว');

  return (
    <>
      <PageHead kicker="ข้อมูลหลักสำหรับคำนวณเงินเดือน" title="พนักงานและอัตราค่าจ้าง" />
      <div className="gt-cols">
        <div className="gt-col-main">
          <div className="gt-tbl-wrap">
            <table className="gt-tbl gt-tbl-compact">
              <thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ประเภท</th><th className="num">อัตราค่าจ้าง</th><th>บัญชีรับเงิน</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} className={e.id === selId ? 'is-sel' : undefined}>
                    <td><span className="gp-code">{e.code}</span></td>
                    <td>{e.name}</td>
                    <td><PayTag kind={e.type} /></td>
                    <td className="num"><Money amount={e.rate} /> <span className="gt-muted" style={{ fontSize: 12 }}>{e.type === 'monthly' ? '/เดือน' : '/วัน'}</span></td>
                    <td>{e.bank ? <>{e.bank}<br /><span className="gp-code">{e.account}</span></> : <span className="gt-muted">เงินสด</span>}</td>
                    <td>{e.active ? 'ทำงานอยู่' : <span className="gt-muted">พ้นสภาพ</span>}</td>
                    <td><button type="button" className="link-btn edit-btn" onClick={() => setSelId(e.id)}>แก้ไข</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="gt-sub">อัตราที่เปลี่ยนจะใช้กับรอบที่ประมวลผลหลังจากนี้ รอบที่ประมวลผลแล้วเก็บอัตราเดิมไว้</p>
        </div>
        <div className="gt-col-side">
          {emp
            ? <EmployeeForm key={emp.id} emp={emp} onSave={save} onClose={() => setSelId(null)} />
            : <div className="gt-card"><p className="gt-sub" style={{ margin: 0 }}>กด "แก้ไข" ที่แถวของพนักงานเพื่อแก้ไขข้อมูลและอัตราค่าจ้าง</p></div>}
        </div>
      </div>
    </>
  );
}

function EmployeeForm({ emp, onSave, onClose }) {
  const [form, setForm] = useState(() => (
    { name: emp.name, type: emp.type, rate: emp.rate, bank: emp.bank || '', account: emp.account || '', active: emp.active }));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className="gt-card" onSubmit={(e) => { e.preventDefault(); onSave({ ...form, active: Number(form.active) }); }}>
      <div className="gt-between">
        <h2 className="gt-h3">แก้ไข {emp.code}</h2>
        <button type="button" className="link-btn" onClick={onClose}>ปิด</button>
      </div>
      <Field label="ชื่อ-สกุล" required value={form.name} onChange={set('name')} />
      <Field label="ประเภทการจ้าง" value={form.type} onChange={set('type')}
        options={[['monthly', 'พนักงานรายเดือน (โอนเข้าบัญชี)'], ['daily', 'พนักงานรายวัน (เงินสด)']]} />
      <Field label="อัตราค่าจ้าง" type="number" min="0" step="0.01" required suffix="บาท" value={form.rate} onChange={set('rate')}
        hint="รายเดือน = เงินเดือนต่อเดือน · รายวัน = ค่าจ้างต่อวัน" />
      <Field label="ธนาคาร" value={form.bank} onChange={set('bank')} hint="จำเป็นสำหรับพนักงานรายเดือน" />
      <Field label="เลขบัญชี" value={form.account} onChange={set('account')} />
      <Field label="สถานะ" value={form.active} onChange={set('active')}
        options={[[1, 'ทำงานอยู่'], [0, 'พ้นสภาพ (ไม่ดึงเข้ารอบใหม่)']]} />
      <Button type="submit" variant="primary" block>บันทึกการแก้ไข</Button>
    </form>
  );
}
