// Shared UI components — same markup/classes as the Genertech Payroll design system.
import { useId } from 'react';
import { fmt, num, periodLabel, when } from '../format.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function Money({ amount, signed = false, lg = false, unit = false }) {
  if (amount === null || amount === undefined) return <span className="gp-money gt-muted">—</span>;
  let sign = '', tone = '';
  if (signed && amount > 0) { sign = '+'; tone = 'gp-pos'; }
  if (amount < 0) { sign = '−'; tone = signed ? 'gp-neg' : ''; }
  return (
    <span className={cx('gp-money', lg && 'gp-money-lg', tone)}>
      {sign}{fmt(Math.abs(amount))}
      {unit && <span className="gp-money-unit"> บาท</span>}
    </span>
  );
}

const STATUS = {
  draft: ['ร่าง', 'neutral'], returned: ['ส่งกลับแก้ไข', 'danger'], pending: ['รออนุมัติ', 'amber'],
  approved: ['อนุมัติแล้ว', 'info'], paid: ['จ่ายเงินเรียบร้อยแล้ว', 'success']
};
export function StatusBadge({ status }) {
  const [label, tone] = STATUS[status] || STATUS.draft;
  return <span className={`gp-badge gp-tone-${tone}`}><span className="gp-badge-dot" aria-hidden="true" />{label}</span>;
}

const TAGS = { monthly: 'รายเดือน', daily: 'รายวัน', transfer: 'โอนเข้าบัญชี', cash: 'เงินสด' };
export const PayTag = ({ kind }) => <span className={`gp-tag gp-tag-${kind}`}>{TAGS[kind]}</span>;

const GLYPH = { info: 'i', success: '✓', warning: '!', danger: '✕' };
export function Notice({ tone = 'info', title, children }) {
  return (
    <div className={`gp-notice gp-notice-${tone}`} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      <span className="gp-notice-g" aria-hidden="true">{GLYPH[tone]}</span>
      <div className="gp-notice-b">
        {title && <p className="gp-notice-t">{title}</p>}
        {children && <div className="gp-notice-c">{children}</div>}
      </div>
    </div>
  );
}

// A button blocked by a business rule stays visible and says why (disabledReason).
export function Button({ variant = 'secondary', size = 'md', block = false, disabledReason, children, ...rest }) {
  const id = useId();
  const btn = (
    <button type="button" {...rest}
      disabled={rest.disabled || !!disabledReason}
      aria-describedby={disabledReason ? id : undefined}
      className={cx('gp-btn', `gp-btn-${variant}`, `gp-btn-${size}`, block && 'gp-btn-block')}>
      {children}
    </button>
  );
  if (!disabledReason) return btn;
  return (
    <span className={cx('gp-btn-wrap', block && 'gp-btn-block')}>
      {btn}<span id={id} className="gp-btn-reason">{disabledReason}</span>
    </span>
  );
}

