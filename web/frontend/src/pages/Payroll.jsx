// UC-04 – UC-07: accounting calculates a round, corrects inputs with a reason, and submits it.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { MONTHS, lastDay, periodLabel } from '../format.js';
import { useRun } from '../components/toast.jsx';
import {
  ApprovalSteps, AuditLog, Button, EmptyState, Field, Notice, PageHead, PayTag, PayrollTable, StatusBadge, Tiles
} from '../components/ui.jsx';

const EDITABLE = ['draft', 'returned'];

export default function Payroll() {
  const run = useRun();
  const [sel, setSel] = useState(null);           // { year, month, round }
  const [detail, setDetail] = useState(undefined); // undefined = loading, null = round not created
  const [editing, setEditing] = useState(null);   // employee_id

  // Start on the oldest round still being worked on, else the current half-month.
  useEffect(() => {
    const now = new Date();
    const today = { year: now.getFullYear(), month: now.getMonth() + 1, round: now.getDate() <= 15 ? 1 : 2 };
    api('GET', '/api/periods?status=draft,returned').then((open) => {
      const p = open[open.length - 1] || today;
      setSel({ year: p.year, month: p.month, round: p.round });
    }, () => setSel(today));
  }, []);

  const load = useCallback(async () => {
    if (!sel) return;
    setDetail(undefined);
    setDetail(await api('GET', `/api/periods?year=${sel.year}&month=${sel.month}&round=${sel.round}`));
  }, [sel]);

  useEffect(() => { run(load); }, [load, run]);

  const choose = (patch) => { setEditing(null); setSel((s) => ({ ...s, ...patch })); };
  const act = (fn, ok) => run(async () => { const d = await fn(); setDetail(d); return d; }, ok);
  const pid = detail?.period.id;

  if (!sel || detail === undefined) return <p className="gt-sub">กำลังโหลด…</p>;

  const picker = (
    <div className="gt-filters">
      <Field label="เดือน" value={sel.month} onChange={(e) => choose({ month: Number(e.target.value) })}
        options={MONTHS.map((m, i) => [i + 1, m])} />
      <Field label="ปี (พ.ศ.)" value={sel.year} onChange={(e) => choose({ year: Number(e.target.value) })}
        options={[sel.year - 1, sel.year, sel.year + 1].map((y) => [y, y + 543])} />
      <div className="gp-seg" role="radiogroup" aria-label="รอบการจ่าย">
        {[[1, '1–15'], [2, `16–${lastDay(sel.year, sel.month)}`]].map(([r, range]) => (
          <button key={r} type="button" role="radio" aria-checked={sel.round === r}
            className={`gp-seg-opt ${sel.round === r ? 'is-on' : ''}`} onClick={() => choose({ round: r })}>
            <span className="gp-seg-k">รอบ {r}</span><span className="gp-seg-d">{range} {MONTHS[sel.month - 1]}</span>
          </button>
        ))}
      </div>
    </div>
  );

  if (!detail) {
    return (
      <>
        <PageHead kicker="คำนวณเงินเดือน · UC-04" title={`รอบ ${sel.round} ${MONTHS[sel.month - 1]} ${sel.year + 543}`}>{picker}</PageHead>
        <EmptyState title="ยังไม่มีรอบการจ่ายนี้">
          <p className="gt-sub">สร้างรอบเพื่อดึงรายชื่อพนักงานที่ยังทำงานอยู่ ระบบตั้งวันทำงานเริ่มต้นเป็นจำนวนวันทำงานในรอบ (ไม่นับวันอาทิตย์) แล้วแก้ไขตามข้อมูลเวลาจริงได้</p>
          <Button variant="primary" onClick={() => act(() => api('POST', '/api/periods', sel), 'สร้างรอบการจ่ายแล้ว')}>สร้างรอบการจ่าย</Button>
        </EmptyState>
      </>
    );
  }

  const p = detail.period;
  const editable = EDITABLE.includes(p.status);
  const row = editable ? detail.rows.find((r) => r.employee_id === editing) : null;

  return (
    <>
      <PageHead kicker="คำนวณเงินเดือน · UC-04" title={`สรุปเงินเดือน ${periodLabel(p)}`}>{picker}</PageHead>
      <div className="gt-row"><StatusBadge status={p.status} /></div>
      <ApprovalSteps period={p} />
      <StatusNotice period={p} />
      <Tiles totals={detail.totals} processed={p.processed} />

      <div className="gt-cols">
        <div className="gt-col-main">
          <PayrollTable detail={detail} selected={editing} onEdit={editable ? setEditing : undefined} />
          {editable && (
            <div className="gt-between">
              <p className="gt-sub">เงินหัก = ขาดงานโดยไม่แจ้ง · ค่าเดินทางไม่รวมในรายได้ (BR-07)</p>
              <div className="gt-actions">
                <Button variant={p.processed ? 'secondary' : 'primary'}
                  onClick={() => act(() => api('POST', `/api/periods/${pid}/process`, {}), 'ประมวลผลเงินเดือนเรียบร้อย')}>
                  {p.processed ? 'ประมวลผลเงินเดือนใหม่' : 'ประมวลผลเงินเดือน'}
                </Button>
                <Button variant="primary" disabledReason={p.processed ? undefined : 'ต้องประมวลผลเงินเดือนก่อนส่งอนุมัติ'}
                  onClick={() => { setEditing(null); act(() => api('POST', `/api/periods/${pid}/submit`, {}), 'ส่งเข้าขั้นตอนอนุมัติแล้ว'); }}>
                  ยืนยันส่งเข้าขั้นตอนอนุมัติ
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="gt-col-side">
          {editable && (row
            ? <EditPanel key={row.employee_id} row={row} processed={p.processed} onClose={() => setEditing(null)}
                onSave={(body) => act(() => api('PATCH', `/api/periods/${pid}/attendance/${row.employee_id}`, body), 'บันทึกการแก้ไขแล้ว')} />
            : (
              <section className="gt-card">
                <h2 className="gt-h3">แก้ไขรายการ · UC-07</h2>
                <p className="gt-sub">กด "แก้ไข" ที่แถวของพนักงานในตารางเพื่อปรับวันทำงาน วันขาด หรือชั่วโมง OT ทุกการแก้ไขต้องระบุเหตุผล</p>
              </section>
            ))}
          <AuditLog audit={detail.audit} />
        </div>
      </div>
    </>
  );
}

function StatusNotice({ period: p }) {
  if (p.status === 'returned') return <Notice tone="danger" title="ผู้จัดการส่งกลับให้แก้ไข">{p.return_reason} — แก้ไขข้อมูลแล้วส่งอนุมัติใหม่ (BR-13)</Notice>;
  if (!p.processed) return <Notice tone="info" title="ยังไม่ได้ประมวลผลเงินเดือนรอบนี้">ตรวจวันทำงาน ขาดงาน และ OT ให้ครบ แล้วกด "ประมวลผลเงินเดือน"</Notice>;
  if (p.status === 'pending') return <Notice tone="warning" title="รอผู้จัดการอนุมัติ">รายการถูกล็อกระหว่างรออนุมัติ</Notice>;
  if (p.status === 'approved') return <Notice tone="info" title="ผู้จัดการอนุมัติแล้ว">ไปที่เมนู "จ่ายเงินเดือน" เพื่อดำเนินการจ่าย</Notice>;
  if (p.status === 'paid') return <Notice tone="success" title="จ่ายเงินเรียบร้อยแล้ว">รอบนี้ถูกล็อก ไม่อนุญาตให้แก้ไข</Notice>;
  return null;
}

function EditPanel({ row, processed, onSave, onClose }) {
  const [form, setForm] = useState({
    days_worked: row.days_worked, absent_days: row.absent_days, ot_hours: row.ot_hours, reason: ''
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = { type: 'number', min: 0, step: 0.5 };

  return (
    <form className="gt-card" onSubmit={async (e) => {
      e.preventDefault();
      if (await onSave(form)) setForm((f) => ({ ...f, reason: '' }));
    }}>
      <div className="gt-between">
        <h2 className="gt-h3">แก้ไขรายการ · UC-07</h2>
        <button type="button" className="link-btn" onClick={onClose}>ปิด</button>
      </div>
      <div className="gt-row"><span style={{ fontWeight: 600 }}>{row.name}</span><span className="gp-code">{row.code}</span><PayTag kind={row.type} /></div>
      <Field label="วันทำงานจริง" suffix="วัน" {...num} value={form.days_worked} onChange={set('days_worked')} />
      <Field label="ขาดงานโดยไม่แจ้ง" suffix="วัน" {...num} value={form.absent_days} onChange={set('absent_days')}
        hint={row.type === 'monthly'
          ? 'หักเงินเดือนวันละ 1/30 ของเงินเดือน (BR-10) · ลากิจที่อนุมัติแล้วไม่ต้องกรอก (BR-09)'
          : 'รายวันไม่นับวันขาดเป็นวันทำงาน (BR-10)'} />
      <Field label="ชั่วโมง OT" suffix="ชม." {...num} value={form.ot_hours} onChange={set('ot_hours')} hint="คิด 1.5 เท่าของค่าจ้างต่อชั่วโมง" />
      <Field label="เหตุผลในการแก้ไข" multiline required value={form.reason} onChange={set('reason')}
        placeholder="เช่น ผู้จัดการยืนยันว่าทำ OT วันที่ 28 เพิ่ม 2 ชม."
        hint="บันทึกลงประวัติการแก้ไขพร้อมชื่อผู้แก้และเวลา" />
      <Button type="submit" variant="primary" block>{processed ? 'บันทึกและคำนวณยอดสุทธิใหม่' : 'บันทึก'}</Button>
    </form>
  );
}
