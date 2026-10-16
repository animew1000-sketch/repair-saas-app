'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { sendMail } = require('../services/mail');
const { createSession, readSession, revokeCookieSession, clearCookie, csrfGuard, issueAccess } = require('../services/session');
const router = express.Router();

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set.');

// NEVER log MySQL Error objects: mysql2 may attach the entire interpolated SQL,
// including plaintext registration data and bcrypt password hashes.
function safeLog(action, err) {
  const knownCode = typeof err?.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(err.code);
  console.error(`[Auth] ${action}: ${knownCode ? err.code : 'UNEXPECTED_ERROR'}`);
}
const isHash = v => typeof v === 'string' && /^\$2[aby]\$/.test(v);
const shopId = v => Number.isSafeInteger(Number(v)) && Number(v) > 0 && String(v ?? '').trim() !== '' ? Number(v) : null;
const hasText = (v, max) => typeof v === 'string' && !!v.trim() && v.trim().length <= max;
const validEmail = v => hasText(v, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

router.post('/register', async (req, res) => {
  const {company_id, username, email, password, first_name, last_name, phone} = req.body || {};
  const company = shopId(company_id);
  if (!company || !hasText(username, 100) || !validEmail(email) ||
      typeof password !== 'string' || password.length < 8 || password.length > 128 ||
      !hasText(first_name, 100) || !hasText(last_name, 100) || !hasText(phone, 50)) {
    return res.status(400).json({error:'Please enter valid account details. Passwords must be 8–128 characters.'});
  }
  const clean = {username: username.trim(),email:email.trim(),first_name:first_name.trim(),last_name:last_name.trim(),phone:phone.trim()};
  let cx, committed=false;
  try {
    const [shops] = await pool.query('SELECT id, company_name FROM companies WHERE id=? LIMIT 1',[company]);
    if (!shops.length) return res.status(400).json({error:'Select a valid repair shop.'});
    const passwordHash = await bcrypt.hash(password,10);
    cx = await pool.getConnection();
    await cx.beginTransaction();
    // Keep the existing schema and registration journey intact.
    const jobNum = `JOB-${Date.now().toString().slice(-6)}`;
    const [job] = await cx.query('INSERT INTO repair_jobs(company_id,job_number,status) VALUES(?,?,?)',[company,jobNum,'Requested']);
    await cx.query('INSERT INTO customers(company_id,repair_job_id,first_name,last_name,phone,email) VALUES(?,?,?,?,?,?)',
      [company,job.insertId,clean.first_name,clean.last_name,clean.phone,clean.email]);
    await cx.query('INSERT INTO users(company_id,username,email,password,role,customer_id) VALUES(?,?,?,?,?,?)',
      [company,clean.username,clean.email,passwordHash,'customer',job.insertId]);
    await cx.commit();committed=true;
    // A failed welcome email must never undo a completed signup.
    const companyName=shops[0].company_name||'Your Repair Shop';
    try {
      await sendMail({to:clean.email,fromName:companyName,subject:`Welcome to ${companyName}`,
        text:`Hi ${clean.first_name},\n\nYour customer account for ${companyName} has been created successfully.\n\nUsername: ${clean.username}\n\nYou can now log in to view your repair information, appointments, and invoices.\n\nThank you,\n${companyName}`});
    } catch(err) { safeLog('welcome email',err); }
    return res.json({success:true,message:'Account created successfully! You can now log in.'});
  } catch(err) {
    if (cx && !committed) try { await cx.rollback(); } catch(rollbackErr) {safeLog('registration rollback',rollbackErr);}
    safeLog('registration',err);
    if(err?.code==='ER_DUP_ENTRY') return res.status(409).json({error:'An account with that username or email already exists for this shop.'});
    return res.status(500).json({error:'Unable to create your account right now. Please try again.'});
  } finally { if(cx) cx.release(); }
});

router.post('/login', async(req,res)=>{
  const {company_id,login_input,password}=req.body||{};
  const input=String(login_input||'').trim();
  const company = company_id === null || company_id === undefined || String(company_id).trim()==='' ? null : shopId(company_id);
  if(!input) return res.status(400).json({error:'Please enter your email, username, or staff PIN.'});
  if(company_id != null && String(company_id).trim()!=='' && !company) return res.status(400).json({error:'Invalid repair shop.'});
  try {
    let user=null;
    if(/^\d{6}$/.test(input)) {
      const sql=`SELECT u.*,c.company_name,c.primary_color FROM users u JOIN companies c ON u.company_id=c.id WHERE u.role<>'customer' ${company?'AND u.company_id=?':''}`;
      const [staff]=await pool.query(sql,company?[company]:[]);
      for(const account of staff){
        const stored=String(account.pin_code||'');if(!stored)continue;
        const match=isHash(stored)?await bcrypt.compare(input,stored):input===stored;
        if(!match)continue;
        if(!isHash(stored)){
          const hashed=await bcrypt.hash(input,10);
          await pool.query('UPDATE users SET pin_code=? WHERE id=? AND company_id=?',[hashed,account.id,account.company_id]);
        }
        user=account;break;
      }
    }
    if(!user){
      const sql=`SELECT u.*,c.company_name,c.primary_color FROM users u JOIN companies c ON u.company_id=c.id WHERE (u.email=? OR u.username=?) ${company?'AND u.company_id=?':''} LIMIT 1`;
      const [rows]=await pool.query(sql,company?[input,input,company]:[input,input]);
      if(rows.length){
        const account=rows[0];
        if(!password)return res.status(401).json({error:'Password is required for customer login.'});
        const stored=String(account.password||'');
        const matches=isHash(stored)?await bcrypt.compare(password,stored):password===stored;
        if(matches){
          if(!isHash(stored)){
            const hashed=await bcrypt.hash(password,10);
            await pool.query('UPDATE users SET password=? WHERE id=? AND company_id=?',[hashed,account.id,account.company_id]);
          }
          user=account;
        }
      }
    }
    if(!user)return res.status(401).json({error:'Invalid credentials for the selected shop.'});
    const token=await createSession(user,res);
    return res.json({token,user_id:user.id,company_id:user.company_id,company_name:user.company_name,
      primary_color:user.primary_color||'#f97316',role:user.role,username:user.username,email:user.email,customer_id:user.customer_id});
  }catch(err){safeLog('login',err);return res.status(500).json({error:'Unable to log in right now. Please try again.'});}
});

router.post('/session/renew',csrfGuard,async(req,res)=>{
  try{
    const session=await readSession(req);
    if(!session){clearCookie(res);return res.status(401).json({code:'SESSION_EXPIRED',error:'Session expired. Please sign in again.'});}
    const [users]=await pool.query(`SELECT u.id,u.company_id,u.username,u.email,u.role,u.customer_id,c.company_name,c.primary_color FROM users u JOIN companies c ON c.id=u.company_id WHERE u.id=? AND u.company_id=? LIMIT 1`,[session.user_id,session.company_id]);
    if(!users.length){await revokeCookieSession(req,res);return res.status(401).json({code:'SESSION_EXPIRED',error:'Account unavailable. Sign in again.'});}
    return res.json({token:issueAccess(users[0],session.id),expires_in:600});
  }catch(err){safeLog('session renewal',err);return res.status(503).json({error:'Unable to renew session right now.'});}
});
router.post('/session/activity',csrfGuard,async(req,res)=>{
  try{
    const session=await readSession(req);
    if(!session){clearCookie(res);return res.status(401).json({code:'SESSION_EXPIRED',error:'Session expired.'});}
    await pool.query('UPDATE auth_sessions SET last_activity_at=UTC_TIMESTAMP() WHERE id=? AND revoked_at IS NULL',[session.id]);
    return res.json({success:true});
  }catch(err){safeLog('session activity',err);return res.status(503).json({error:'Session tracking temporarily unavailable.'});}
});
router.post('/session/logout',csrfGuard,async(req,res)=>{
  try{await revokeCookieSession(req,res);return res.json({success:true});}
  catch(err){safeLog('session logout',err);return res.status(503).json({error:'Unable to revoke session.'});}
});
module.exports=router;
