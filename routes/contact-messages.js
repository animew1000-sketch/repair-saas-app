
'use strict';

// Motivo - Secure public contact submissions.
// Messages are stored in MySQL and reviewed through the
// existing protected developer dashboard.

const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');

const router = express.Router();

// --------------------------------------------------
// 1. Rate limiting
// --------------------------------------------------

// Maximum 3 requests per IP per hour.
const hourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many messages. Please try again in an hour.'
  }
});

// Maximum 10 requests per IP per 24 hours.
const dailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Daily message limit reached. Please try again later.'
  }
});

// --------------------------------------------------
// 2. Input validation
// --------------------------------------------------

const categories = new Set([
  'general',
  'onboarding',
  'technical',
  'billing',
  'feedback',
  'other'
]);

function clean(value, maxLength) {
  if (typeof value !== 'string') return null;

  const result = value.trim();

  if (!result || result.length > maxLength) {
    return null;
  }

  // Reject null bytes and unwanted control characters.
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(result)) {
    return null;
  }

  return result;
}

function validEmail(email) {
  if (!email || email.length > 254) return false;

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --------------------------------------------------
// 3. Same-origin protection
// --------------------------------------------------

function allowedOrigin(req) {
  const origin = req.get('origin');

  // Browser fetch requests from our form send Origin.
  // In production, reject requests missing it.
  if (!origin) {
    return process.env.NODE_ENV !== 'production';
  }

  try {
    const source = new URL(origin);

    if (source.host !== req.get('host')) {
      return false;
    }

    if (
      process.env.NODE_ENV === 'production' &&
      source.protocol !== 'https:'
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// --------------------------------------------------
// 4. Public contact submission
// --------------------------------------------------

router.post(
  '/',
  dailyLimiter,
  hourlyLimiter,
  async (req, res) => {
    res.set('Cache-Control', 'no-store');

    // Require JSON to avoid unexpected form submissions.
    if (!req.is('application/json')) {
      return res.status(415).json({
        error: 'Unsupported request format.'
      });
    }

    if (!allowedOrigin(req)) {
      return res.status(403).json({
        error: 'Request origin not allowed.'
      });
    }

    // Require an ordinary JSON object.
    if (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body)
    ) {
      return res.status(400).json({
        error: 'Invalid request.'
      });
    }

    // Honeypot: quietly discard likely bot submissions.
    if (req.body.website) {
      return res.status(202).json({
        success: true
      });
    }

    const name = clean(req.body.name, 120);

    const email = clean(req.body.email, 254);

    const subject = clean(req.body.subject, 160);

    const message = clean(req.body.message, 5000);

    const category = req.body.category;

    // Validate all fields before touching the database.
    if (
      !name ||
      !validEmail(email) ||
      !subject ||
      !message ||
      !categories.has(category)
    ) {
      return res.status(400).json({
        error: 'Please complete all fields with valid information.'
      });
    }

    // Match the form's existing minlength requirement.
    if (message.length < 10) {
      return res.status(400).json({
        error: 'Please provide at least 10 characters.'
      });
    }

    if (req.body.privacy_ack !== true) {
      return res.status(400).json({
        error: 'Please acknowledge the privacy notice.'
      });
    }

    const normalizedEmail = email.toLowerCase();

    try {
      // --------------------------------------------------
      // 5. Duplicate-message protection
      // --------------------------------------------------

      // Avoid storing the exact same message repeatedly
      // from the same email address within 24 hours.
      const [duplicates] = await pool.query(
        `SELECT id
         FROM platform_contact_messages
         WHERE email = ?
           AND subject = ?
           AND message = ?
           AND created_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR
         LIMIT 1`,
        [
          normalizedEmail,
          subject,
          message
        ]
      );

      if (duplicates.length > 0) {
        return res.status(200).json({
          success: true,
          reference:
            'MC-' + String(duplicates[0].id).padStart(6, '0'),
          message: 'Your message has already been received.'
        });
      }

      // --------------------------------------------------
      // 6. Save legitimate message
      // --------------------------------------------------

      const [result] = await pool.query(
        `INSERT INTO platform_contact_messages
         (name, email, category, subject, message, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          name,
          normalizedEmail,
          category,
          subject,
          message,
          'new'
        ]
      );

      // Only confirm success after MySQL accepts the record.
      return res.status(201).json({
        success: true,
        reference:
          'MC-' + String(result.insertId).padStart(6, '0')
      });

    } catch (error) {
      // Never expose SQL details or database credentials.
      console.error(
        '[Motivo Contact] Database error:',
        error.code || 'UNKNOWN_ERROR'
      );

      return res.status(503).json({
        error: 'Unable to receive your message right now. Please try again later.'
      });
    }
  }
);

module.exports = router;
