import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './ui/App';
import { init } from './state/store';

void init();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