export function Field({ label, hint, suffix, multiline, options, required, ...rest }) {
  const id = useId();
  const props = { id, required, 'aria-describedby': hint ? `${id}-h` : undefined, ...rest };
  let ctl;
  if (options) {
    ctl = <select className="gp-input" {...props}>{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>;
  } else if (multiline) {
    ctl = <textarea className="gp-input gp-textarea" rows={3} {...props} />;
  } else {
    ctl = <input className={cx('gp-input', suffix && 'has-suffix')} {...props} />;
  }
  return (
    <div className="gp-field">
      <label htmlFor={id} className="gp-label">{label}{required && <span className="gp-req"> *จำเป็น</span>}</label>
      {suffix ? <div className="gp-input-wrap">{ctl}<span className="gp-suffix">{suffix}</span></div> : ctl}
      {hint && <p id={`${id}-h`} className="gp-help">{hint}</p>}
    </div>
  );
}

const STEPS = ['ประมวลผล', 'ฝ่ายบัญชีตรวจ', 'ผู้จัดการอนุมัติ', 'จ่ายเงิน'];
export function ApprovalSteps({ period }) {
  const cur = { draft: period.processed ? 1 : 0, returned: 1, pending: 2, approved: 3, paid: 4 }[period.status];
  const returned = period.status === 'returned';
  return (
    <ol className="gp-steps">
      {STEPS.map((s, i) => {
        const st = i < cur ? 'done' : i === cur ? (returned ? 'returned' : 'current') : 'todo';
        const mark = st === 'done' ? '✓' : st === 'returned' ? '↩' : i + 1;
        const sub = { done: 'เสร็จแล้ว', returned: 'ส่งกลับแก้ไข', current: 'กำลังดำเนินการ', todo: 'ยังไม่ถึง' }[st];
        return (
          <li key={s} className={`gp-step gp-step-${st}`} aria-current={i === cur ? 'step' : undefined}>
            <span className="gp-step-m" aria-hidden="true">{mark}</span>
            <span className="gp-step-tx"><span className="gp-step-l">{s}</span><span className="gp-step-s">{sub}</span></span>
          </li>
        );
      })}
    </ol>
  );
}

export function PageHead({ kicker, title, children }) {
  return (
    <div className="gt-head">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p className="gt-sub">{kicker}</p>
        <h1 className="gt-h1">{title}</h1>
      </div>
      {children}
    </div>
  );
}

export function Tiles({ totals: t, processed }) {
  const v = (n) => processed ? fmt(n) : '—';
  return (
    <div className="gt-tiles">
      <div className="gt-tile"><span className="gt-tile-k">ยอดสุทธิรวม</span><span className="gt-tile-v">{v(t.net)}</span><span className="gt-tile-n">บาท · {t.count} คน</span></div>
      <div className="gt-tile"><span className="gt-tile-k">โอนเข้าบัญชี (รายเดือน)</span><span className="gt-tile-v" style={{ color: 'var(--brand)' }}>{v(t.monthlyNet)}</span><span className="gt-tile-n">{t.monthly} คน</span></div>
      <div className="gt-tile"><span className="gt-tile-k">เงินสด (รายวัน)</span><span className="gt-tile-v" style={{ color: 'var(--amber)' }}>{v(t.dailyNet)}</span><span className="gt-tile-n">{t.daily} คน</span></div>
      <div className="gt-tile"><span className="gt-tile-k">OT รวม</span><span className="gt-tile-v">{num(t.ot_hours)} ชม.</span><span className="gt-tile-n">เงินเพิ่ม {v(t.ot_pay)} บาท</span></div>
    </div>
  );
}

export function PayrollTable({ detail, selected, onEdit }) {
  const { period, rows, totals: t } = detail;
  const amt = (n, o) => <Money amount={period.processed ? n : null} {...o} />;
  const neg = (n) => (n ? -n : 0);
  return (
    <div className="gt-tbl-wrap">
      <table className="gt-tbl">
        <caption>รายการเงินเดือน {periodLabel(period)}</caption>
        <thead>
          <tr>
            <th>รหัส</th><th>ชื่อ-สกุล</th><th>ประเภท</th>
            <th className="num">วันทำงาน</th><th className="num">ขาดงาน</th><th className="num">OT (ชม.)</th>
            <th className="num">ฐานค่าจ้าง</th><th className="num">เงินเพิ่ม (OT)</th><th className="num">เงินหัก</th>
            <th className="num">ภาษีหัก ณ ที่จ่าย</th><th className="num">สุทธิ (บาท)</th>
            {onEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee_id} className={selected === r.employee_id ? 'is-sel' : undefined}>
              <td><span className="gp-code">{r.code}</span></td>
              <td>{r.name}</td>
              <td><PayTag kind={r.type} /></td>
              <td className="num gt-mono">{num(r.days_worked)}</td>
              <td className={cx('num gt-mono', r.absent_days > 0 && 'gt-flag')}>{num(r.absent_days)}</td>
              <td className={cx('num gt-mono', r.ot_hours > 0 && 'gt-ot')}>{num(r.ot_hours)}</td>
              <td className="num">{amt(r.base)}</td>
              <td className="num">{amt(r.ot_pay, { signed: true })}</td>
              <td className="num">{amt(neg(r.deduction), { signed: true })}</td>
              <td className="num">{amt(neg(r.tax))}</td>
              <td className="num" style={{ fontWeight: 500 }}>{amt(r.net)}</td>
              {onEdit && <td><button type="button" className="link-btn" onClick={() => onEdit(r.employee_id)}>แก้ไข</button></td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>รวม {t.count} คน</td>
            <td className="num gt-mono">{num(t.ot_hours)}</td>
            <td />
            <td className="num">{amt(t.ot_pay, { signed: true })}</td>
            <td className="num">{amt(neg(t.deduction), { signed: true })}</td>
            <td className="num">{amt(neg(t.tax))}</td>
            <td className="num">{amt(t.net)}</td>
            {onEdit && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const ACTIONS = { create: 'สร้างรอบการจ่าย', process: 'ประมวลผลเงินเดือน', submit: 'ส่งเข้าขั้นตอนอนุมัติ', approve: 'อนุมัติการสั่งจ่าย', return: 'ส่งกลับแก้ไข', pay: 'ยืนยันการจ่ายเงิน' };
export function AuditLog({ audit, title = 'ประวัติการแก้ไขและการดำเนินการ' }) {
  return (
    <section className="gt-card" style={{ gap: 0 }}>
      <h2 className="gt-h3" style={{ marginBottom: 4 }}>{title}</h2>
      <div className="audit-scroll">
        {audit.length === 0 && <p className="gt-sub">ยังไม่มีรายการ</p>}
        {audit.map((a) => a.action === 'edit' ? (
          <div key={a.id} className="gp-audit">
            <div className="gp-audit-meta"><span className="gp-audit-who">{a.user_name}</span><time className="gp-audit-at">{when(a.at)}</time></div>
            <div className="gp-audit-chg">
              <span className="gp-audit-f">{a.field} · {a.employee_code} {a.employee_name}</span>
              <span className="gp-audit-from">{a.old_value}</span>
              <span className="gp-audit-arr" aria-hidden="true">→</span>
              <span className="gp-audit-to">{a.new_value}</span>
            </div>
            <p className="gp-audit-r">เหตุผล: {a.reason}</p>
          </div>
        ) : (
          <div key={a.id} className="audit-act">
            <span><b>{a.user_name}</b> {ACTIONS[a.action] || a.action}{a.reason ? ` — ${a.reason}` : ''}</span>
            <time className="gt-muted gt-mono" style={{ fontSize: 12 }}>{when(a.at)}</time>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PeriodList({ list, selectedId, onSelect }) {
  if (!list.length) return <div className="gt-card"><p className="gt-sub">ไม่มีรอบการจ่ายในขั้นตอนนี้</p></div>;
  return (
    <div className="plist">
      {list.map((p) => (
        <button key={p.id} type="button" className={p.id === selectedId ? 'is-on' : undefined} onClick={() => onSelect(p.id)}>
          <span className="plist-t">
            <b>{periodLabel(p)}</b>
            <span className="gt-sub" style={{ fontSize: 13 }}>{p.totals.count} คน · {fmt(p.totals.net)} บาท</span>
          </span>
          <StatusBadge status={p.status} />
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="gt-card empty">
      {title && <h2 className="gt-h3">{title}</h2>}
      {children}
    </div>
  );
}
