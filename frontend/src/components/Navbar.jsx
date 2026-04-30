import { useAuth } from '../context/AuthContext';

export default function Navbar({ isOpen, toggleSidebar, pageTitle }) {
  const { user } = useAuth();
  const initial = user?.username?.charAt(0)?.toUpperCase() || 'A';

  return (
    <header className="navbar">
      <div className="navbar-right">
        <button
          className={`hamburger-btn ${isOpen ? 'open' : ''}`}
          onClick={toggleSidebar}
          title="إظهار/إخفاء القائمة"
        >
          <span />
          <span />
          <span />
        </button>
        <span className="page-title">{pageTitle || 'لوحة التحكم'}</span>
      </div>

      <div className="navbar-left">
        <div className="user-info">
          <span className="user-name">{user?.username}</span>
          <span className="user-role">
            {user?.role === 'admin' ? 'مدير النظام' : 'مستخدم'}
          </span>
        </div>
        <div className="user-avatar">{initial}</div>
      </div>
    </header>
  );
}
