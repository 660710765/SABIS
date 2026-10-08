import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api.js';
import { ToastProvider } from './components/toast.jsx';
import Login from './pages/Login.jsx';
import Payroll from './pages/Payroll.jsx';
import Approve from './pages/Approve.jsx';
import Disburse from './pages/Disburse.jsx';
import Employees from './pages/Employees.jsx';
import Payslip from './pages/Payslip.jsx';

// Pages per role. BR-14 is enforced by the server; this only decides which pages a role can open.
const NAV = {
  accountant: [
    { path: '/payroll', label: 'คำนวณเงินเดือน', Page: Payroll },
    { path: '/disburse', label: 'จ่ายเงินเดือน', Page: Disburse },
    { path: '/employees', label: 'พนักงานและอัตราค่าจ้าง', Page: Employees }
  ],
  manager: [{ path: '/approve', label: 'อนุมัติการสั่งจ่าย', Page: Approve }],
  employee: [{ path: '/payslip', label: 'สลิปเงินเดือน', Page: Payslip }]
};
const ROLE_NAME = { accountant: 'ฝ่ายบัญชีและการเงิน', manager: 'ผู้จัดการ · ผู้มีอำนาจอนุมัติ', employee: 'พนักงาน' };

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking the session

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api('GET', '/api/me').then(setUser, () => setUser(null));
  }, []);

  if (user === undefined) return null;

  return (
    <BrowserRouter>
      <ToastProvider>
        {user
          ? <Shell user={user} onLogout={() => setUser(null)} />
          : (
            <Routes>
              <Route path="/login" element={<Login onLogin={setUser} />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          )}
      </ToastProvider>
    </BrowserRouter>
  );
}

function Shell({ user, onLogout }) {
  const navigate = useNavigate();
  const items = NAV[user.role];

  const logout = async () => {
    await api('POST', '/api/logout', {}).catch(() => {});
    onLogout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="gt-app">
      <nav className="gt-nav no-print" aria-label="เมนูหลัก">
        <div className="gt-logo">Genertech Payroll</div>
        <div className="gt-nav-list">
          {items.map(({ path, label }) => (
            <NavLink key={path} to={path} className={({ isActive }) => (isActive ? 'is-on' : undefined)}>{label}</NavLink>
          ))}
        </div>
        <div className="gt-user">
          <b>{user.name}</b>
          <span className="gt-muted">{ROLE_NAME[user.role]}</span><br />
          <button type="button" className="gt-nav-out" onClick={logout}>ออกจากระบบ</button>
        </div>
      </nav>
      <main className="gt-main">
        <div className="gt-wrap">
          <Routes>
            {items.map(({ path, Page }) => <Route key={path} path={path} element={<Page user={user} />} />)}
            {/* Anything else (including /login after signing in) goes to the role's first page. */}
            <Route path="*" element={<Navigate to={items[0].path} replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
