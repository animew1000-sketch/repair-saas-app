'use strict';
const express=require('express');
const pool=require('../db/pool');
const {authenticateToken}=require('../middleware/auth');
const {EDITABLE,BASE,resolve,getResolved}=require('../services/permissions');
const router=express.Router();
const managerOnly=(req,res,next)=>req.user.role==='manager'?next():res.status(403).json({error:'Manager access required.'});
router.use(authenticateToken);
router.get('/me',async(req,res)=>{
  try { const permissions=await getResolved(req.user.company_id,req.user.id,req.user.role);return res.json({role:req.user.role,permissions}); }
  catch(e){console.error('My permissions error:',e.code||e.message);return res.status(503).json({error:'Permissions temporarily unavailable.'});}
});
router.use(managerOnly);
router.get('/catalog',(req,res)=>res.json({keys:EDITABLE,defaults:BASE}));
async function getEmployee(req,res,db=pool){
  const employeeId=Number(req.params.id);
  if(!Number.isSafeInteger(employeeId)||employeeId<=0){res.status(400).json({error:'Invalid employee ID.'});return null;}
  const [rows]=await db.query("SELECT id,username,role FROM users WHERE id=? AND company_id=? AND role!='customer' LIMIT 1",[employeeId,req.user.company_id]);
  if(!rows.length){res.status(404).json({error:'Employee not found in your shop.'});return null;}
  return rows[0];
}
router.get('/employees/:id',async(req,res)=>{
  try {
    const staff=await getEmployee(req,res);if(!staff)return;
    const [overrides]=await pool.query('SELECT permission_key,is_allowed FROM employee_permission_overrides WHERE company_id=? AND user_id=? ORDER BY permission_key',[req.user.company_id,staff.id]);
    res.json({employee:staff,defaults:resolve(staff.role),effective:resolve(staff.role,overrides),overrides});
  }catch(e){console.error('Read employee permissions:',e.code||e.message);res.status(503).json({error:'Permissions temporarily unavailable.'});}
});
// Full desired overrides. Omitted keys reset to base role. Managers can't be overridden.
router.put('/employees/:id',async(req,res)=>{
  const entries=req.body?.overrides;
  if(!entries || typeof entries!=='object'||Array.isArray(entries)||Object.keys(entries).some(k=>!EDITABLE.includes(k)||typeof entries[k]!=='boolean'))return res.status(400).json({error:'Use a map of recognized permission keys to booleans.'});
  let conn;
  try {
    conn=await pool.getConnection();await conn.beginTransaction();
    const staff=await getEmployee(req,res,conn);if(!staff){await conn.rollback();return;}
    if(staff.role==='manager'){await conn.rollback();return res.status(403).json({error:'Manager permissions are protected.'});}
    const [prior]=await conn.query('SELECT permission_key,is_allowed FROM employee_permission_overrides WHERE company_id=? AND user_id=? FOR UPDATE',[req.user.company_id,staff.id]);
    const before=new Map(prior.map(r=>[r.permission_key,Number(r.is_allowed)]));
    for(const key of EDITABLE){
      const old=before.has(key)?before.get(key):null;
      const wanted=Object.prototype.hasOwnProperty.call(entries,key)?(entries[key]?1:0):null;
      if(old===wanted)continue;
      if(wanted===null)await conn.query('DELETE FROM employee_permission_overrides WHERE company_id=? AND user_id=? AND permission_key=?',[req.user.company_id,staff.id,key]);
      else await conn.query('INSERT INTO employee_permission_overrides(company_id,user_id,permission_key,is_allowed,updated_by) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE is_allowed=VALUES(is_allowed),updated_by=VALUES(updated_by)',[req.user.company_id,staff.id,key,wanted,req.user.id]);
      await conn.query('INSERT INTO employee_permission_audit(company_id,employee_id,actor_id,permission_key,old_override,new_override) VALUES(?,?,?,?,?,?)',[req.user.company_id,staff.id,req.user.id,key,old,wanted]);
    }
    await conn.commit();res.json({success:true,effective:resolve(staff.role,Object.entries(entries).map(([permission_key,allowed])=>({permission_key,is_allowed:allowed?1:0})))});
  }catch(e){if(conn)await conn.rollback().catch(()=>{});console.error('Save employee permissions:',e.code||e.message);res.status(503).json({error:'Unable to save employee permissions.'});}
  finally{if(conn)conn.release();}
});
router.get('/employees/:id/audit',async(req,res)=>{
  try {
    const staff=await getEmployee(req,res);if(!staff)return;
    const [rows]=await pool.query('SELECT permission_key,old_override,new_override,changed_at FROM employee_permission_audit WHERE company_id=? AND employee_id=? ORDER BY id DESC LIMIT 50',[req.user.company_id,staff.id]);
    res.json({entries:rows});
  }catch(e){console.error('Permission audit unavailable:',e.code||e.message);res.status(503).json({error:'Audit unavailable.'});}
});
module.exports=router;
