// Executive report: payroll cost per round for approved/paid rounds — company totals only,
// no per-employee figures (BR-14).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmt, periodLabel, when } from '../format.js';
import { useRun } from '../components/toast.jsx';
import { EmptyState, Field, Money, PageHead, StatusBadge } from '../components/ui.jsx';

function CostTiles({ cost }) {
  return (
    <div className="gt-tiles">
      <div className="gt-tile"><span className="gt-tile-k">ค่าจ้างรวมก่อนภาษี</span><span className="gt-tile-v">{fmt(cost.gross)}</span><span className="gt-tile-n">บาท · {cost.employees} คน</span></div>
      <div className="gt-tile"><span className="gt-tile-k">ยอดจ่ายสุทธิ</span><span className="gt-tile-v">{fmt(cost.net)}</span><span className="gt-tile-n">ภาษีหัก ณ ที่จ่าย {fmt(cost.tax)} บาท</span></div>
      <div className="gt-tile"><span className="gt-tile-k">โอนเข้าบัญชี (รายเดือน)</span><span className="gt-tile-v" style={{ color: 'var(--brand)' }}>{fmt(cost.monthly_net)}</span><span className="gt-tile-n">{cost.monthly} คน</span></div>
      <div className="gt-tile"><span className="gt-tile-k">เงินสด (รายวัน)</span><span className="gt-tile-v" style={{ color: 'var(--amber)' }}>{fmt(cost.daily_net)}</span><span className="gt-tile-n">{cost.daily} คน</span></div>
      <div className="gt-tile"><span className="gt-tile-k">ค่าล่วงเวลา (OT)</span><span className="gt-tile-v">{fmt(cost.ot_pay)}</span><span className="gt-tile-n">หักขาดงาน {fmt(cost.deduction)} บาท</span></div>
    </div>
  );
}

function CostCells({ c }) {
  return (
    <>
      <td className="num gt-mono">{c.employees}</td>
      <td className="num"><Money amount={c.base} /></td>
      <td className="num"><Money amount={c.ot_pay} signed /></td>
      <td className="num"><Money amount={c.deduction ? -c.deduction : 0} signed /></td>
      <td className="num"><Money amount={c.gross} /></td>
      <td className="num"><Money amount={c.tax ? -c.tax : 0} /></td>
      <td className="num" style={{ fontWeight: 500 }}><Money amount={c.net} /></td>
      <td className="num"><Money amount={c.monthly_net} /></td>
      <td className="num"><Money amount={c.daily_net} /></td>
    </>
  );
}

export default function Summary() {
  const run = useRun();
  const [year, setYear] = useState(0); // 0 = latest year with data
  const [data, setData] = useState(null);

  useEffect(() => {
    run(async () => setData(await api('GET', `/api/reports/summary${year ? `?year=${year}` : ''}`)));
  }, [run, year]);

  if (!data) return <p className="gt-sub">กำลังโหลด…</p>;
  const kicker = 'สรุปค่าใช้จ่ายเงินเดือน · ภาพรวมบริษัท';
  if (!data.years.length) {
    return (
      <>
        <PageHead kicker={kicker} title="ยังไม่มีรอบที่อนุมัติ" />
        <EmptyState><p className="gt-sub">ยอดจะแสดงเมื่อรอบการจ่ายได้รับการอนุมัติจากผู้จัดการแล้ว</p></EmptyState>
      </>
    );
  }

  const latest = data.rounds[0];
  const thai = (y) => `พ.ศ. ${y + 543}`;

  return (
    <>
      <PageHead kicker={kicker} title={latest ? `ล่าสุด ${periodLabel(latest)}` : `ปี ${thai(data.year)}`}>
        <div className="gt-filters">
          <Field label="ปี" options={data.years.map((y) => [y, thai(y)])} value={data.year}
            onChange={(e) => setYear(Number(e.target.value))} />
        </div>
      </PageHead>

      {latest && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="gt-between">
            <h2 className="gt-h3">รอบล่าสุดของปี</h2>
            <span className="gt-row"><StatusBadge status={latest.status} />{latest.paid_at && <span className="gt-sub">จ่ายเมื่อ {when(latest.paid_at)}</span>}</span>
          </div>
          <CostTiles cost={latest} />
        </section>
      )}

      <div className="gt-tbl-wrap">
        <table className="gt-tbl">
          <caption>ค่าใช้จ่ายเงินเดือนรายรอบ ปี {thai(data.year)} (เฉพาะรอบที่อนุมัติหรือจ่ายแล้ว)</caption>
          <thead>
            <tr>
              <th>รอบการจ่าย</th><th>สถานะ</th><th className="num">พนักงาน (คน)</th>
              <th className="num">ฐานค่าจ้าง</th><th className="num">เงินเพิ่ม (OT)</th><th className="num">หักขาดงาน</th>
              <th className="num">รวมก่อนภาษี</th><th className="num">ภาษีหัก ณ ที่จ่าย</th><th className="num">สุทธิ (บาท)</th>
              <th className="num">โอน (รายเดือน)</th><th className="num">เงินสด (รายวัน)</th>
            </tr>
          </thead>
          <tbody>
            {data.rounds.map((r) => (
              <tr key={r.period_id}>
                <td>{periodLabel(r)}</td>
                <td><StatusBadge status={r.status} /></td>
                <CostCells c={r} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>รวมทั้งปี {data.rounds.length} รอบ</td>
              <CostCells c={data.total} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="gt-sub">จำนวนพนักงานในแถวรวมนับคนที่ได้รับเงินในปีนี้ไม่ซ้ำกัน · รายงานนี้แสดงเฉพาะยอดรวม ไม่แสดงเงินเดือนรายบุคคล (BR-14)</p>
    </>
  );
}
