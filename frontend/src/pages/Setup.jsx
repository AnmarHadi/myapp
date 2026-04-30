import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Setup() {
  const { setup } = useAuth();
  const [form, setForm]       = useState({ username: '', password: '', confirm: '' });
  const [errors, setErrors]   = useState({});
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const e = {};
    const username = form.username.trim();
    if (!username)                      e.username = 'اسم المستخدم مطلوب';
    else if (username.length < 3)       e.username = 'يجب أن يكون 3 أحرف على الأقل';
    if (!form.password)               e.password = 'كلمة المرور مطلوبة';
    else if (form.password.length < 6) e.password = 'يجب أن تكون 6 أحرف على الأقل';
    if (!form.confirm)                e.confirm  = 'تأكيد كلمة المرور مطلوب';
    else if (form.confirm !== form.password) e.confirm = 'كلمة المرور غير متطابقة';
    return e;
  };

  const handleChange = (e) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
    setErrors((p) => ({ ...p, [e.target.name]: '' }));
    setApiError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setLoading(true);
    try {
      await setup(form.username.trim(), form.password);
    } catch (err) {
      setApiError(err.response?.data?.message || 'حدث خطأ، يرجى المحاولة مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">🛡️</div>
          <h1>إعداد التطبيق</h1>
          <p>مرحباً! أنشئ حساب المدير للبدء في استخدام التطبيق</p>
        </div>

        {apiError && <div className="alert error">{apiError}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="username">اسم المستخدم</label>
            <input
              id="username"
              name="username"
              type="text"
              placeholder="أدخل اسم المستخدم"
              value={form.username}
              onChange={handleChange}
              className={errors.username ? 'error' : ''}
              autoFocus
            />
            {errors.username && <p className="error-msg">{errors.username}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="password">كلمة المرور</label>
            <input
              id="password"
              name="password"
              type="password"
              placeholder="أدخل كلمة المرور"
              value={form.password}
              onChange={handleChange}
              className={errors.password ? 'error' : ''}
            />
            {errors.password && <p className="error-msg">{errors.password}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="confirm">تأكيد كلمة المرور</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              placeholder="أعد إدخال كلمة المرور"
              value={form.confirm}
              onChange={handleChange}
              className={errors.confirm ? 'error' : ''}
            />
            {errors.confirm && <p className="error-msg">{errors.confirm}</p>}
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '⏳ جاري الإنشاء...' : '✅ إنشاء الحساب والبدء'}
          </button>
        </form>
      </div>
    </div>
  );
}
