'use strict';

const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Add JWT_SECRET to your .env file before starting the server.'
  );
}

// All protected requests must belong to a live, unrevoked session.
// Reading a session does NOT extend inactivity: only the explicit
// /api/session/activity endpoint records meaningful user activity.
async function authenticateToken(req, res, next) {
  const authorization = req.get('authorization');
  const match = typeof authorization === 'string'
    ? /^Bearer\s+(\S+)$/i.exec(authorization)
    : null;

  if (!match) {
    return res.status(401).json({
      code: 'AUTH_REQUIRED',
      error: 'Please sign in to continue.'
    });
  }

  let user;
  try {
    user = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        error: 'Your access token expired. Please sign in again.'
      });
    }
    return res.status(401).json({
      code: 'TOKEN_INVALID',
      error: 'Your sign-in token is invalid. Please sign in again.'
    });
  }

  if (
    !user ||
    typeof user.sid !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(user.sid) ||
    !Number.isInteger(user.id) ||
    !Number.isInteger(user.company_id)
  ) {
    return res.status(401).json({
      code: 'TOKEN_INVALID',
      error: 'Your sign-in token is invalid. Please sign in again.'
    });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id
         FROM auth_sessions
        WHERE id = ?
          AND user_id = ?
          AND company_id = ?
          AND revoked_at IS NULL
          AND last_activity_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
          AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 HOUR)
        LIMIT 1`,
      [user.sid, user.id, user.company_id]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        code: 'SESSION_EXPIRED',
        error: 'Your session has ended. Please sign in again.'
      });
    }

    req.user = user;
    return next();
  } catch (err) {
    // Database failures are not evidence of an expired login.
    console.error('Session validation unavailable:', err.code || err.message);
    return res.status(503).json({
      code: 'SESSION_UNAVAILABLE',
      error: 'Unable to verify your session right now. Please try again.'
    });
  }
}

const ROLE_PERMISSIONS = {
  customer: [],
  service_advisor: [
    'customer',
    'vehicle',
    'appointment',
    'repair_order',
    'estimate'
  ],
  technician: ['parts_labor', 'repair'],
  parts_manager: ['parts_labor'],
  billing: ['estimate', 'invoice'],
  manager: [
    'customer',
    'vehicle',
    'appointment',
    'repair_order',
    'parts_labor',
    'estimate',
    'repair',
    'invoice'
  ]
};

function authorizeDepartment(req, res, next) {
  const userRole = req.user.role;
  const dept = req.params.name;

  if (userRole === 'manager') {
    return next();
  }

  const allowedDepts = ROLE_PERMISSIONS[userRole] || [];

  if (!allowedDepts.includes(dept)) {
    return res.status(403).json({
      error: `Unauthorized: Your rank (${userRole}) cannot modify ${dept}.`
    });
  }

  next();
}

module.exports = {
  authenticateToken,
  authorizeDepartment
};
