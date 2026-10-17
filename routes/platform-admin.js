'use strict';
// MOT-030 v2: separate platform administration. No shop role qualifies.
const express=require('express');
const bcrypt=require('bcrypt');
const crypto=require('crypto');
const pool=require('../db/pool');
const rateLimit=require('express-rate-limit');
const router=express.Router();
const ORIGIN='https://bendhomeverserver.duckdns.org';
const COOKIE='motivo_platform_session';
const SESSION_MS=3600000;
const ready=()=>process.env.PLATFORM_ADMIN_ENABLED==='true'&&!!process.env.PLATFORM_ADMIN_EMAIL&&!!process.env.PLATFORM_ADMIN_PASSWORD_HASH&&!!process.env.PLATFORM_ADMIN_TOTP_SECRET;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const safeLog=(what,err)=>console.error('[Platform] '+what+': '+(/^[A-Z0-9_]{1,60}$/.test(err?.code||'')?err.code:'UNEXPECTED_ERROR'));
function base32(input){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';const s=String(input||'').replace(/[ =-]/g,'').toUpperCase();if(!/^[A-Z2-7]{16,}$/.test(s))return null;let bits=0,value=0;const out=[];for(const ch of s){value=(value<<5)|alphabet.indexOf(ch);bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}value&=(1<<bits)-1;}return Buffer.from(out);}
function totpAt(secret,counter){const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(counter));const digest=crypto.createHmac('sha1',secret).update(msg).digest(),offset=digest[digest.length-1]&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
function validTotp(code){if(!/^\d{6}$/.test(String(code||'')))return false;const key=base32(process.env.PLATFORM_ADMIN_TOTP_SECRET);if(!key)return false;const n=Math.floor(Date.now()/30000),value=Buffer.from(code,'utf8');return [-1,0,1].some(delta=>crypto.timingSafeEqual(value,Buffer.from(totpAt(key,n+delta),'utf8')));}
function originOnly(req,res,next){if(req.get('origin')!==ORIGIN)return res.status(403).json({error:'Origin not allowed.'});next();}
function cookie(raw){return `${COOKIE}=${raw}; Path=/api/platform; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`;}
function clearCookie(res){res.setHeader('Set-Cookie',`${COOKIE}=; Path=/api/platform; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);}
function readCookie(req){const hit=String(req.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='));return hit?hit.slice(COOKIE.length+1):null;}
router.use((req,res,next)=>{const host=String(req.get('host')||'').toLowerCase();if(host!=='bendhomeverserver.duckdns.org'&&host!=='bendhomeverserver.duckdns.org:443')return res.status(404).send('Not found');res.set('Cache-Control','no-store');next();});
router.use((req,res,next)=>ready()?next():res.status(503).json({error:'Platform administration is not enabled.'}));
const limiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many attempts. Try again later.'}});
router.post('/login',originOnly,limiter,async(req,res)=>{try{const email=String(req.body?.email||'').trim().toLowerCase(),password=req.body?.password,code=req.body?.code;if(!email||typeof password!=='string'||password.length>256||typeof code!=='string')return res.status(401).json({error:'Invalid credentials.'});const okEmail=email===String(process.env.PLATFORM_ADMIN_EMAIL).trim().toLowerCase();const okPass=await bcrypt.compare(password,process.env.PLATFORM_ADMIN_PASSWORD_HASH);const okMfa=validTotp(code);if(!(okEmail&&okPass&&okMfa))return res.status(401).json({error:'Invalid credentials.'});const raw=crypto.randomBytes(32).toString('hex');await pool.query('INSERT INTO platform_sessions(token_hash,admin_email,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[sha(raw),email]);res.setHeader('Set-Cookie',cookie(raw));return res.json({success:true,email});}catch(e){safeLog('login',e);return res.status(503).json({error:'Platform login unavailable.'});}});
async function authenticated(req,res,next){const token=readCookie(req);if(!token||!/^[a-f0-9]{64}$/.test(token))return res.status(401).json({error:'Platform sign-in required.'});try{const [r]=await pool.query('SELECT id,admin_email FROM platform_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP() LIMIT 1',[sha(token)]);if(!r.length){clearCookie(res);return res.status(401).json({error:'Session expired. Sign in again.'});}req.platformAdmin=r[0];next();}catch(e){safeLog('session',e);res.status(503).json({error:'Platform session unavailable.'});}}
router.use(authenticated);
router.get('/me',(req,res)=>res.json({email:req.platformAdmin.admin_email}));
router.post('/logout',originOnly,async(req,res)=>{try{await pool.query('UPDATE platform_sessions SET revoked_at=UTC_TIMESTAMP() WHERE id=?',[req.platformAdmin.id]);clearCookie(res);res.json({success:true});}catch(e){safeLog('logout',e);res.status(503).json({error:'Unable to sign out.'});}});
const FIELDS=`c.id,c.company_name,c.slug,c.tagline,c.service_address,c.phone,c.primary_color,c.created_at,
COALESCE(l.status,'active') AS status,l.status_reason,l.changed_at,
(SELECT COUNT(*) FROM users u WHERE u.company_id=c.id) AS accounts,
(SELECT COUNT(*) FROM repair_jobs j WHERE j.company_id=c.id) AS jobs,
(SELECT COUNT(*) FROM appointments a WHERE a.company_id=c.id) AS appointments`;
const JOIN='FROM companies c LEFT JOIN platform_shop_lifecycle l ON l.company_id=c.id';
router.get('/shops',async(req,res)=>{try{const [shops]=await pool.query('SELECT '+FIELDS+' '+JOIN+' ORDER BY c.id DESC LIMIT 1000');res.json({shops,limited:shops.length===1000});}catch(e){safeLog('shops',e);res.status(503).json({error:'Unable to load shop directory. Ensure the lifecycle migration has run.'});}});
router.get('/overview',async(req,res)=>{try{const [[counts]]=await pool.query(`SELECT COUNT(*) AS total,
SUM(CASE WHEN COALESCE(l.status,'active')='active' THEN 1 ELSE 0 END) AS active,
SUM(CASE WHEN l.status='paused' THEN 1 ELSE 0 END) AS paused,
SUM(CASE WHEN l.status='archived' THEN 1 ELSE 0 END) AS archived
${JOIN}`);
const [[accounts]]=await pool.query('SELECT COUNT(*) AS n FROM users');const [[jobs]]=await pool.query('SELECT COUNT(*) AS n FROM repair_jobs');const [[appointments]]=await pool.query('SELECT COUNT(*) AS n FROM appointments');
const [growth]=await pool.query("SELECT DATE_FORMAT(created_at,'%Y-%m') AS month,COUNT(*) AS total FROM companies WHERE created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 11 MONTH) GROUP BY DATE_FORMAT(created_at,'%Y-%m') ORDER BY month");
const [activity]=await pool.query('SELECT a.id,a.admin_email,a.action,a.company_id,a.created_at,c.company_name FROM platform_shop_audit a LEFT JOIN companies c ON c.id=a.company_id ORDER BY a.id DESC LIMIT 12');
res.json({counts:{total:Number(counts.total||0),active:Number(counts.active||0),paused:Number(counts.paused||0),archived:Number(counts.archived||0),accounts:Number(accounts.n||0),jobs:Number(jobs.n||0),appointments:Number(appointments.n||0)},growth,activity});}catch(e){safeLog('overview',e);res.status(503).json({error:'Unable to load platform overview.'});}});
const text=(v,max)=>typeof v==='string'&&!!v.trim()&&v.trim().length<=max?v.trim():null;
const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
async function txRun(work){const cx=await pool.getConnection();try{await cx.beginTransaction();const result=await work(cx);await cx.commit();return result;}catch(e){await cx.rollback().catch(()=>{});throw e;}finally{cx.release();}}
async function audit(cx,email,action,id,details){await cx.query('INSERT INTO platform_shop_audit(admin_email,action,company_id,details_json) VALUES(?,?,?,?)',[email,action,id,JSON.stringify(details)]);}
router.post('/shops',originOnly,async(req,res)=>{const name=text(req.body?.company_name,150),slug=text(req.body?.slug,100),address=text(req.body?.service_address,255),phone=text(req.body?.phone,50);if(!name||!slug||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||!address||!phone)return res.status(400).json({error:'Provide shop name, lowercase slug, address, and phone.'});try{const result=await txRun(async cx=>{const [r]=await cx.query('INSERT INTO companies(company_name,slug,service_address,phone) VALUES(?,?,?,?)',[name,slug,address,phone]);await audit(cx,req.platformAdmin.admin_email,'shop_created',r.insertId,{company_name:name,slug});return r;});res.status(201).json({id:result.insertId,company_name:name,slug});}catch(e){safeLog('create shop',e);res.status(e?.code==='ER_DUP_ENTRY'?409:503).json({error:e?.code==='ER_DUP_ENTRY'?'Shop slug already exists.':'Unable to create shop.'});}});
router.patch('/shops/:id',originOnly,async(req,res)=>{const id=validId(req.params.id),name=text(req.body?.company_name,150),address=text(req.body?.service_address,255),phone=text(req.body?.phone,50);if(!id||!name||!address||!phone)return res.status(400).json({error:'Enter valid shop details.'});try{const found=await txRun(async cx=>{const [rows]=await cx.query('SELECT id FROM companies WHERE id=? FOR UPDATE',[id]);if(!rows.length)return false;await cx.query('UPDATE companies SET company_name=?,service_address=?,phone=? WHERE id=?',[name,address,phone,id]);await audit(cx,req.platformAdmin.admin_email,'shop_updated',id,{company_name:name});return true;});if(!found)return res.status(404).json({error:'Shop not found.'});res.json({success:true});}catch(e){safeLog('edit shop',e);res.status(503).json({error:'Unable to update shop.'});}});
router.get('/shops/:id',async(req,res)=>{const id=validId(req.params.id);if(!id)return res.status(400).json({error:'Invalid shop.'});try{const [rows]=await pool.query('SELECT '+FIELDS+' '+JOIN+' WHERE c.id=? LIMIT 1',[id]);if(!rows.length)return res.status(404).json({error:'Shop not found.'});const [history]=await pool.query('SELECT action,created_at,admin_email,details_json FROM platform_shop_audit WHERE company_id=? ORDER BY id DESC LIMIT 15',[id]);res.json({shop:rows[0],history});}catch(e){safeLog('shop details',e);res.status(503).json({error:'Unable to load shop overview.'});}});
router.post('/shops/:id/status',originOnly,async(req,res)=>{
 const id=validId(req.params.id),status=req.body?.status,reason=text(req.body?.reason,500),confirmation=req.body?.confirmation;
 if(!id||!['active','paused','archived'].includes(status))return res.status(400).json({error:'Invalid shop or status.'});
 if(status!=='active'&&!reason)return res.status(400).json({error:'A reason is required to pause or archive a shop.'});
 try{const result=await txRun(async cx=>{
   const [rows]=await cx.query(`SELECT c.id,c.slug,COALESCE(l.status,'active') AS status
   FROM companies c LEFT JOIN platform_shop_lifecycle l ON l.company_id=c.id WHERE c.id=? FOR UPDATE`,[id]);
   if(!rows.length)return {missing:true};const old=rows[0].status;
   if(old===status)return {unchanged:true,status};
   if(status==='archived' && (old!=='paused'||confirmation!==rows[0].slug))return {invalid:true};
   await cx.query(`INSERT INTO platform_shop_lifecycle(company_id,status,status_reason,changed_by,changed_at)
   VALUES(?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE status=VALUES(status),status_reason=VALUES(status_reason),changed_by=VALUES(changed_by),changed_at=UTC_TIMESTAMP()`,
   [id,status,reason||null,req.platformAdmin.admin_email]);
   await audit(cx,req.platformAdmin.admin_email,'shop_'+status,id,{previous_status:old,new_status:status,reason:reason||null});return {status};
 });
 if(result.missing)return res.status(404).json({error:'Shop not found.'});
 if(result.invalid)return res.status(409).json({error:'Archive requires a paused shop and exact shop slug confirmation.'});
 return res.json({success:true,...result});
 }catch(e){safeLog('shop status',e);res.status(503).json({error:'Unable to change shop status.'});}
});
// No delete endpoint: existing company foreign keys cascade to customer/repair data.
module.exports=router;
