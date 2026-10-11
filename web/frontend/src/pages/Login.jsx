import { useState } from 'react';
import { api } from '../api.js';
import { Button, Field, Notice } from '../components/ui.jsx';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await api('POST', '/api/login', { username, password }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="gt-logo">Genertech Payroll</div>
        <h1 className="gt-h2">เข้าสู่ระบบ</h1>
        <Field label="ชื่อผู้ใช้" required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field label="รหัสผ่าน" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <Notice tone="danger" title={error} />}
        <Button type="submit" variant="primary" block disabled={busy}>เข้าสู่ระบบ</Button>
        <div className="login-demo">
          บัญชีทดลอง (รหัสผ่าน <code>1234</code>)<br />
          ฝ่ายบัญชี <code>somsri</code> · ผู้จัดการ <code>weera</code> · พนักงาน <code>EMP-0142</code>
        </div>
      </form>
    </div>
  );
}
