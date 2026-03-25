require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { csrfProtect, csrfTokenHandler } = require('./middleware/csrf');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true, // required so the browser sends/receives cookies cross-origin
}));

app.use(express.json());

// Expose CSRF token endpoint (must be before csrfProtect so it's never blocked)
app.get('/api/csrf-token', csrfTokenHandler);

// Apply CSRF protection to all state-changing routes
app.use(csrfProtect);

app.use(require('./routes'));

module.exports = app;
