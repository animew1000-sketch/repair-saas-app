'use strict';
// MOT-028 Phase 2: customer request intake and technician-capacity appointment booking.
const express=require('express');
const pool=require('../db/pool');
const {authenticateToken}=require('../middleware/auth');
const {getResolved}=require('../services/permissions');
const {sendMail}=require('../services/mail');
const router=express.Router();
router.use(authenticateToken);
const error=(res,code,message)=>res.status(code).json({error:message});
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const validTime=s=>typeof s==='string'&&/^([01]\d|2[0-3]):(00|15|30|45)$/.test(s);
const localNow=tz=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).reduce((v,p)=>{v[p.type]=p.value;return v;},{});
const weekday=date=>new Date(date+'T12:00:00Z').getUTCDay();
async function canSchedule(req,res,next){try{if(req.user.role==='customer')return error(res,403,'Staff access required.');const p=await getResolved(req.user.company_id,req.user.id,req.user.role);if(!p['scheduling.manage'])return error(res,403,'Scheduling permission required.');next();}catch(e){console.error('MOT028 authorization:',e.code||e.message);error(res,503,'Scheduling temporarily unavailable.');}}

// New intake intercepts legacy /api/customer/request-appointment route before old handler.
router.post('/customer/request-appointment',async(req,res)=>{
 if(req.user.role!=='customer')return error(res,403,'Customer account required.');
 const company=req.user.company_id,job=Number(req.user.customer_id);
 const {vin,make,model,year,issue_description,preferred_date,preferred_time}=req.body||{};
 if(!validDate(preferred_date)||!validTime(preferred_time))return error(res,400,'Select an available preferred 15-minute appointment time.');
 if(!Number.isSafeInteger(job)||job<=0)return error(res,400,'Customer repair record unavailable.');
 if(typeof vin!=='string'||!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.trim()))return error(res,400,'Enter a valid 17-character VIN.');
 if(typeof make!=='string'||!make.trim()||make.length>100||typeof model!=='string'||!model.trim()||model.length>100)return error(res,400,'Enter your vehicle make and model.');
 if(!Number.isInteger(Number(year))||Number(year)<1886||Number(year)>new Date().getFullYear()+2)return error(res,400,'Enter a valid vehicle year.');
 if(typeof issue_description!=='string'||!issue_description.trim()||issue_description.length>5000)return error(res,400,'Describe the service you need (up to 5000 characters).');
 let cx;
 try{
  cx=await pool.getConnection();await cx.beginTransaction();
  const [[owned]]=await cx.query('SELECT id FROM repair_jobs WHERE id=? AND company_id=? FOR UPDATE',[job,company]);
  if(!owned){await cx.rollback();return error(res,404,'Repair record not found in your shop.');}
  const [[pending]]=await cx.query("SELECT id FROM appointments WHERE company_id=? AND repair_job_id=? AND booking_status IN ('requested','proposed') AND scheduled_datetime IS NULL LIMIT 1",[company,job]);
  if(pending){await cx.rollback();return error(res,409,'You already have a request awaiting scheduling.');}
  await cx.query(`INSERT INTO vehicles(company_id,repair_job_id,vin,make,model,year) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE vin=VALUES(vin),make=VALUES(make),model=VALUES(model),year=VALUES(year)`,[company,job,vin.trim().toUpperCase(),make.trim(),model.trim(),Number(year)]);
  await cx.query(`INSERT INTO repair_orders(company_id,repair_job_id,ro_number,issue_description) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE issue_description=VALUES(issue_description)`,[company,job,'RO-'+Date.now().toString().slice(-6),issue_description.trim()]);
  const pref=await slotState(cx,company,preferred_date,preferred_time);
  if(pref.error||pref.available<1){await cx.rollback();return error(res,409,pref.error||'That time is now fully booked. Choose another.');}
  const [created]=await cx.query(`INSERT INTO appointments(company_id,repair_job_id,scheduled_datetime,booking_status,slot_minutes,preferred_datetime) VALUES(?,?,NULL,'requested',15,?)`,[company,job,preferred_date+' '+preferred_time+':00']);
  await cx.commit();return res.status(201).json({success:true,appointment_id:created.insertId,status:'requested',message:'Service request received. The Service Desk will review your preferred appointment time.'});
 }catch(e){if(cx)await cx.rollback().catch(()=>{});console.error('MOT028 request:',e.code||e.message);return error(res,503,'Unable to submit service request.');}finally{if(cx)cx.release();}
});

