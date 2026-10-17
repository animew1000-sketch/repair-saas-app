'use strict';
const express=require('express');
const pool=require('../db/pool');
const router=express.Router();
// Only active shops appear in the customer-facing selector and discovery API.
const BASE=`SELECT c.id,c.company_name,c.slug,c.tagline,c.hero_text,c.primary_color,c.service_address,c.phone,c.created_at
FROM companies c LEFT JOIN platform_shop_lifecycle l ON l.company_id=c.id
WHERE COALESCE(l.status,'active')='active'`;
router.get('/',async(req,res)=>{try{const [rows]=await pool.query(BASE+' ORDER BY c.id ASC');res.json(rows);}catch(e){console.error('[Companies list]',e.code||'UNEXPECTED_ERROR');res.status(503).json({error:'Shop directory unavailable.'});}});
router.get('/:slug',async(req,res)=>{try{const [rows]=await pool.query(BASE+' AND c.slug=? LIMIT 1',[req.params.slug]);if(!rows.length)return res.status(404).json({error:'Shop not found'});res.json(rows[0]);}catch(e){console.error('[Companies detail]',e.code||'UNEXPECTED_ERROR');res.status(503).json({error:'Shop unavailable.'});}});
module.exports=router;
