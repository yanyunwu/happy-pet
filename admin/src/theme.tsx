import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { App, Button, ConfigProvider, Tooltip, theme } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';

const ThemeContext = createContext({ dark: false, toggle: () => {} });
export function ThemeToggle() {
  const { dark, toggle } = useContext(ThemeContext);
  const label = dark ? '切换到浅色模式' : '切换到深色模式';
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        aria-label={label}
        onClick={toggle}
        icon={dark ? <SunOutlined /> : <MoonOutlined />}
      />
    </Tooltip>
  );
}
export function ThemeProvider({ children }: PropsWithChildren) {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem('happy-pet-admin-theme');
      return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);
  const toggle = () =>
    setDark((current) => {
      try {
        localStorage.setItem('happy-pet-admin-theme', current ? 'light' : 'dark');
      } catch {
        /* Theme can still change without persistence. */
      }
      return !current;
    });
  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          cssVar: { key: 'happy-pet-admin' },
          token: {
            colorPrimary: '#315c46',
            colorPrimaryHover: '#45775a',
            colorBgLayout: dark ? '#141b19' : '#f6f8f7',
            colorBgContainer: dark ? '#1e2823' : '#ffffff',
            colorBgElevated: dark ? '#25332b' : '#ffffff',
            fontFamily: 'Geist, "Noto Sans SC Variable", sans-serif',
            fontSize: 14,
            fontSizeSM: 12,
            borderRadius: 8,
            controlHeight: 36,
          },
          components: {
            Layout: {
              headerBg: dark ? '#1e2823' : '#ffffff',
              lightSiderBg: dark ? '#1e2823' : '#ffffff',
            },
            Menu: {
              itemHeight: 42,
              itemSelectedBg: dark ? '#314936' : '#edf3ec',
              itemSelectedColor: dark ? '#b1d0a9' : '#315c46',
            },
          },
        }}
      >
        <App>{children}</App>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
