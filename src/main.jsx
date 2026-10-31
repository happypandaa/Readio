import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader';
import './styles/tokens.css';
import './styles/base.css';
import './styles/list.css';
import './styles/study.css';
import './styles/overlay.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
