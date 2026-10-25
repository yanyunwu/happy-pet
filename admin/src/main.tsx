import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './theme';
import 'antd/dist/reset.css';
import '@fontsource-variable/noto-sans-sc';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={__ADMIN_CONFIG__.basePath}>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </BrowserRouter>,
);
