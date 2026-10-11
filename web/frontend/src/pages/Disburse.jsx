// UC-09 / BR-03: monthly staff by bank transfer file, daily staff in cash; then mark the round paid.
import { api } from '../api.js';
import { num, periodLabel, when } from '../format.js';
import { usePeriodQueue } from './usePeriodQueue.js';
import {
  ApprovalSteps, Button, EmptyState, Money, Notice, PageHead, PayTag, PeriodList, StatusBadge
} from '../components/ui.jsx';

function PayList({ rows, detailOf }) {
  if (!rows.length) return <p className="gt-sub">ไม่มี</p>;
  return (
    <div className="gt-list">
      {rows.map((r) => (
        <div key={r.employee_id} className="gt-li">
          <span>{r.name} <span className="gp-code">{r.code} · {detailOf(r)}</span></span>
          <Money amount={r.net} />
        </div>
      ))}
    </div>
  );
}

export default function Disburse() {
  const { list, id, detail, select, reload, run } = usePeriodQueue('approved,paid');

  if (list === null) return <p className="gt-sub">กำลังโหลด…</p>;
  if (!detail) {
    return (
      <>
        <PageHead kicker="จ่ายเงินเดือน · UC-09" title="ไม่มีรอบที่พร้อมจ่าย" />
        <EmptyState><p className="gt-sub">ต้องรอการอนุมัติจากผู้จัดการก่อนจึงจะสามารถจ่ายเงินได้</p></EmptyState>
      </>
    );
  }

  const p = detail.period, t = detail.totals, paid = p.status === 'paid';
  const monthly = detail.rows.filter((r) => r.type === 'monthly');
  const daily = detail.rows.filter((r) => r.type === 'daily');
  const pay = () => run(async () => { await api('POST', `/api/periods/${p.id}/pay`, {}); await reload(); }, 'บันทึกการจ่ายเงินเรียบร้อยแล้ว');

  return (
    <>
      <PageHead kicker="จ่ายเงินเดือน · UC-09" title={`สั่งจ่าย ${periodLabel(p)}`}><StatusBadge status={p.status} /></PageHead>
      <div className="no-print"><PeriodList list={list} selectedId={id} onSelect={select} /></div>
      <ApprovalSteps period={p} />
      {paid && <Notice tone="success" title="จ่ายเงินเรียบร้อยแล้ว">บันทึกโดย {p.paid_by} · {when(p.paid_at)} — พนักงานดู e-Payslip ได้แล้ว</Notice>}

      <div className="gt-cols">
        <section className="gt-card" style={{ flex: '1 1 420px' }}>
          <div className="gt-between">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><PayTag kind="transfer" /><h2 className="gt-h2">พนักงานรายเดือน · {monthly.length} คน</h2></div>
            <Money amount={t.monthlyNet} lg unit />
          </div>
          <PayList rows={monthly} detailOf={(r) => `${r.bank} ${r.account}`} />
          <div className="gt-actions">
            <a className="gp-btn gp-btn-primary gp-btn-md" href={`/api/periods/${p.id}/bank-file`} download>สร้างไฟล์โอนเงินธนาคาร (.csv)</a>
          </div>
        </section>

        <section className="gt-card print-area" style={{ flex: '1 1 420px' }}>
          <div className="gt-between">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <PayTag kind="cash" /><h2 className="gt-h2">พนักงานรายวัน · {daily.length} คน</h2><span className="gt-sub">{periodLabel(p)}</span>
            </div>
            <Money amount={t.dailyNet} lg unit />
          </div>
          <PayList rows={daily} detailOf={(r) => `${num(r.days_worked)} วัน${r.ot_hours ? ` + OT ${num(r.ot_hours)} ชม.` : ''}`} />
          <div className="gt-actions no-print"><Button onClick={() => window.print()}>พิมพ์ใบสรุปเบิกเงินสด</Button></div>
        </section>
      </div>

      <section className="gt-card no-print">
        <div className="gt-between">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 className="gt-h3">ยืนยันการสั่งจ่าย</h2>
            <p className="gt-sub">กดยืนยันหลังโอนเงินและจ่ายเงินสดครบทุกช่องทางแล้ว ระบบจะเปลี่ยนสถานะเป็น "จ่ายเงินเรียบร้อยแล้ว" และออก e-Payslip</p>
          </div>
          <div className="gt-row"><span className="gt-tile-k">ยอดรวมทั้งรอบ</span><Money amount={t.net} lg unit /></div>
        </div>
        {!paid && <div className="gt-actions"><Button variant="primary" size="lg" onClick={pay}>ยืนยันการสั่งจ่ายเงินเดือน</Button></div>}
      </section>
    </>
  );
}