router.get('/customer/appointments',async(req,res)=>{
 if(req.user.role!=='customer')return error(res,403,'Customer account required.');
 try{const [rows]=await pool.query(`SELECT a.id,a.booking_status,a.slot_minutes,DATE_FORMAT(a.scheduled_datetime,'%Y-%m-%dT%H:%i') AS scheduled_datetime,DATE_FORMAT(a.preferred_datetime,'%Y-%m-%dT%H:%i') AS preferred_datetime,DATE_FORMAT(a.proposed_datetime,'%Y-%m-%dT%H:%i') AS proposed_datetime FROM appointments a JOIN repair_jobs r ON r.id=a.repair_job_id AND r.company_id=a.company_id WHERE a.company_id=? AND a.repair_job_id=? ORDER BY a.id DESC LIMIT 30`,[req.user.company_id,req.user.customer_id]);res.json({appointments:rows});}
 catch(e){console.error('MOT028 customer list:',e.code||e.message);error(res,503,'Appointments unavailable.');}
});

router.get('/desk/requests',canSchedule,async(req,res)=>{
 try{const [rows]=await pool.query(`SELECT a.id,a.repair_job_id,a.booking_status,DATE_FORMAT(a.preferred_datetime,'%Y-%m-%dT%H:%i') AS preferred_datetime,DATE_FORMAT(a.proposed_datetime,'%Y-%m-%dT%H:%i') AS proposed_datetime,c.first_name,c.last_name,v.make,v.model,v.year,ro.issue_description FROM appointments a JOIN repair_jobs r ON r.id=a.repair_job_id AND r.company_id=a.company_id LEFT JOIN customers c ON c.id=(SELECT MAX(c2.id) FROM customers c2 WHERE c2.repair_job_id=a.repair_job_id AND c2.company_id=a.company_id) LEFT JOIN vehicles v ON v.id=(SELECT MAX(v2.id) FROM vehicles v2 WHERE v2.repair_job_id=a.repair_job_id AND v2.company_id=a.company_id) LEFT JOIN repair_orders ro ON ro.id=(SELECT MAX(ro2.id) FROM repair_orders ro2 WHERE ro2.repair_job_id=a.repair_job_id AND ro2.company_id=a.company_id) WHERE a.company_id=? AND a.booking_status IN ('requested','proposed') AND a.scheduled_datetime IS NULL ORDER BY a.id LIMIT 100`,[req.user.company_id]);res.json({requests:rows});}
 catch(e){console.error('MOT028 desk queue:',e.code||e.message);error(res,503,'Request queue unavailable.');}
});

