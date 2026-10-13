'use strict';
// MOT-029. Single source for base grants + override resolution.
// Employee administration is NEVER delegable; managers always retain all grants.
const pool = require('../db/pool');
const WORKFLOW = ['customer','vehicle','appointment','repair_order','parts_labor','estimate','repair','invoice'];
const EXTRA = ['scheduling.manage','notices.send'];
const EDITABLE = Object.freeze([...WORKFLOW,...EXTRA]);
const BASE = Object.freeze({
  manager: EDITABLE,
  service_advisor: ['customer','vehicle','appointment','repair_order','estimate','scheduling.manage','notices.send'],
  technician: ['parts_labor','repair'],
  parts_manager: ['parts_labor'],
  billing: ['estimate','invoice'],
  customer: []
});
const canonical = role => BASE[role] ? role : 'customer';
function resolve(role, records = []) {
  const result = Object.fromEntries(EDITABLE.map(k => [k,BASE[canonical(role)].includes(k)]));
  if (role === 'manager' || role === 'customer') return result;
  for (const row of records) if (EDITABLE.includes(row.permission_key)) result[row.permission_key] = Number(row.is_allowed) === 1;
  return result;
}
async function getResolved(companyId,userId,role,db=pool) {
  if (role === 'manager' || role === 'customer') return resolve(role);
  const [rows] = await db.query('SELECT permission_key,is_allowed FROM employee_permission_overrides WHERE company_id=? AND user_id=?',[companyId,userId]);
  return resolve(role,rows);
}
function requirePermission(key) {
  if(!EDITABLE.includes(key)) throw new Error('Unknown permission key '+key);
  return async (req,res,next) => {
    try {
      if(req.user.role === 'customer') return res.status(403).json({error:'Staff access required.'});
      const permissions=await getResolved(req.user.company_id,req.user.id,req.user.role);
      if(!permissions[key]) return res.status(403).json({error:'Permission denied.'});
      return next();
    } catch(err) {
      console.error('Permission check unavailable:',err.code||err.message);
      return res.status(503).json({error:'Permission check temporarily unavailable.'});
    }
  };
}
module.exports = {WORKFLOW,EDITABLE,BASE,resolve,getResolved,requirePermission};
