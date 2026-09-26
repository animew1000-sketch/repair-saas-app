const express = require('express');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/request-appointment', authenticateToken, async (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({
      error: 'Only customers can schedule appointments.'
    });
  }

  const jobId = req.user.customer_id;
  const companyId = req.user.company_id;

  const {
    vin,
    make,
    model,
    year,
    scheduled_datetime,
    issue_description
  } = req.body;

  if (!vin || vin.length !== 17) {
    return res.status(400).json({
      error: 'Please enter a valid 17-digit VIN.'
    });
  }

  try {
    await pool.query(
      `INSERT INTO vehicles
      (company_id, repair_job_id, vin, make, model, year)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      vin = ?, make = ?, model = ?, year = ?`,
      [
        companyId,
        jobId,
        vin,
        make,
        model,
        year,
        vin,
        make,
        model,
        year
      ]
    );

    await pool.query(
      `INSERT INTO appointments
      (company_id, repair_job_id, scheduled_datetime)
      VALUES (?, ?, ?)`,
      [companyId, jobId, scheduled_datetime]
    );

    const roNum = `RO-${Date.now().toString().slice(-6)}`;

    await pool.query(
      `INSERT INTO repair_orders
      (company_id, repair_job_id, ro_number, issue_description)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE issue_description = ?`,
      [
        companyId,
        jobId,
        roNum,
        issue_description,
        issue_description
      ]
    );

    res.json({
      success: true,
      message: 'Service request created successfully!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/update-profile', authenticateToken, async (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const jobId = req.user.customer_id;
  const companyId = req.user.company_id;

  const {
    first_name,
    last_name,
    phone,
    email,
    vin,
    make,
    model,
    year,
    issue_description
  } = req.body;

  if (!vin || vin.length !== 17) {
    return res.status(400).json({
      error: 'Please enter a valid 17-digit VIN.'
    });
  }

  try {
    await pool.query(
      `UPDATE customers
      SET first_name = ?, last_name = ?, phone = ?, email = ?
      WHERE repair_job_id = ? AND company_id = ?`,
      [first_name, last_name, phone, email, jobId, companyId]
    );

    await pool.query(
      `UPDATE users
      SET email = ?
      WHERE id = ? AND company_id = ?`,
      [email, req.user.id, companyId]
    );

    await pool.query(
      `UPDATE vehicles
      SET vin = ?, make = ?, model = ?, year = ?
      WHERE repair_job_id = ? AND company_id = ?`,
      [vin, make, model, year, jobId, companyId]
    );

    await pool.query(
      `UPDATE repair_orders
      SET issue_description = ?
      WHERE repair_job_id = ? AND company_id = ?`,
      [issue_description, jobId, companyId]
    );

    res.json({
      success: true,
      message: 'Profile updated!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/my-repair', authenticateToken, async (req, res) => {
  if (req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const jobId = req.user.customer_id;
  const companyId = req.user.company_id;

  try {
    const [job] = await pool.query(
      'SELECT * FROM repair_jobs WHERE id = ? AND company_id = ?',
      [jobId, companyId]
    );

    const [customer] = await pool.query(
      'SELECT * FROM customers WHERE repair_job_id = ? AND company_id = ?',
      [jobId, companyId]
    );

    const [vehicle] = await pool.query(
      'SELECT * FROM vehicles WHERE repair_job_id = ? AND company_id = ?',
      [jobId, companyId]
    );

    const [appointment] = await pool.query(
      'SELECT * FROM appointments WHERE repair_job_id = ? AND company_id = ?',
      [jobId, companyId]
    );

    const [repairOrder] = await pool.query(
      'SELECT * FROM repair_orders WHERE repair_job_id = ? AND company_id = ?',
      [jobId, companyId]
    );

    const [partsLabor] = await pool.query(
      'SELECT * FROM parts_and_labor WHERE repair_job_id = ? AND company_id = ?',
      [jobId, companyId]
    );

    const [repairExec] = await pool.query(
      'SELECT * FROM repair_executions WHERE repair_job_id = ? AND company_id = ?',
      [jobId, companyId]
    );

    const [invoice] = await pool.query(
      'SELECT * FROM invoices WHERE repair_job_id = ? AND company_id = ?',
      [jobId, companyId]
    );

    res.json({
      status: job[0] ? job[0].status : 'Pending',
      customer: customer[0] || {},
      vehicle: vehicle[0] || {},
      appointment: appointment[0] || {},
      repairOrder: repairOrder[0] || {},
      partsLabor: partsLabor || [],
      repairExec: repairExec[0] || {},
      invoice: invoice[0] || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        c.repair_job_id,
        c.first_name,
        c.last_name,
        c.phone,
        c.email,
        v.make,
        v.model,
        v.year,
        v.vin
      FROM customers c
      LEFT JOIN vehicles v
        ON v.repair_job_id = c.repair_job_id
        AND v.company_id = c.company_id
      WHERE c.company_id = ?
      ORDER BY c.id DESC`,
      [req.user.company_id]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;