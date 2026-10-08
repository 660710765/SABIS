import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDb, verifyPassword, hashPassword } from './db.js';
import * as svc from './service.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // project root (web/)
const PUBLIC = path.join(ROOT, 'dist'); // React build output (`npm run build`)
const PORT = Number(process.env.PORT) || 3000;
const db = openDb(process.env.DB_FILE || path.join(ROOT, 'payroll.db'));

// ---------- sessions ----------
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map(); // token -> { userId, expires }

function currentUser(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || s.expires < Date.now()) { sessions.delete(m?.[1]); return null; }
  s.expires = Date.now() + SESSION_MS;
  return db.prepare('SELECT id, username, name, role, employee_id FROM users WHERE id = ?').get(s.userId) || null;
}

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(isText ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 100_000) throw new svc.AppError(413, 'ข้อมูลมีขนาดใหญ่เกินไป');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new svc.AppError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }
}

function need(user, ...roles) {
  if (!user) throw new svc.AppError(401, 'กรุณาเข้าสู่ระบบ');
  if (roles.length && !roles.includes(user.role)) throw new svc.AppError(403, 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
}

const int = (v) => Number.parseInt(v, 10);

// ---------- routes ----------
// BR-14: payroll amounts are visible only to accounting and the approving manager;
// employees only reach their own payslips.
const routes = [
  ['POST', /^\/api\/login$/, async (req, res) => {
    const { username, password } = await readJson(req);
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
      throw new svc.AppError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: u.id, expires: Date.now() + SESSION_MS });
    send(res, 200, { id: u.id, username: u.username, name: u.name, role: u.role, employee_id: u.employee_id },
      { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
  }],
  ['POST', /^\/api\/logout$/, async (req, res) => {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (m) sessions.delete(m[1]);
    send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }],
  ['GET', /^\/api\/me$/, async (req, res, user) => {
    need(user);
    send(res, 200, user);
  }],

  // periods
  ['GET', /^\/api\/periods$/, async (req, res, user, url) => {
    need(user, 'accountant', 'manager');
    const q = url.searchParams;
    if (q.has('year')) {
      const p = svc.findPeriod(db, int(q.get('year')), int(q.get('month')), int(q.get('round')));
      return send(res, 200, p ? svc.periodDetail(db, p.id) : null);
    }
    const statuses = (q.get('status') || 'draft,returned,pending,approved,paid').split(',');
    send(res, 200, svc.listPeriods(db, statuses).map((p) => ({ ...p, totals: svc.totals(svc.periodDetail(db, p.id).rows) })));
  }],
  ['POST', /^\/api\/periods$/, async (req, res, user) => {
    need(user, 'accountant');
    const b = await readJson(req);
    const id = svc.createPeriod(db, int(b.year), int(b.month), int(b.round), user);
    send(res, 201, svc.periodDetail(db, id));
  }],
  ['GET', /^\/api\/periods\/(\d+)$/, async (req, res, user, url, [id]) => {
    need(user, 'accountant', 'manager');
    send(res, 200, svc.periodDetail(db, int(id)));
  }],
  ['PATCH', /^\/api\/periods\/(\d+)\/attendance\/(\d+)$/, async (req, res, user, url, [id, emp]) => {
    need(user, 'accountant');
    const b = await readJson(req);
    svc.updateAttendance(db, int(id), int(emp), b, b.reason, user);
    send(res, 200, svc.periodDetail(db, int(id)));
  }],
  ['POST', /^\/api\/periods\/(\d+)\/(process|submit|pay)$/, async (req, res, user, url, [id, action]) => {
    need(user, 'accountant');
    ({ process: svc.processPeriod, submit: svc.submitPeriod, pay: svc.payPeriod })[action](db, int(id), user);
    send(res, 200, svc.periodDetail(db, int(id)));
  }],
  ['POST', /^\/api\/periods\/(\d+)\/approve$/, async (req, res, user, url, [id]) => {
    need(user, 'manager');
    svc.approvePeriod(db, int(id), user);
    send(res, 200, svc.periodDetail(db, int(id)));
  }],
  ['POST', /^\/api\/periods\/(\d+)\/return$/, async (req, res, user, url, [id]) => {
    need(user, 'manager');
    const b = await readJson(req);
    svc.returnPeriod(db, int(id), b.reason, user);
    send(res, 200, svc.periodDetail(db, int(id)));
  }],
  ['GET', /^\/api\/periods\/(\d+)\/bank-file$/, async (req, res, user, url, [id]) => {
    need(user, 'accountant');
    const p = svc.getPeriod(db, int(id));
    const csv = svc.bankFile(db, p.id);
    send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bank-payroll-${p.year}-${String(p.month).padStart(2, '0')}-r${p.round}.csv"`
    });
  }],

  // employee self-service
  ['GET', /^\/api\/my\/payslips$/, async (req, res, user) => {
    need(user, 'employee');
    const emp = db.prepare('SELECT code, name, type FROM employees WHERE id = ?').get(user.employee_id);
    send(res, 200, { employee: emp, payslips: svc.payslips(db, user.employee_id) });
  }],

  // employee master data (salary rates) — accounting only
  ['GET', /^\/api\/employees$/, async (req, res, user) => {
    need(user, 'accountant');
    send(res, 200, db.prepare('SELECT * FROM employees ORDER BY active DESC, code').all());
  }],
  ['POST', /^\/api\/employees$/, async (req, res, user) => {
    need(user, 'accountant');
    const e = validateEmployee(await readJson(req));
    const last = db.prepare("SELECT code FROM employees ORDER BY code DESC LIMIT 1").get();
    const next = 'EMP-' + String((last ? int(last.code.slice(4)) : 100) + 1).padStart(4, '0');
    svc.tx(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO employees (code, name, type, rate, bank, account) VALUES (?, ?, ?, ?, ?, ?)')
        .run(next, e.name, e.type, e.rate, e.bank, e.account);
      db.prepare('INSERT INTO users (username, name, role, password_hash, employee_id) VALUES (?, ?, ?, ?, ?)')
        .run(next, e.name, 'employee', hashPassword('1234'), Number(lastInsertRowid));
    });
    send(res, 201, db.prepare('SELECT * FROM employees WHERE code = ?').get(next));
  }],
  ['PATCH', /^\/api\/employees\/(\d+)$/, async (req, res, user, url, [id]) => {
    need(user, 'accountant');
    const cur = db.prepare('SELECT * FROM employees WHERE id = ?').get(int(id));
    if (!cur) throw new svc.AppError(404, 'ไม่พบพนักงาน');
    const e = validateEmployee({ ...cur, ...(await readJson(req)) });
    db.prepare('UPDATE employees SET name = ?, type = ?, rate = ?, bank = ?, account = ?, active = ? WHERE id = ?')
      .run(e.name, e.type, e.rate, e.bank, e.account, e.active ? 1 : 0, cur.id);
    db.prepare('UPDATE users SET name = ? WHERE employee_id = ?').run(e.name, cur.id);
    send(res, 200, db.prepare('SELECT * FROM employees WHERE id = ?').get(cur.id));
  }]
];