async function slotState(cx,company,date,time){
 const stamp=date+' '+time+':00';
 const [[settings]]=await cx.query('SELECT timezone FROM shop_schedule_settings WHERE company_id=?',[company]);
 const tz=settings?.timezone||'America/Los_Angeles';
 let now;try{now=localNow(tz);}catch{return {error:'Invalid shop timezone settings.'};}
 const today=`${now.year}-${now.month}-${now.day}`,clock=`${now.hour}:${now.minute}`;
 if(date<today||(date===today&&time<=clock))return {error:'Select a future appointment time.'};
 const day=weekday(date);
 const [hours]=await cx.query(`SELECT is_open,TIME_FORMAT(opens_at,'%H:%i') opens_at,TIME_FORMAT(closes_at,'%H:%i') closes_at FROM shop_business_hours WHERE company_id=? AND weekday=?`,[company,day]);
 const open=hours[0]||{is_open:day>=1&&day<=5,opens_at:'08:00',closes_at:'17:00'};
 const endH=Number(time.slice(0,2)),endM=Number(time.slice(3))+15;
 const endMin=endH*60+endM;
 const endTime=`${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`;
 if(!open.is_open||!open.opens_at||!open.closes_at||time<open.opens_at||endTime>open.closes_at)return {error:'Time is outside shop business hours.'};
 const end=date+' '+endTime+':00';
 const [closures]=await cx.query('SELECT id FROM shop_schedule_closures WHERE company_id=? AND start_at<? AND end_at>? LIMIT 1',[company,end,stamp]);
 if(closures.length)return {error:'The shop is closed during this window.'};
 const [technicians]=await cx.query(`SELECT DISTINCT s.technician_id FROM shop_technician_shifts s JOIN users u ON u.id=s.technician_id AND u.company_id=s.company_id AND u.role='technician' WHERE s.company_id=? AND s.weekday=? AND s.is_active=1 AND s.starts_at<=? AND s.ends_at>=? AND NOT EXISTS (SELECT 1 FROM shop_technician_absences a WHERE a.company_id=s.company_id AND a.technician_id=s.technician_id AND a.start_at<? AND a.end_at>?)`,[company,day,time+':00',endTime+':00',end,stamp]);
 const capacity=technicians.length;
 const [[booked]]=await cx.query(`SELECT COUNT(*) total FROM appointments WHERE company_id=? AND booking_status='confirmed' AND scheduled_datetime<? AND DATE_ADD(scheduled_datetime,INTERVAL slot_minutes MINUTE)>?`,[company,end,stamp]);
 return {capacity,booked:Number(booked.total),available:Math.max(0,capacity-Number(booked.total)),date,time};
}
router.get('/customer/availability',customerOnly,availability);
router.get('/desk/availability',canSchedule,availability);
function customerOnly(req,res,next){return req.user.role==='customer'?next():error(res,403,'Customer access required.');}
async function availability(req,res){
 const date=req.query.date;if(!validDate(date))return error(res,400,'Use a valid date (YYYY-MM-DD).');
 try{const slots=[];for(let minute=0;minute<24*60;minute+=15){const time=`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;const state=await slotState(pool,req.user.company_id,date,time);if(!state.error)slots.push(state);}res.json({date,slots});}
 catch(e){console.error('MOT028 availability:',e.code||e.message);error(res,503,'Availability temporarily unavailable.');}
}
router.post('/desk/requests/:id/confirm',canSchedule,async(req,res)=>{
 const id=Number(req.params.id),{date,time}=req.body||{};
 if(!Number.isSafeInteger(id)||id<=0||!validDate(date)||!validTime(time))return error(res,400,'Select a valid 15-minute date and time.');
 let cx;
 try{
  cx=await pool.getConnection();await cx.beginTransaction();
  // Serialize all schedulers within one shop: last-slot races must not double-book.
  const [[company]]=await cx.query('SELECT id FROM companies WHERE id=? FOR UPDATE',[req.user.company_id]);
  if(!company){await cx.rollback();return error(res,404,'Shop unavailable.');}
  const [[appointment]]=await cx.query("SELECT id,repair_job_id,DATE_FORMAT(preferred_datetime,'%Y-%m-%d') preferred_date,DATE_FORMAT(preferred_datetime,'%H:%i') preferred_time FROM appointments WHERE id=? AND company_id=? AND booking_status='requested' AND scheduled_datetime IS NULL FOR UPDATE",[id,req.user.company_id]);
  if(!appointment){await cx.rollback();return error(res,409,'This request has already been processed or is unavailable.');}
  if(appointment.preferred_date!==date||appointment.preferred_time!==time){await cx.rollback();return error(res,409,'Approve the customer preferred time, or use Propose Alternative.');}
  const state=await slotState(cx,req.user.company_id,date,time);
  if(state.error||state.available<1){await cx.rollback();return error(res,409,state.error||'No technicians available in this 15-minute window.');}
  const stamp=date+' '+time+':00';
  await cx.query("UPDATE appointments SET scheduled_datetime=?,booking_status='confirmed',slot_minutes=15,scheduled_by_user_id=?,confirmed_at=NOW(),cancelled_at=NULL WHERE id=? AND company_id=?",[stamp,req.user.id,id,req.user.company_id]);
  await cx.query("UPDATE repair_jobs SET status='Scheduled' WHERE id=? AND company_id=? AND status='Requested'",[appointment.repair_job_id,req.user.company_id]);
  await cx.commit();
  // Only send AFTER the confirmation transaction commits. Never send for pending requests.
  // SMTP failure must not roll back a real reservation or falsely report that mail was sent.
  const email_status=await sendConfirmed(req.user.company_id,appointment.repair_job_id,date,time);
  return res.json({success:true,appointment_id:id,scheduled_datetime:date+'T'+time,capacity:state.capacity,remaining:state.available-1,email_status});
 }catch(e){if(cx)await cx.rollback().catch(()=>{});console.error('MOT028 confirm:',e.code||e.message);error(res,503,'Unable to confirm appointment.');}finally{if(cx)cx.release();}
});

async function sendConfirmed(companyId,jobId,date,time){
  let email_status='not_sent';
  try {
   const [[recipient]]=await pool.query(`SELECT c.first_name,c.email,co.company_name FROM customers c
      JOIN companies co ON co.id=c.company_id
      WHERE c.company_id=? AND c.repair_job_id=? AND c.email IS NOT NULL AND c.email<>''
      ORDER BY c.id DESC LIMIT 1`,[companyId,jobId]);
   if(recipient && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
     const shop=recipient.company_name||'Your repair shop';
     const [[shopSettings]]=await pool.query('SELECT timezone FROM shop_schedule_settings WHERE company_id=?',[companyId]);
     const tzLabel=shopSettings?.timezone||'America/Los_Angeles';
     const displayDate=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
     const hour=Number(time.slice(0,2)),minute=time.slice(3);
     const displayTime=`${hour%12||12}:${minute} ${hour>=12?'PM':'AM'}`;
     const text=`Hello ${recipient.first_name||'there'},\n\nYour appointment with ${shop} is confirmed for ${displayDate} at ${displayTime} (${tzLabel}).\n\nPlease arrive at your scheduled check-in time. This 15-minute window is for arrival/check-in, not the total service duration.\n\nIf you need to reschedule, please contact the shop.\n\nThank you,\n${shop}`;
     await sendMail({to:recipient.email,fromName:shop,subject:`${shop}: Booking Confirmed`,text});
     email_status='sent';
   } else email_status='missing_address';
  } catch(e) {email_status='failed';console.error('MOT028 booking confirmation email:',e.code||'MAIL_ERROR');}
  return email_status;
}

// Alternative proposals do NOT consume capacity and never generate a confirmation email.
router.post('/desk/requests/:id/propose',canSchedule,async(req,res)=>{
 const id=Number(req.params.id),{date,time}=req.body||{};
 if(!Number.isSafeInteger(id)||id<1||!validDate(date)||!validTime(time))return error(res,400,'Choose a valid alternative slot.');
 let cx;
 try{
  cx=await pool.getConnection();await cx.beginTransaction();
  await cx.query('SELECT id FROM companies WHERE id=? FOR UPDATE',[req.user.company_id]);
  const [[appt]]=await cx.query("SELECT id,DATE_FORMAT(preferred_datetime,'%Y-%m-%d') preferred_date,DATE_FORMAT(preferred_datetime,'%H:%i') preferred_time FROM appointments WHERE company_id=? AND id=? AND booking_status IN ('requested','proposed') AND scheduled_datetime IS NULL FOR UPDATE",[req.user.company_id,id]);
  if(!appt){await cx.rollback();return error(res,409,'This request is no longer pending.');}
  if(appt.preferred_date===date&&appt.preferred_time===time){await cx.rollback();return error(res,400,'Approve the preferred time instead.');}
  const state=await slotState(cx,req.user.company_id,date,time);
  if(state.error||state.available<1){await cx.rollback();return error(res,409,state.error||'That window is full.');}
  await cx.query("UPDATE appointments SET booking_status='proposed',proposed_datetime=? WHERE id=? AND company_id=?",[date+' '+time+':00',id,req.user.company_id]);
  await cx.commit();return res.json({success:true,message:'Alternative proposed. Waiting for customer acceptance.'});
 }catch(e){if(cx)await cx.rollback().catch(()=>{});console.error('Proposal error:',e.code||e.message);return error(res,503,'Unable to propose a new time.');}finally{cx?.release();}
});

router.post('/customer/appointments/:id/accept',customerOnly,async(req,res)=>{
 const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return error(res,400,'Invalid appointment.');
 let cx;
 try{
  cx=await pool.getConnection();await cx.beginTransaction();
  await cx.query('SELECT id FROM companies WHERE id=? FOR UPDATE',[req.user.company_id]);
  const [[appt]]=await cx.query("SELECT id,repair_job_id,DATE_FORMAT(proposed_datetime,'%Y-%m-%d') date,DATE_FORMAT(proposed_datetime,'%H:%i') time FROM appointments WHERE company_id=? AND id=? AND repair_job_id=? AND booking_status='proposed' AND scheduled_datetime IS NULL FOR UPDATE",[req.user.company_id,id,req.user.customer_id]);
  if(!appt||!appt.date||!appt.time){await cx.rollback();return error(res,409,'No alternative is pending approval.');}
  const state=await slotState(cx,req.user.company_id,appt.date,appt.time);
  if(state.error||state.available<1){await cx.rollback();return error(res,409,state.error||'That proposed time has filled. Ask for a new option.');}
  await cx.query("UPDATE appointments SET booking_status='confirmed',scheduled_datetime=proposed_datetime,confirmed_at=NOW(),slot_minutes=15 WHERE id=? AND company_id=?",[id,req.user.company_id]);
  await cx.query("UPDATE repair_jobs SET status='Scheduled' WHERE id=? AND company_id=? AND status='Requested'",[appt.repair_job_id,req.user.company_id]);
  await cx.commit();const email_status=await sendConfirmed(req.user.company_id,appt.repair_job_id,appt.date,appt.time);
  return res.json({success:true,email_status});
 }catch(e){if(cx)await cx.rollback().catch(()=>{});console.error('Accept proposal:',e.code||e.message);return error(res,503,'Unable to accept proposed time.');}finally{cx?.release();}
});

// Only managers and scheduling-authorized staff can assign / reassign technicians.
router.get('/desk/technicians',canSchedule,async(req,res)=>{
 try{const [technicians]=await pool.query("SELECT id,username FROM users WHERE company_id=? AND role='technician' ORDER BY username",[req.user.company_id]);return res.json({technicians});}
 catch(e){console.error('Technician list:',e.code||e.message);return error(res,503,'Technicians unavailable.');}
});
router.get('/desk/jobs',canSchedule,async(req,res)=>{
 try{const [jobs]=await pool.query(`SELECT r.id,r.job_number,r.status,r.assigned_staff_id,
 (SELECT CONCAT_WS(' ',c.first_name,c.last_name) FROM customers c WHERE c.company_id=r.company_id AND c.repair_job_id=r.id ORDER BY c.id DESC LIMIT 1) customer_name,
 (SELECT CONCAT_WS(' ',v.year,v.make,v.model) FROM vehicles v WHERE v.company_id=r.company_id AND v.repair_job_id=r.id ORDER BY v.id DESC LIMIT 1) vehicle,
 u.username assigned_staff_name
 FROM repair_jobs r LEFT JOIN users u ON u.id=r.assigned_staff_id AND u.company_id=r.company_id
 WHERE r.company_id=? AND r.status<>'Completed' ORDER BY r.id DESC LIMIT 150`,[req.user.company_id]);return res.json({jobs});}
 catch(e){console.error('Assignment jobs:',e.code||e.message);return error(res,503,'Jobs unavailable.');}
});
router.put('/desk/jobs/:id/assignee',canSchedule,async(req,res)=>{
 const id=Number(req.params.id),staff=req.body?.technician_id;
 if(!Number.isSafeInteger(id)||id<1||!(staff===null||Number.isSafeInteger(staff)&&staff>0))return error(res,400,'Select a technician or Unassigned.');
 let cx;
 try{cx=await pool.getConnection();await cx.beginTransaction();
  const [[job]]=await cx.query('SELECT id FROM repair_jobs WHERE id=? AND company_id=? FOR UPDATE',[id,req.user.company_id]);
  if(!job){await cx.rollback();return error(res,404,'Repair job not found.');}
  if(staff!==null){const [[tech]]=await cx.query("SELECT id FROM users WHERE id=? AND company_id=? AND role='technician'",[staff,req.user.company_id]);if(!tech){await cx.rollback();return error(res,400,'Technician not found in this shop.');}}
  await cx.query('UPDATE repair_jobs SET assigned_staff_id=? WHERE id=? AND company_id=?',[staff,id,req.user.company_id]);
  await cx.commit();return res.json({success:true});
 }catch(e){if(cx)await cx.rollback().catch(()=>{});console.error('Assign job:',e.code||e.message);return error(res,503,'Unable to assign job.');}finally{cx?.release();}
});

module.exports=router;
