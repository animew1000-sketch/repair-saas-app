'use strict';
// Public contact submissions. No shop data or developer credentials exposed.
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const router = express.Router();
const limiter = rateLimit({ windowMs: 60*60*1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: {error: 'Too many messages. Try again later.'} });
const clean = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
const categories = new Set(['general','onboarding','technical','billing','feedback','other']);
router.post('/', limiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.get('origin');
  // Browser form submits are same-origin; reject cross-site script submissions.
  if (origin) {
    try { const o = new URL(origin); const h = req.get('host'); if (o.host !== h || o.protocol !== 'https:' && process.env.NODE_ENV === 'production') return res.status(403).json({error:'Origin not allowed.'}); }
    catch { return res.status(403).json({error:'Origin not allowed.'}); }
  }
  if (req.body?.website) return res.status(202).json({success:true}); // honeypot
  const name = clean(req.body?.name,120), email = clean(req.body?.email,254), subject = clean(req.body?.subject,160), message = clean(req.body?.message,5000), category = req.body?.category;
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || !message || !categories.has(category)) return res.status(400).json({error:'Complete all required fields with valid information.'});
  if (req.body?.privacy_ack !== true) return res.status(400).json({error:'Please acknowledge the privacy notice.'});
  try {
    const [result] = await pool.query('INSERT INTO platform_contact_messages (name,email,category,subject,message,status) VALUES (?,?,?,?,?,?)',[name,email.toLowerCase(),category,subject,message,'new']);
    res.status(201).json({success:true,reference:'MC-'+String(result.insertId).padStart(6,'0')});
  } catch(err) { console.error('Contact message storage failed:', err.code || 'DATABASE_ERROR'); res.status(503).json({error:'Unable to receive your message right now. Please try again later.'}); }
});
module.exports = router;
