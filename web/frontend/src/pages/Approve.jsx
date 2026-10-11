// UC-08 / BR-12, BR-13: the manager approves a submitted round or sends it back with a reason.
import { useState } from 'react';
import { api } from '../api.js';
import { periodLabel, when } from '../format.js';
import { usePeriodQueue } from './usePeriodQueue.js';
import {
  ApprovalSteps, AuditLog, Button, EmptyState, Field, Notice, PageHead, PayrollTable, PeriodList, StatusBadge, Tiles
} from '../components/ui.jsx';

export default function Approve() {
  const { list, id, detail, select, reload, run } = usePeriodQueue('pending,approved');
  const [reason, setReason] = useState('');

  if (list === null) return <p className="gt-sub">กำลังโหลด…</p>;
  if (!detail) {
    return (
      <>
        <PageHead kicker="อนุมัติการสั่งจ่าย · UC-08" title="ไม่มีรอบที่รออนุมัติ" />
        <EmptyState><p className="gt-sub">เมื่อฝ่ายบัญชีส่งยอดเงินเดือนเข้าขั้นตอนอนุมัติ รายการจะแสดงที่นี่</p></EmptyState>
      </>
    );
  }

  const p = detail.period;
  const edits = detail.audit.filter((a) => a.action === 'edit').length;
  const approve = () => run(async () => { await api('POST', `/api/periods/${p.id}/approve`, {}); await reload(); }, 'อนุมัติการสั่งจ่ายแล้ว');
  const sendBack = () => run(async () => {
    await api('POST', `/api/periods/${p.id}/return`, { reason });
    setReason('');
    await reload();
  }, 'ส่งกลับให้ฝ่ายบัญชีแก้ไขแล้ว');

  return (
    <>
      <PageHead kicker="อนุมัติการสั่งจ่าย · UC-08" title={`อนุมัติเงินเดือน ${periodLabel(p)}`}>
        <StatusBadge status={p.status} />
      </PageHead>
      {list.length > 1 && <PeriodList list={list} selectedId={id} onSelect={select} />}
      <ApprovalSteps period={p} />
      <Notice tone="info" title={`ส่งโดย ${p.submitted_by || '-'} · ${when(p.submitted_at)}`}>แก้ไขโดยฝ่ายบัญชีในรอบนี้ {edits} รายการ</Notice>
      <Tiles totals={detail.totals} processed />

      <div className="gt-cols">
        <div className="gt-col-main"><PayrollTable detail={detail} /></div>
        <div className="gt-col-side">
          <section className="gt-card">
            {p.status === 'pending' ? (
              <>
                <h2 className="gt-h3">ผลการตรวจสอบ</h2>
                <p style={{ margin: 0, fontSize: 14, lineHeight: '22px' }}>ตรวจยอด OT และรายการหักของแต่ละคน หากถูกต้องให้อนุมัติ ถ้าพบจุดผิดให้ระบุเหตุผลแล้วส่งกลับแก้ไข</p>
                <Button variant="primary" size="lg" block onClick={approve}>อนุมัติการสั่งจ่าย</Button>
              </>
            ) : (
              <>
                <h2 className="gt-h3">อนุมัติแล้ว · รอฝ่ายบัญชีจ่ายเงิน</h2>
                <p className="gt-sub">อนุมัติโดย {p.approved_by} · {when(p.approved_at)} หากพบข้อผิดพลาดก่อนจ่าย ส่งกลับให้ฝ่ายบัญชีแก้ไขได้ (BR-13)</p>
              </>
            )}
            <Field label="เหตุผลที่ส่งกลับ" multiline value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น ชั่วโมง OT ของ EMP-0142 ไม่ตรงกับบันทึกหน้างาน" />
            <Button block onClick={sendBack}>ส่งกลับแก้ไข</Button>
          </section>
          <AuditLog audit={detail.audit} />
        </div>
      </div>
    </>
  );
}
