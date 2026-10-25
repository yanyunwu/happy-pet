import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { App } from 'antd';
import { api, ApiError, errorMessage, type AdminAccount } from './api';

interface Auth {
  user: AdminAccount | null;
  loading: boolean;
  login(values: { username: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  clearSession(): void;
}
const AuthContext = createContext<Auth | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
export function AuthProvider({ children }: PropsWithChildren) {
  const { message } = App.useApp();
  const [user, setUser] = useState<AdminAccount | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api
      .me()
      .then((next) => {
        if (active) setUser(next);
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof ApiError && error.status === 401))
          void message.error(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const expire = () => setUser(null);
    window.addEventListener('happy-pet-auth-expired', expire);
    return () => {
      active = false;
      window.removeEventListener('happy-pet-auth-expired', expire);
    };
  }, [message]);
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        clearSession: () => setUser(null),
        login: async (values) => {
          setUser(await api.login(values));
        },
        logout: async () => {
          await api.logout();
          setUser(null);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
