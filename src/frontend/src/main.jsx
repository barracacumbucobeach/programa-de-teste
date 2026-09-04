import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { getInitialTheme, applyTheme } from './theme.js';
import './styles.css';

// Aplica o tema salvo antes do primeiro paint, para não piscar o tema errado.
applyTheme(getInitialTheme());

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
