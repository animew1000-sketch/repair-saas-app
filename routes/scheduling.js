'use strict';
const express = require('express');
const pool = require('../db/pool');
const {authenticateToken} = require('../middleware/auth');
const router = express.Router();
router.use(authenticateToken, (req,res,next) => ['manager', 'service_advisor'].includes(req.user.role) ? next() : res.status(403).json({error:'Manager or service advisor access required.'}));
const company = req => req.user.company_id;
const isClock = x => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
const isDateTime = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d$/.test(x) && !Number.isNaN(Date.parse(x));
const fail = (res,error) => res.status(400).json({error});
const databaseError = (res,err) => {console.error('Scheduling settings database error:',err.code||err.message);return res.status(503).json({error:'Scheduling settings temporarily unavailable.'});};
const defaultHours = Array.from({length:7},(_,weekday)=>({weekday,is_open:weekday>=1&&weekday<=5,opens_at:weekday>=1&&weekday<=5?'08:00':null,closes_at:weekday>=1&&weekday<=5?'17:00':null}));
router.get('/config',async(req,res)=>{
 try{
  const id=company(req);
  const [[settings],[hours],[bays],[shifts],[closures],[techs]]=await Promise.all([
   pool.query('SELECT timezone,confirmation_policy,slot_minutes FROM shop_schedule_settings WHERE company_id=?',[id]),
   pool.query('SELECT weekday,is_open,TIME_FORMAT(opens_at,\'%H:%i\') opens_at,TIME_FORMAT(closes_at,\'%H:%i\') closes_at FROM shop_business_hours WHERE company_id=? ORDER BY weekday',[id]),
   pool.query('SELECT id,name,is_active FROM shop_service_bays WHERE company_id=? ORDER BY name',[id]),
   pool.query('SELECT id,technician_id,weekday,TIME_FORMAT(starts_at,\'%H:%i\') starts_at,TIME_FORMAT(ends_at,\'%H:%i\') ends_at,is_active FROM shop_technician_shifts WHERE company_id=? ORDER BY technician_id,weekday,starts_at',[id]),
   pool.query('SELECT id,DATE_FORMAT(start_at,\'%Y-%m-%dT%H:%i\') start_at,DATE_FORMAT(end_at,\'%Y-%m-%dT%H:%i\') end_at,reason FROM shop_schedule_closures WHERE company_id=? ORDER BY start_at DESC LIMIT 100',[id]),
   pool.query("SELECT id,username FROM users WHERE company_id=? AND role='technician' ORDER BY username",[id])
  ]);
  res.json({settings:settings[0]||{timezone:'America/Los_Angeles',confirmation_policy:'manager_approval',slot_minutes:30},hours:hours.length?hours:defaultHours,bays,shifts,closures,technicians:techs,phase:'configuration_only',booking_enforced:false});
 }catch(e){databaseError(res,e)}
});
router.put('/config',async(req,res)=>{
 const {timezone,confirmation_policy,slot_minutes,hours}=req.body||{};
 if(typeof timezone!=='string'||timezone.length>64) return fail(res,'Invalid timezone.');
 try{new Intl.DateTimeFormat('en-US',{timeZone:timezone})}catch{return fail(res,'Unknown IANA timezone.')}
 if(!['manager_approval','automatic'].includes(confirmation_policy))return fail(res,'Invalid confirmation policy.');
 if(![15,30,60].includes(slot_minutes))return fail(res,'Select 15, 30, or 60 minute slots.');
 if(!Array.isArray(hours)||hours.length!==7||new Set(hours.map(h=>h.weekday)).size!==7)return fail(res,'Provide all seven weekdays.');
 for(const h of hours){if(!Number.isInteger(h.weekday)||h.weekday<0||h.weekday>6||typeof h.is_open!=='boolean')return fail(res,'Invalid weekday.');if(h.is_open&&(!isClock(h.opens_at)||!isClock(h.closes_at)||h.opens_at>=h.closes_at))return fail(res,'Opening hours must be valid and end after opening.');}
 // Saving policy does not activate auto-booking. Existing appointment endpoint unchanged.
 const cx=await pool.getConnection();
 try{await cx.beginTransaction();const id=company(req);
  await cx.query('INSERT INTO shop_schedule_settings (company_id,timezone,confirmation_policy,slot_minutes) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE timezone=VALUES(timezone),confirmation_policy=VALUES(confirmation_policy),slot_minutes=VALUES(slot_minutes)',[id,timezone,confirmation_policy,slot_minutes]);
  for(const h of hours)await cx.query('INSERT INTO shop_business_hours(company_id,weekday,is_open,opens_at,closes_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE is_open=VALUES(is_open),opens_at=VALUES(opens_at),closes_at=VALUES(closes_at)',[id,h.weekday,h.is_open?1:0,h.is_open?h.opens_at:null,h.is_open?h.closes_at:null]);
  await cx.commit();res.json({success:true,booking_enforced:false});
 }catch(e){await cx.rollback();databaseError(res,e)}finally{cx.release()}
});
router.post('/bays',async(req,res)=>{
 const name=String(req.body?.name||'').trim();if(!name||name.length>80)return fail(res,'Bay name must be 1 to 80 characters.');
 try{const [r]=await pool.query('INSERT INTO shop_service_bays(company_id,name) VALUES(?,?)',[company(req),name]);res.status(201).json({id:r.insertId,name,is_active:1})}catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Bay name already exists.'});databaseError(res,e)}
});
router.patch('/bays/:id',async(req,res)=>{
 if(!['boolean'].includes(typeof req.body?.is_active))return fail(res,'is_active must be boolean.');
 try{const [r]=await pool.query('UPDATE shop_service_bays SET is_active=? WHERE id=? AND company_id=?',[req.body.is_active?1:0,req.params.id,company(req)]);res.status(r.affectedRows?200:404).json(r.affectedRows?{success:true}:{error:'Bay not found.'})}catch(e){databaseError(res,e)}
});
router.post('/closures',async(req,res)=>{
 const {start_at,end_at,reason}=req.body||{};
 if(!isDateTime(start_at)||!isDateTime(end_at)||start_at>=end_at||typeof reason!=='string'||!reason.trim()||reason.length>160)return fail(res,'Invalid closure dates or reason.');
 try{const [r]=await pool.query('INSERT INTO shop_schedule_closures (company_id,start_at,end_at,reason) VALUES(?,?,?,?)',[company(req),start_at.replace('T',' ')+':00',end_at.replace('T',' ')+':00',reason.trim()]);res.status(201).json({id:r.insertId})}catch(e){databaseError(res,e)}
});
router.delete('/closures/:id',async(req,res)=>{try{const [r]=await pool.query('DELETE FROM shop_schedule_closures WHERE id=? AND company_id=?',[req.params.id,company(req)]);res.status(r.affectedRows?200:404).json(r.affectedRows?{success:true}:{error:'Closure not found.'})}catch(e){databaseError(res,e)}});
router.post('/shifts',async(req,res)=>{
 const {technician_id,weekday,starts_at,ends_at}=req.body||{};
 if(!Number.isInteger(technician_id)||!Number.isInteger(weekday)||weekday<0||weekday>6||!isClock(starts_at)||!isClock(ends_at)||starts_at>=ends_at)return fail(res,'Invalid shift.');
 try{const [staff]=await pool.query("SELECT id FROM users WHERE id=? AND company_id=? AND role='technician' LIMIT 1",[technician_id,company(req)]);if(!staff.length)return res.status(404).json({error:'Technician not found in this shop.'});
 const [overlap]=await pool.query('SELECT id FROM shop_technician_shifts WHERE company_id=? AND technician_id=? AND weekday=? AND is_active=1 AND starts_at < ? AND ends_at > ? LIMIT 1',[company(req),technician_id,weekday,ends_at,starts_at]);if(overlap.length)return res.status(409).json({error:'Overlapping shift already exists.'});
 const [r]=await pool.query('INSERT INTO shop_technician_shifts(company_id,technician_id,weekday,starts_at,ends_at) VALUES(?,?,?,?,?)',[company(req),technician_id,weekday,starts_at,ends_at]);res.status(201).json({id:r.insertId});
 }catch(e){databaseError(res,e)}
});
router.delete('/shifts/:id',async(req,res)=>{try{const [r]=await pool.query('DELETE FROM shop_technician_shifts WHERE id=? AND company_id=?',[req.params.id,company(req)]);res.status(r.affectedRows?200:404).json(r.affectedRows?{success:true}:{error:'Shift not found.'})}catch(e){databaseError(res,e)}});
module.exports=router;
