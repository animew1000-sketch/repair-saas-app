'use strict';
// MOT-030: Separate platform administration boundary. Never use shop user roles here.
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const PLATFORM_ORIGIN = 'https://bendhomeverserver.duckdns.org';
const COOKIE = 'motivo_platform_session';
const SESSION_MS = 60 * 60 * 1000;
const setupReady = () => process.env.PLATFORM_ADMIN_ENABLED === 'true' &&
  !!process.env.PLATFORM_ADMIN_EMAIL && !!process.env.PLATFORM_ADMIN_PASSWORD_HASH &&
  !!process.env.PLATFORM_ADMIN_TOTP_SECRET;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function safeLog(type, error) { console.error('[Platform] '+type+': '+(/^[A-Z0-9_]{1,60}$/.test(error?.code||'') ? error.code : 'UNEXPECTED_ERROR')); }
function base32Bytes(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = String(input || '').replace(/[ =-]/g,'').toUpperCase();
  if (!/^[A-Z2-7]{16,}$/.test(normalized)) return null;
  let bits=0, value=0; const out=[];
  for (const ch of normalized) { value=(value<<5)|alphabet.indexOf(ch); bits+=5; if(bits>=8){out.push((value >>> (bits-8))&255);bits-=8;} value &= (1<<bits)-1; }
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(counter));
  const digest=crypto.createHmac('sha1',secret).update(msg).digest();
  const offset=digest[digest.length-1]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
