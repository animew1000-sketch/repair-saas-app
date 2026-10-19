const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const pool = require('./db/pool');
const path = require('path');

require('dotenv').config();

const companiesRoutes = require('./routes/companies');
const authRoutes = require('./routes/auth');
const managerRoutes = require('./routes/manager');
const customerRoutes = require('./routes/customer');
const toolsRoutes = require('./routes/tools');
const departmentRoutes = require('./routes/departments');

const app = express();

// ======================================================
// REVERSE PROXY
// ======================================================
// Production traffic comes through Nginx.
// This allows Express to use the real visitor IP address.
app.set('trust proxy', 1);

// ======================================================
// SECURITY HEADERS
// ======================================================
// Keep CSP disabled for now because the current frontend still uses
// inline scripts/styles and inline event handlers. The remaining
// Helmet protections are still enabled.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

// ======================================================
// REQUEST PARSING
// ======================================================
app.use(
  express.json({
    limit: '100kb'
  })
);

// ======================================================
// RATE LIMITING
// ======================================================

// General API protection
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error:
      'Too many requests. Please wait a few minutes and try again.'
  }
});

// Login brute-force protection
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,

  standardHeaders: true,
  legacyHeaders: false,

  // Successful logins do not count against the limit.
  skipSuccessfulRequests: true,

  message: {
    error:
      'Too many login attempts. Please wait 15 minutes and try again.'
  }
});

// Registration spam protection
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    error:
      'Too many account creation attempts. Please try again later.'
  }
});

// Apply stricter limits before the general API routes.
app.use('/api/login', loginLimiter);
app.use('/api/register', registerLimiter);

// General protection for all API requests.
app.use('/api', apiLimiter);

// MOT-030: Restrict platform administration resources to the DuckDNS developer host.
// This MUST run before express.static so public Motivo domains cannot fetch the dashboard.
app.use(require('./routes/platform-host-gate'));

// ======================================================
// STATIC FILES
// ======================================================
app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

// ======================================================
// API ROUTES
// ======================================================
// MOT-030: Independent developer administration API (password + TOTP + session).
app.use('/api/platform', require('./routes/platform-admin'));

// MOT-030 V2: Enforce shop lifecycle status before customer/staff API routes.
// Keep platform administrator routes outside tenant lifecycle middleware.
app.use(require('./routes/platform-status-gate'));

// ======================================================
// HEALTH CHECK
// ======================================================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.status(200).json({
      status: 'ok',
      database: 'connected',
      uptime: process.uptime()
    });
  } catch (err) {
    console.error('Health check failed:', err.message);

    res.status(503).json({
      status: 'error',
      database: 'disconnected'
    });
  }
});


app.use('/api/companies', companiesRoutes);
app.use('/api', authRoutes);
app.use('/api/manager/scheduling/disruptions', require('./routes/appointment-disruptions'));
app.use('/api/manager/scheduling', require('./routes/scheduling'));
app.use('/api/employee-permissions', require('./routes/employee-permissions'));
app.use('/api/manager', managerRoutes);
// MOT-028: mount before legacy customer routes to prevent bypassing request intake.
app.use('/api', require('./routes/mot028-booking'));
app.use('/api/mot028', require('./routes/mot028-booking'));
app.use('/api/customer', customerRoutes);
app.use('/api', toolsRoutes);
app.use('/api/department', departmentRoutes);


// ======================================================
// DATABASE CONNECTION VERIFICATION (READ-ONLY)
// ======================================================
// Schema migrations and initial tenant provisioning are performed separately.
// Never CREATE, ALTER, INSERT or seed production records during app startup.
async function verifyDatabase() {
  await pool.query('SELECT 1');
  console.log('MySQL connectivity verified.');
}

// ======================================================
// FRONTEND ROUTES
// ======================================================
app.get(
  ['/', '/:slug'],
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );
  }
);

// ======================================================
// START SERVER
// ======================================================
const PORT =
  process.env.PORT || 3000;

// Verify database connectivity BEFORE accepting traffic.
// Fail startup instead of reporting an online app against an unavailable DB.
async function startServer() {
  try {
    await verifyDatabase();
    const server = app.listen(PORT, () => {
      console.log(`Multi-Tenant SaaS Application live on http://localhost:${PORT}`);
    });
    server.on('error', (error) => {
      console.error('Unable to start Motivo:', error?.code || 'STARTUP_ERROR');
      process.exitCode = 1;
    });
  } catch (error) {
    // Never log raw SQL error objects or interpolated queries.
    console.error('MySQL startup check failed:', error?.code || 'DATABASE_UNAVAILABLE');
    await pool.end().catch(() => {});
    process.exitCode = 1;
  }
}

startServer();
