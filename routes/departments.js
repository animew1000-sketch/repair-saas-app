const express = require('express');
const pool = require('../db/pool');
const {
  authenticateToken,
  authorizeDepartment
} = require('../middleware/auth');

const router = express.Router();

router.post('/:name', authenticateToken, authorizeDepartment, async (req, res) => {
  const dept = req.params.name;
  const data = req.body;
  const companyId = req.user.company_id;

  const tableMap = {
    customer: 'customers',
    vehicle: 'vehicles',
    appointment: 'appointments',
    repair_order: 'repair_orders',
    parts_labor: 'parts_and_labor',
    estimate: 'estimates',
    repair: 'repair_executions',
    invoice: 'invoices'
  };

  const table = tableMap[dept];

  if (!table) {
    return res.status(400).json({
      error: 'Invalid department.'
    });
  }

  try {
    const jobId = data.repair_job_id;

    const [existingJobs] = await pool.query(
      'SELECT id FROM repair_jobs WHERE id = ? AND company_id = ?',
      [jobId, companyId]
    );

    if (existingJobs.length === 0) {
      await pool.query(
        'INSERT INTO repair_jobs (id, company_id, job_number) VALUES (?, ?, ?)',
        [jobId, companyId, `JOB-${jobId}`]
      );
    }

    data.company_id = companyId;

    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');

    const sql = `
      INSERT INTO ${table}
      (${keys.join(', ')})
      VALUES (${placeholders})
    `;

    const [result] = await pool.query(sql, values);

    res.json({
      success: true,
      id: result.insertId
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;