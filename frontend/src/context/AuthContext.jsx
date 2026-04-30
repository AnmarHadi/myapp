import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSetup, setIsSetup] = useState(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [backendMessage, setBackendMessage] = useState('');

  const syncSetupState = async () => {
    const { data } = await axios.get('/api/auth/check-setup');

    if (data?.code === 'database_unavailable') {
      setBackendUnavailable(true);
      setBackendMessage(data.message || 'تعذر الاتصال بقاعدة البيانات حالياً');
      setIsSetup(null);
      return false;
    }

    setIsSetup(data.isSetup);
    setBackendUnavailable(false);
    setBackendMessage('');
    return true;
  };

  // التحقق من وجود الأدمن عند بدء التطبيق
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const ready = await syncSetupState();
        if (!ready) {
          return;
        }

        const token = localStorage.getItem('token');
        if (token) {
          const res = await axios.get('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          setUser(res.data);
        }
      } catch (error) {
        const code = error?.response?.data?.code || '';
        const message = error?.response?.data?.message || '';

        if (code === 'database_unavailable' || error?.response?.status === 503) {
          setBackendUnavailable(true);
          setBackendMessage(message || 'تعذر الاتصال بقاعدة البيانات حالياً');
          setIsSetup(null);
        } else {
          localStorage.removeItem('token');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    init();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!backendUnavailable) {
      return undefined;
    }

    let cancelled = false;

    const retry = async () => {
      try {
        const ready = await syncSetupState();
        if (!ready || cancelled) {
          return;
        }

        const token = localStorage.getItem('token');
        if (token) {
          const res = await axios.get('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!cancelled) {
            setUser(res.data);
          }
        }
      } catch (_error) {
        // Keep retrying until MongoDB is available again.
      }
    };

    retry();
    const timer = setInterval(retry, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [backendUnavailable]);

  const login = async (username, password) => {
    const { data } = await axios.post('/api/auth/login', {
      username: username.trim(),
      password,
    });
    localStorage.setItem('token', data.token);
    setUser(data);
    return data;
  };

  const setup = async (username, password) => {
    const { data } = await axios.post('/api/auth/setup', {
      username: username.trim(),
      password,
    });
    localStorage.setItem('token', data.token);
    setUser(data);
    setIsSetup(true);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      isSetup,
      login,
      setup,
      logout,
      backendUnavailable,
      backendMessage,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
