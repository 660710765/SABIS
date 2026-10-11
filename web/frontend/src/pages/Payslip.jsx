// e-Payslip: an employee sees only their own payslips (BR-14), for approved or paid rounds.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmt, num, periodLabel } from '../format.js';
import { useRun } from '../components/toast.jsx';
import { Button, EmptyState, Money, Notice, PageHead, PayTag, StatusBadge } from '../components/ui.jsx';

const Line = ({ label, amount }) => <div className="gp-slip-line"><span>{label}</span><Money amount={amount} /></div>;

// Opens the print dialog with only the slip (.print-area); "Save as PDF" downloads it.
// The page title becomes the suggested file name, e.g. สลิปเงินเดือน-EMP-0142-2569-10-รอบ2.
function downloadSlip(e, s) {
  const prev = document.title;
  document.title = `สลิปเงินเดือน-${e.code}-${s.year + 543}-${String(s.month).padStart(2, '0')}-รอบ${s.round}`;
  window.addEventListener('afterprint', () => { document.title = prev; }, { once: true });
  window.print();
}

export default function Payslip() {
  const run = useRun();
  const [data, setData] = useState(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => { run(async () => setData(await api('GET', '/api/my/payslips'))); }, [run]);

  if (!data) return <p className="gt-sub">กำลังโหลด…</p>;
  const { employee: e, payslips: list } = data;
  if (!list.length) {
    return (
      <>
        <PageHead kicker="สลิปเงินเดือน (e-Payslip)" title="ยังไม่มีสลิป" />
        <EmptyState><p className="gt-sub">สลิปจะแสดงเมื่อรอบการจ่ายได้รับการอนุมัติแล้ว</p></EmptyState>
      </>
    );
  }

  const s = list[Math.min(idx, list.length - 1)];
  const channel = s.type === 'monthly' ? 'transfer' : 'cash';

  return (
    <>
      <PageHead kicker="สลิปเงินเดือน (e-Payslip)" title={e.name} />
      <div className="slip-wrap">
        <article className="gp-slip print-area">
          <p className="print-only gp-slip-co">หจก. Genertech Engineering</p>
          <header className="gp-slip-h">
            <div><p className="gp-slip-k">สลิปเงินเดือน (e-Payslip)</p><p className="gp-slip-p">{periodLabel(s)}</p></div>
            <StatusBadge status={s.status} />
          </header>
          <div className="gp-slip-who"><span className="gp-slip-n">{e.name}</span><span className="gp-code">{e.code}</span><PayTag kind={s.type} /></div>
          <div className="gp-slip-cols">
            <section>
              <h4 className="gp-slip-sh">รายได้</h4>
              {s.type === 'monthly'
                ? <Line label="เงินเดือน (ครึ่งเดือน)" amount={s.base} />
                : <Line label={`ค่าจ้างรายวัน ${num(s.days_worked)} วัน × ${fmt(s.rate)}`} amount={s.base} />}
              {s.ot_pay > 0 && <Line label={`ค่าล่วงเวลา ${num(s.ot_hours)} ชม.`} amount={s.ot_pay} />}
            </section>
            <section>
              <h4 className="gp-slip-sh">รายการหัก</h4>
              {s.type === 'monthly' && <Line label={`ขาดงาน ${num(s.absent_days)} วัน`} amount={-s.deduction} />}
              <Line label="ภาษีหัก ณ ที่จ่าย" amount={-s.tax} />
            </section>
          </div>
          <footer className="gp-slip-f">
            <div><p className="gp-slip-k">ยอดสุทธิ</p><PayTag kind={channel} /></div>
            <Money amount={s.net} lg unit />
          </footer>
        </article>

        <div className="gt-actions no-print">
          <Button variant="primary" onClick={() => downloadSlip(e, s)}>ดาวน์โหลดสลิป (PDF)</Button>
        </div>

        {s.status === 'approved' && (
          <Notice tone="info" title={channel === 'cash' ? 'รับเงินสดในวันจ่ายของรอบนี้' : 'โอนเข้าบัญชีในวันจ่ายของรอบนี้'}>
            ตรวจยอดให้ตรงกับสลิป หากไม่ถูกต้องแจ้งฝ่ายบัญชี
          </Notice>
        )}

        <section className="gt-card" style={{ gap: 0 }}>
          <h2 className="gt-h3" style={{ marginBottom: 4 }}>สลิปทั้งหมด</h2>
          {list.map((x, i) => (
            <div key={x.period_id} className="gt-li">
              <button type="button" className="link-btn" onClick={() => setIdx(i)} aria-current={i === idx || undefined}
                style={i === idx ? { fontWeight: 600 } : undefined}>{periodLabel(x)}</button>
              <Money amount={x.net} />
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