function validTotp(code) {
  if (!/^\d{6}$/.test(String(code||''))) return false;
  const key=base32Bytes(process.env.PLATFORM_ADMIN_TOTP_SECRET);
  if(!key) return false;
  const now=Math.floor(Date.now()/30000);
  const value=Buffer.from(code,'utf8');
  return [-1,0,1].some(delta=>crypto.timingSafeEqual(value,Buffer.from(totpAt(key,now+delta),'utf8')));
}
function requireOrigin(req,res,next) {
  const origin=req.get('origin');
  if (!origin) return res.status(403).json({error:'Origin required.'});
  try {
    const u=new URL(origin);
    if(u.origin!==PLATFORM_ORIGIN) return res.status(403).json({error:'Invalid origin.'});
  } catch {return res.status(403).json({error:'Invalid origin.'});}
  next();
}
function secureCookie(value) {
  return `${COOKIE}=${value}; Path=/api/platform; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS/1000}`;
}
function clearCookie(res) {res.setHeader('Set-Cookie',`${COOKIE}=; Path=/api/platform; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);}
function cookieValue(req) {
  const fragment=String(req.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
  return fragment ? fragment.slice(COOKIE.length+1) : null;
}
function unavailable(req,res,next) {if(!setupReady())return res.status(503).json({error:'Platform administration is not enabled.'});next();}
// Reject platform API access via the customer-facing domain even if misrouted.
router.use((req,res,next)=>{
  const host=String(req.get('host')||'').toLowerCase();
  if(host!=='bendhomeverserver.duckdns.org' && host!=='bendhomeverserver.duckdns.org:443')
    return res.status(404).send('Not found');
  next();
});
router.use(unavailable);
router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many attempts. Try again later.'}});
router.post('/login',requireOrigin,loginLimiter,async(req,res)=>{
  try {
    const email=String(req.body?.email||'').trim().toLowerCase();
    const password=req.body?.password;
    const code=req.body?.code;
    if(!email || typeof password!=='string'||password.length>256 || typeof code!=='string') return res.status(401).json({error:'Invalid credentials.'});
    // Always verify credentials on server; shop managers never qualify.
    const validEmail=email===String(process.env.PLATFORM_ADMIN_EMAIL).trim().toLowerCase();
    const validPassword=await bcrypt.compare(password,process.env.PLATFORM_ADMIN_PASSWORD_HASH);
    const validMfa=validTotp(code);
    if(!(validEmail&&validPassword&&validMfa))return res.status(401).json({error:'Invalid credentials.'});
    const raw=crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO platform_sessions (token_hash,admin_email,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sha(raw),email]);
    res.setHeader('Set-Cookie',secureCookie(raw));
    return res.json({success:true,email});
  }catch(err){safeLog('login',err);return res.status(503).json({error:'Platform login unavailable.'});}
});
async function authenticate(req,res,next){
  const token=cookieValue(req);
  if(!token || !/^[a-f0-9]{64}$/.test(token))return res.status(401).json({error:'Platform sign-in required.'});
  try{
    const [rows]=await pool.query('SELECT id,admin_email FROM platform_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() LIMIT 1',[sha(token)]);
    if(!rows.length){clearCookie(res);return res.status(401).json({error:'Session expired. Sign in again.'});}
    req.platformAdmin=rows[0];next();
  }catch(err){safeLog('session',err);res.status(503).json({error:'Platform session unavailable.'});}
}
router.use(authenticate);
router.get('/me',(req,res)=>res.json({email:req.platformAdmin.admin_email}));
router.post('/logout',requireOrigin,async(req,res)=>{
  try{await pool.query('UPDATE platform_sessions SET revoked_at=UTC_TIMESTAMP() WHERE id=?',[req.platformAdmin.id]);clearCookie(res);res.json({success:true});}
  catch(err){safeLog('logout',err);res.status(503).json({error:'Unable to sign out.'});}
});
router.get('/shops',async(req,res)=>{
  try{
    const [shops]=await pool.query(`SELECT c.id,c.company_name,c.slug,c.tagline,c.service_address,c.phone,c.primary_color,c.created_at,
      (SELECT COUNT(*) FROM users u WHERE u.company_id=c.id) AS accounts,
      (SELECT COUNT(*) FROM repair_jobs j WHERE j.company_id=c.id) AS jobs
      FROM companies c ORDER BY c.id DESC LIMIT 500`);
    res.json({shops});
  }catch(err){safeLog('list shops',err);res.status(503).json({error:'Unable to load shops.'});}
});
const textField=(v,max)=>typeof v==='string' && v.trim() && v.trim().length<=max ? v.trim():null;
router.post('/shops',requireOrigin,async(req,res)=>{
  const name=textField(req.body?.company_name,150),slug=textField(req.body?.slug,100);
  if(!name || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return res.status(400).json({error:'Enter a shop name and a lowercase URL slug (letters, numbers and hyphens).'});
  const address=req.body?.service_address===undefined ? null :textField(req.body.service_address,255);
  const phone=req.body?.phone===undefined?null:textField(req.body.phone,50);
  if((req.body?.service_address!==undefined&&!address)||(req.body?.phone!==undefined&&!phone))return res.status(400).json({error:'Invalid contact details.'});
  const cx=await pool.getConnection().catch(()=>null);
  if(!cx)return res.status(503).json({error:'Database unavailable.'});
  try{
    await cx.beginTransaction();
    const [result]=await cx.query(`INSERT INTO companies(company_name,slug,service_address,phone) VALUES(?,?,?,?)`,[name,slug,address||'Not configured',phone||'Not configured']);
    await cx.query('INSERT INTO platform_shop_audit (admin_email,action,company_id,details_json) VALUES(?,?,?,?)',[req.platformAdmin.admin_email,'shop_created',result.insertId,JSON.stringify({company_name:name,slug})]);
    await cx.commit();res.status(201).json({id:result.insertId,company_name:name,slug});
  }catch(err){try{await cx.rollback();}catch{}safeLog('create shop',err);res.status(err?.code==='ER_DUP_ENTRY'?409:503).json({error:err?.code==='ER_DUP_ENTRY'?'Shop slug already exists.':'Unable to create shop.'});}
  finally{cx.release();}
});
router.patch('/shops/:id',requireOrigin,async(req,res)=>{
  const id=Number(req.params.id),name=textField(req.body?.company_name,150),address=textField(req.body?.service_address,255),phone=textField(req.body?.phone,50);
  if(!Number.isSafeInteger(id)||id<1||!name||!address||!phone)return res.status(400).json({error:'Enter valid shop details.'});
  const cx=await pool.getConnection().catch(()=>null);
  if(!cx)return res.status(503).json({error:'Database unavailable.'});
  try{
    await cx.beginTransaction();
    const [result]=await cx.query('UPDATE companies SET company_name=?,service_address=?,phone=? WHERE id=?',[name,address,phone,id]);
    if(!result.affectedRows){await cx.rollback();return res.status(404).json({error:'Shop not found.'});}
    await cx.query('INSERT INTO platform_shop_audit (admin_email,action,company_id,details_json) VALUES(?,?,?,?)',[req.platformAdmin.admin_email,'shop_updated',id,JSON.stringify({company_name:name})]);
    await cx.commit();res.json({success:true});
  }catch(err){try{await cx.rollback();}catch{}safeLog('update shop',err);res.status(503).json({error:'Unable to update shop.'});}
  finally{cx.release();}
});
// NO DELETE ENDPOINT: company FK cascade can irreversibly destroy customer, invoice and repair records.
module.exports=router;
