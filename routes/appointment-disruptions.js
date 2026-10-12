'use strict';
// Manager-reviewed appointment rescheduling notices, per-shop and idempotent.
const express = require('express');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');
const { sendMail } = require('../services/mail');
const router = express.Router();
router.use(authenticateToken, (req,res,next) => req.user.role === 'manager' ? next() : res.status(403).json({error:'Manager access required.'}));
const validLocal = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d$/.test(x) && !Number.isNaN(Date.parse(x));
function validate(body) {
 const {kind,start_at,end_at,technician_id,reason}=body||{};
 if(!['closure','technician_absence'].includes(kind) || !validLocal(start_at) || !validLocal(end_at) || start_at>=end_at) return 'Provide an interruption type and valid start/end times.';
 if(kind==='technician_absence' && (!Number.isInteger(technician_id)||technician_id<=0)) return 'Select an affected technician.';
 if(typeof reason!=='string'||reason.trim().length<4||reason.length>200) return 'Provide a reason between 4 and 200 characters.';
 return null;
}
async function affected(req) {
 const {kind,technician_id,start_at,end_at}=req.body;
 const id=req.user.company_id;
 if(kind==='technician_absence') {
  const [staff]=await pool.query("SELECT id FROM users WHERE id=? AND company_id=? AND role='technician' LIMIT 1",[technician_id,id]);
  if(!staff.length) return {error:'Technician not found in your shop.'};
 }
 // Only future appointments whose start falls within the disruption. Existing appointment data stays unchanged.
 // Restrict staff absences to jobs assigned to that technician. Do not expose personal customer data in preview.
 const sql=`SELECT a.id AS appointment_id, a.scheduled_datetime,
   (SELECT c.email FROM customers c WHERE c.company_id=a.company_id AND c.repair_job_id=a.repair_job_id ORDER BY c.id DESC LIMIT 1) AS email,
   (SELECT c.first_name FROM customers c WHERE c.company_id=a.company_id AND c.repair_job_id=a.repair_job_id ORDER BY c.id DESC LIMIT 1) AS first_name,
   r.assigned_staff_id
  FROM appointments a
  INNER JOIN repair_jobs r ON r.id=a.repair_job_id AND r.company_id=a.company_id
  WHERE a.company_id=? AND a.scheduled_datetime >= ? AND a.scheduled_datetime < ?
    AND a.scheduled_datetime > NOW()
    ${kind==='technician_absence'?'AND r.assigned_staff_id=?':''}
  ORDER BY a.scheduled_datetime, a.id`;
 const params=[id,start_at.replace('T',' ')+':00',end_at.replace('T',' ')+':00'];
 if(kind==='technician_absence')params.push(technician_id);
 const [rows]=await pool.query(sql,params);
 return {rows};
}
router.post('/preview',async(req,res)=>{
 const err=validate(req.body);if(err)return res.status(400).json({error:err});
 try{const result=await affected(req);if(result.error)return res.status(404).json({error:result.error});
  return res.json({count:result.rows.length,with_email:result.rows.filter(x=>x.email).length,appointment_ids:result.rows.map(x=>x.appointment_id),requires_confirmation:true});
 }catch(e){console.error('Reschedule preview failed:',e.code||e.message);return res.status(503).json({error:'Unable to review affected appointments.'});}
});
router.post('/notify',async(req,res)=>{
 const err=validate(req.body);if(err)return res.status(400).json({error:err});
 if(req.body.confirm !== true)return res.status(400).json({error:'Explicit manager confirmation required.'});
 // Event key is stable across retries: same disruption type, time window, technician and reason.
 const crypto=require('crypto');
 const b=req.body;
 const reason=b.reason.trim();
 const eventKey=crypto.createHash('sha256').update(JSON.stringify([b.kind,b.start_at,b.end_at,b.kind==='technician_absence'?b.technician_id:null,reason])).digest('hex');
 try {
  const result=await affected(req);if(result.error)return res.status(404).json({error:result.error});
  const [shops]=await pool.query('SELECT company_name FROM companies WHERE id=? LIMIT 1',[req.user.company_id]);
  const shopName=shops[0]?.company_name||'Your repair shop';
  const report={affected:result.rows.length,sent:0,already_processed:0,failed:0,without_email:0};
  for(const row of result.rows){
   if(!row.email){report.without_email++;continue;}
   // One claim per appointment/event, including failures: prevents unintended repeated sends.
   const [claim]=await pool.query("INSERT IGNORE INTO shop_reschedule_notices (company_id,appointment_id,disruption_key,notice_reason,delivery_status) VALUES (?,?,?,?,'sending')",[req.user.company_id,row.appointment_id,eventKey,reason]);
   if(!claim.affectedRows){report.already_processed++;continue;}
   try{
    // No new time is promised; this is a request to coordinate rescheduling.
    await sendMail({to:row.email,fromName:shopName,subject:`${shopName}: appointment rescheduling needed`,text:`Hello ${row.first_name||'there'},\n\nWe need to reschedule your upcoming service appointment at ${shopName} because of an unexpected schedule change.\n\nPlease contact the shop to arrange a new time. Your previously selected time is not confirmed as a replacement.\n\nWe apologize for the inconvenience.\n\n${shopName}`});
    await pool.query("UPDATE shop_reschedule_notices SET delivery_status='sent',sent_at=UTC_TIMESTAMP() WHERE id=? AND company_id=?",[claim.insertId,req.user.company_id]);report.sent++;
   }catch(e){
    console.error('Reschedule email delivery failed:',e.code||e.message);
    await pool.query("UPDATE shop_reschedule_notices SET delivery_status='failed',error_code=? WHERE id=? AND company_id=?",[String(e.code||'SMTP_ERROR').slice(0,80),claim.insertId,req.user.company_id]);report.failed++;
   }
  }
  return res.json({success:report.failed===0, ...report,warning:'Existing appointment records were not cancelled or reassigned. Review affected appointments and follow up with customers who were not emailed.'});
 }catch(e){console.error('Rescheduling notification error:',e.code||e.message);return res.status(503).json({error:'Unable to complete the notification review.'});}
});
module.exports=router;
