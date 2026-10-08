export const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const fmt = (n) => nf2.format(n || 0);
export const num = (n) => nfN.format(n || 0);

export const lastDay = (year, month) => new Date(year, month, 0).getDate();

// BR-01: "รอบ 2 · 16–31 ต.ค. 2569" (Buddhist year)
export function periodLabel(p) {
  const range = p.round === 1 ? '1–15' : `16–${lastDay(p.year, p.month)}`;
  return `รอบ ${p.round} · ${range} ${MONTHS[p.month - 1]} ${p.year + 543}`;
}

export const when = (iso) => iso
  ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' น.'
  : '';
