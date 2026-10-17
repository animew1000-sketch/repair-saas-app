'use strict';
// MOT-030. Mount AFTER /api/platform and BEFORE all ordinary /api routes.
// Fail closed for authenticated shop requests if lifecycle state cannot be verified.
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { URL } = require('url');
const query = async id => {
  const [rows] = await pool.query(`SELECT COALESCE(l.status,'active') AS status FROM companies c
    LEFT JOIN platform_shop_lifecycle l ON l.company_id=c.id WHERE c.id=? LIMIT 1`,[id]);
  return rows[0]?.status || null;
};
module.exports = async function platformStatusGate(req,res,next) {
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/platform/')) return next();
  const login = req.path === '/api/login';
  const register = req.path === '/api/register';
  try {
    // Explicitly selected company cannot log in or register while suspended.
    if (login || register) {
      const id=Number(req.body?.company_id);
      if (Number.isSafeInteger(id) && id>0) {
        const state=await query(id);
        if(state && state!=='active') return res.status(403).json({code:'SHOP_UNAVAILABLE',error:'This repair shop is currently unavailable.'});
      }
      return next();
    }
    // All signed-in shop API requests, including those issued with a previously valid JWT,
    // are denied as soon as a tenant transitions away from active.
    const bearer=/^Bearer\s+(\S+)$/i.exec(String(req.get('authorization')||''));
    if (bearer) {
      let identity;
      try {identity=jwt.verify(bearer[1],process.env.JWT_SECRET,{algorithms:['HS256']});}
      catch { return next(); } // Existing auth middleware owns invalid/expired token responses.
      if(Number.isSafeInteger(identity.company_id)&&identity.company_id>0) {
        const state=await query(identity.company_id);
        if(state!=='active') return res.status(403).json({code:'SHOP_UNAVAILABLE',error:'This repair shop is currently unavailable.'});
      }
    }
    return next();
  }catch(e){console.error('[Platform lifecycle gate]',/^[A-Z0-9_]+$/.test(e?.code||'')?e.code:'UNEXPECTED_ERROR');return res.status(503).json({error:'Unable to verify shop availability.'});}
};
