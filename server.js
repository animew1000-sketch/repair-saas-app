const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const pool = require('./db/pool');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const companiesRoutes = require('./routes/companies');
const authRoutes = require('./routes/auth');
const managerRoutes = require('./routes/manager');
const customerRoutes = require('./routes/customer');
const toolsRoutes = require('./routes/tools');
const departmentRoutes = require('./routes/departments');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Phase 1A: report potential CSP violations without blocking legacy pages.
app.use(require('./middleware/csp-report-only'));

app.use(express.json({ limit: '100kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many account creation attempts. Please try again later.' }
});

app.use('/api/login', loginLimiter);
app.use('/api/register', registerLimiter);
app.use('/api', apiLimiter);

// MOT-030: restrict the developer console before serving any static files.
app.use(require('./routes/platform-host-gate'));

// Motivo v22: apply minimum-age acknowledgement and registration password policy
// on the server, BEFORE the existing /api/register controller runs.
// Existing customer and staff logins remain unchanged.
app.use('/api/register', require('./routes/registration-compliance'));

// Motivo v22: strip an unused third-party Google Fonts CSS import at the HTTP
// response boundary. Preserve every other existing stylesheet rule, even on
// older pages. This prevents external font requests without rewriting the
// extensive existing base stylesheet in an incremental deploy.
const legacyStylesheetPath = path.join(__dirname, 'public', 'styles-reworked.css');
let legacyStylesheet = fs.readFileSync(legacyStylesheetPath, 'utf8');
legacyStylesheet = legacyStylesheet.replace(
  /^\s*@import\s+url\(\s*['"]https:\/\/fonts\.googleapis\.com\/[^\n]*?\);\s*$/gm,
  ''
);
if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(legacyStylesheet)) {
  throw new Error('Unexpected third-party font reference in styles-reworked.css; review before startup.');
}
app.get('/styles-reworked.css', (req, res) => {
  res.type('text/css');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(legacyStylesheet);
});

// Revalidate older HTML cache-version URLs after the drag-and-drop update.
app.use((req, res, next) => {
  if (['/theme.js', '/i18n.css', '/motivo-signup-compliance-v22.js'].includes(req.path)) {
    res.set('Cache-Control','no-cache, must-revalidate');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/platform', require('./routes/platform-admin'));
app.use(require('./routes/platform-status-gate'));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({status: 'ok', database: 'connected', uptime: process.uptime()});
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(503).json({status: 'error', database: 'disconnected'});
  }
});

app.use('/api/companies', companiesRoutes);
app.use('/api', authRoutes);
app.use('/api/manager/scheduling/disruptions', require('./routes/appointment-disruptions'));
app.use('/api/manager/scheduling', require('./routes/scheduling'));
app.use('/api/employee-permissions', require('./routes/employee-permissions'));
app.use('/api/manager', managerRoutes);
app.use('/api', require('./routes/mot028-booking'));
app.use('/api/mot028', require('./routes/mot028-booking'));
app.use('/api/customer', customerRoutes);
app.use('/api', toolsRoutes);
app.use('/api/department', departmentRoutes);

async function verifyDatabase() {
  await pool.query('SELECT 1');
  console.log('MySQL connectivity verified.');
}

app.get(['/', '/:slug'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
async function startServer() {
  try {
    await verifyDatabase();
    const server = app.listen(PORT, () => {
      console.log(`Multi-Tenant SaaS Application live on http://localhost:${PORT}`);
    });
    server.on('error', error => {
      console.error('Unable to start Motivo:', error?.code || 'STARTUP_ERROR');
      process.exitCode = 1;
    });
  } catch (error) {
    console.error('MySQL startup check failed:', error?.code || 'DATABASE_UNAVAILABLE');
    await pool.end().catch(() => {});
    process.exitCode = 1;
  }
}
startServer();
