import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { init } from './store.js';
import { applyTheme } from './theme.jsx';
import './styles.css';

applyTheme();
init();
createRoot(document.getElementById('root')).render(<App />);