function validateEmployee(b) {
  const name = String(b.name || '').trim();
  if (!name) throw new svc.AppError(400, 'กรุณากรอกชื่อ-สกุล');
  if (!['monthly', 'daily'].includes(b.type)) throw new svc.AppError(400, 'ประเภทการจ้างไม่ถูกต้อง');
  const rate = Number(b.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new svc.AppError(400, 'อัตราค่าจ้างต้องมากกว่า 0');
  const bank = String(b.bank || '').trim() || null;
  const account = String(b.account || '').trim() || null;
  if (b.type === 'monthly' && (!bank || !account)) throw new svc.AppError(400, 'พนักงานรายเดือนต้องมีธนาคารและเลขบัญชีสำหรับโอนเงิน (BR-03)');
  return { name, type: b.type, rate, bank, account, active: b.active === undefined ? 1 : Number(b.active) };
}

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function serveStatic(res, pathname) {
  // React Router uses real paths (/payroll, /approve …): anything that is not a file gets index.html.
  const asked = decodeURIComponent(pathname).replace(/^\/+/, '');
  const rel = asked === '' || !path.extname(asked) ? 'index.html' : asked;
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'Not found');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    if (rel === 'index.html') return send(res, 503, 'ยังไม่ได้ build หน้าเว็บ — รัน `npm run build` ก่อน หรือใช้ `npm run dev` ระหว่างพัฒนา');
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      // Basic CSRF guard: state-changing API calls must come from this site as JSON.
      if (req.method !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) {
        throw new svc.AppError(415, 'ต้องส่งข้อมูลแบบ JSON');
      }
      const user = currentUser(req);
      for (const [method, re, handler] of routes) {
        const m = re.exec(url.pathname);
        if (m && method === req.method) return await handler(req, res, user, url, m.slice(1));
      }
      throw new svc.AppError(404, 'ไม่พบ API นี้');
    }
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
    await serveStatic(res, url.pathname);
  } catch (err) {
    if (err instanceof svc.AppError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'เกิดข้อผิดพลาดภายในระบบ' });
  }
});

server.listen(PORT, () => {
  console.log(`Genertech Payroll: http://localhost:${PORT}`);
});
