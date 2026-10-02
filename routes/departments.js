const express = require('express');
const pool = require('../db/pool');
const { sendMail } = require('../services/mail');
const {
  authenticateToken,
  authorizeDepartment
} = require('../middleware/auth');

const router = express.Router();

function requireStaff(req, res, next) {
  if (req.user.role === 'customer') {
    return res.status(403).json({
      error: 'Staff access is required.'
    });
  }

  next();
}

router.get(
  '/job/:jobId',
  authenticateToken,
  requireStaff,
  async (req, res) => {
    const jobId = Number(req.params.jobId);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ error: 'Invalid repair job.' });
    }

    try {
      const [jobRows] = await pool.query(
        `SELECT * FROM repair_jobs WHERE id = ? AND company_id = ? LIMIT 1`,
        [jobId, req.user.company_id]
      );

      if (jobRows.length === 0) {
        return res.status(404).json({ error: 'Repair job not found.' });
      }

      const [customer, vehicle, appointment, repairOrder, partsLabor, estimate, repair, invoice] = await Promise.all([
        pool.query('SELECT * FROM customers WHERE repair_job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', [jobId, req.user.company_id]),
        pool.query('SELECT * FROM vehicles WHERE repair_job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', [jobId, req.user.company_id]),
        pool.query('SELECT * FROM appointments WHERE repair_job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', [jobId, req.user.company_id]),
        pool.query('SELECT * FROM repair_orders WHERE repair_job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', [jobId, req.user.company_id]),
        pool.query('SELECT * FROM parts_and_labor WHERE repair_job_id = ? AND company_id = ? ORDER BY id ASC', [jobId, req.user.company_id]),
        pool.query('SELECT * FROM estimates WHERE repair_job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', [jobId, req.user.company_id]),
        pool.query('SELECT * FROM repair_executions WHERE repair_job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', [jobId, req.user.company_id]),
        pool.query('SELECT * FROM invoices WHERE repair_job_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1', [jobId, req.user.company_id])
      ]);

      return res.json({
        job: jobRows[0],
        customer: customer[0][0] || {},
        vehicle: vehicle[0][0] || {},
        appointment: appointment[0][0] || {},
        repair_order: repairOrder[0][0] || {},
        parts_labor: partsLabor[0],
        estimate: estimate[0][0] || {},
        repair: repair[0][0] || {},
        invoice: invoice[0][0] || null
      });
    } catch (err) {
      console.error('Staff job load error:', err);
      return res.status(500).json({ error: 'Unable to load the repair job right now.' });
    }
  }
);

router.post(
  '/job/:jobId/ready',
  authenticateToken,
  requireStaff,
  async (req, res) => {
    const jobId = Number(req.params.jobId);

    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ error: 'Invalid repair job.' });
    }

    try {
      const [rows] = await pool.query(
        `SELECT
          c.first_name,
          c.email,
          r.job_number,
          co.company_name
         FROM repair_jobs r
         LEFT JOIN customers c
           ON c.repair_job_id = r.id
          AND c.company_id = r.company_id
         INNER JOIN companies co ON co.id = r.company_id
         WHERE r.id = ? AND r.company_id = ?
         ORDER BY c.id DESC
         LIMIT 1`,
        [jobId, req.user.company_id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Repair job not found.' });
      }

      await pool.query(
        `UPDATE repair_jobs SET status = 'Completed' WHERE id = ? AND company_id = ?`,
        [jobId, req.user.company_id]
      );

      let emailSent = false;
      if (rows[0].email) {
        await sendMail({
          to: rows[0].email,
          subject: `${rows[0].company_name}: your vehicle is ready for pickup`,
          text: `Hello ${rows[0].first_name || 'there'},\n\nYour vehicle is ready for pickup at ${rows[0].company_name}. Please contact the shop if you need help arranging pickup.\n\nRepair job: ${rows[0].job_number || jobId}`,
          fromName: rows[0].company_name
        });
        emailSent = true;
      }

      return res.json({ success: true, email_sent: emailSent });
    } catch (err) {
      console.error('Ready for pickup error:', err);
      return res.status(500).json({ error: 'Unable to mark this vehicle ready right now.' });
    }
  }
);

router.get(
  '/jobs',
  authenticateToken,
  requireStaff,
  async (req, res) => {
    try {
      const roleFilter =
        req.user.role === 'technician'
          ? 'AND (r.assigned_staff_id = ? OR r.assigned_staff_id IS NULL)'
          : '';

      const params = [req.user.company_id];
      if (req.user.role === 'technician') {
        params.push(req.user.id);
      }

      const [jobs] = await pool.query(
        `SELECT
          r.id,
          r.job_number,
          r.status,
          r.assigned_staff_id,
          c.first_name,
          c.last_name,
          v.make,
          v.model,
          v.year,
          ap.scheduled_datetime,
          assigned.username AS assigned_staff_name
         FROM repair_jobs r
         LEFT JOIN customers c ON c.repair_job_id = r.id AND c.company_id = r.company_id
         LEFT JOIN vehicles v ON v.repair_job_id = r.id AND v.company_id = r.company_id
         LEFT JOIN (
           SELECT repair_job_id, MAX(scheduled_datetime) AS scheduled_datetime
           FROM appointments
           WHERE company_id = ?
           GROUP BY repair_job_id
         ) ap ON ap.repair_job_id = r.id
         LEFT JOIN users assigned ON assigned.id = r.assigned_staff_id AND assigned.company_id = r.company_id
         WHERE r.company_id = ? ${roleFilter}
         ORDER BY ap.scheduled_datetime IS NULL, ap.scheduled_datetime ASC, r.id DESC`,
        [req.user.company_id, ...params]
      );

      return res.json({ success: true, jobs });
    } catch (err) {
      console.error('Staff jobs load error:', err);
      return res.status(500).json({ error: 'Unable to load staff jobs right now.' });
    }
  }
);

router.post(
  '/jobs/:jobId/claim',
  authenticateToken,
  requireStaff,
  async (req, res) => {
    if (req.user.role !== 'technician') {
      return res.status(403).json({ error: 'Only technicians can claim jobs.' });
    }

    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ error: 'Invalid repair job.' });
    }

    try {
      const [result] = await pool.query(
        `UPDATE repair_jobs
         SET assigned_staff_id = ?, status = CASE WHEN status = 'Requested' THEN 'Scheduled' ELSE status END
         WHERE id = ? AND company_id = ? AND assigned_staff_id IS NULL`,
        [req.user.id, jobId, req.user.company_id]
      );

      if (result.affectedRows === 0) {
        return res.status(409).json({ error: 'That job has already been claimed.' });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('Staff job claim error:', err);
      return res.status(500).json({ error: 'Unable to claim this job right now.' });
    }
  }
);

router.post(
  '/:name',
  authenticateToken,
  authorizeDepartment,
  async (req, res) => {
    const dept = req.params.name;
    const data = { ...req.body };
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

    const allowedFields = {
      customer: [
        'repair_job_id',
        'first_name',
        'last_name',
        'phone'
      ],

      vehicle: [
        'repair_job_id',
        'vin',
        'make',
        'model',
        'year'
      ],

      appointment: [
        'repair_job_id',
        'scheduled_datetime',
        'service_advisor'
      ],

      repair_order: [
        'repair_job_id',
        'ro_number',
        'issue_description'
      ],

      parts_labor: [
        'repair_job_id',
        'item_type',
        'description',
        'unit_cost'
      ],

      estimate: [
        'repair_job_id',
        'estimated_total'
      ],

      repair: [
        'repair_job_id',
        'work_summary'
      ],

      invoice: [
        'repair_job_id',
        'invoice_number',
        'subtotal',
        'total_amount'
      ]
    };

    const table = tableMap[dept];

    if (!table) {
      return res.status(400).json({
        error: 'Invalid department.'
      });
    }

    try {
      const jobId = data.repair_job_id;

      if (!jobId) {
        return res.status(400).json({
          error: 'A repair job must be selected first.'
        });
      }

      const [existingJobs] = await pool.query(
        `
        SELECT id
        FROM repair_jobs
        WHERE id = ?
          AND company_id = ?
        `,
        [jobId, companyId]
      );

      if (existingJobs.length === 0) {
        await pool.query(
          `
          INSERT INTO repair_jobs
            (id, company_id, job_number)
          VALUES (?, ?, ?)
          `,
          [
            jobId,
            companyId,
            `JOB-${jobId}`
          ]
        );
      }

      // ==================================================
      // INVOICE VALIDATION
      // ==================================================
      if (dept === 'invoice') {
        const subtotal = Number(data.subtotal);
        const totalAmount = Number(data.total_amount);

        if (!data.invoice_number) {
          return res.status(400).json({
            error: 'Invoice number is required.'
          });
        }

        if (
          !Number.isFinite(subtotal) ||
          !Number.isFinite(totalAmount)
        ) {
          return res.status(400).json({
            error:
              'Subtotal and total amount must be valid numbers.'
          });
        }

        if (
          subtotal < 0 ||
          totalAmount < 0
        ) {
          return res.status(400).json({
            error:
              'Invoice amounts cannot be negative.'
          });
        }

        if (
          subtotal > 99999999.99 ||
          totalAmount > 99999999.99
        ) {
          return res.status(400).json({
            error:
              'Invoice amount is too large.'
          });
        }

        data.subtotal =
          subtotal.toFixed(2);

        data.total_amount =
          totalAmount.toFixed(2);
      }

      // ==================================================
      // ESTIMATE VALIDATION
      // ==================================================
      if (dept === 'estimate') {
        const estimatedTotal =
          Number(data.estimated_total);

        if (!Number.isFinite(estimatedTotal)) {
          return res.status(400).json({
            error:
              'Estimated total must be a valid number.'
          });
        }

        if (estimatedTotal < 0) {
          return res.status(400).json({
            error:
              'Estimated total cannot be negative.'
          });
        }

        if (estimatedTotal > 99999999.99) {
          return res.status(400).json({
            error:
              'Estimated total is too large.'
          });
        }

        data.estimated_total =
          estimatedTotal.toFixed(2);
      }

      // ==================================================
      // PARTS / LABOR COST VALIDATION
      // ==================================================
      if (dept === 'parts_labor') {
        const unitCost =
          Number(data.unit_cost);

        if (!Number.isFinite(unitCost)) {
          return res.status(400).json({
            error:
              'Cost must be a valid number.'
          });
        }

        if (unitCost < 0) {
          return res.status(400).json({
            error:
              'Cost cannot be negative.'
          });
        }

        if (unitCost > 99999999.99) {
          return res.status(400).json({
            error:
              'Cost is too large.'
          });
        }

        data.unit_cost =
          unitCost.toFixed(2);
      }

      await pool.query(
        `DELETE FROM ${table}
         WHERE repair_job_id = ?
           AND company_id = ?`,
        [jobId, companyId]
      );

      // ==================================================
      // FIELD WHITELIST
      // ==================================================
      const allowed =
        allowedFields[dept];

      const filteredData = {};

      for (const field of allowed) {
        if (
          Object.prototype.hasOwnProperty.call(
            data,
            field
          )
        ) {
          filteredData[field] =
            data[field];
        }
      }

      // Never trust company_id from the browser.
      filteredData.company_id =
        companyId;

      const keys =
        Object.keys(filteredData);

      const values =
        Object.values(filteredData);

      const placeholders =
        keys.map(() => '?').join(', ');

      const sql = `
        INSERT INTO ${table}
          (${keys.join(', ')})
        VALUES
          (${placeholders})
      `;

      const [result] =
        await pool.query(
          sql,
          values
        );

      const workflowStatus = {
        appointment: 'Scheduled',
        repair_order: 'In Progress',
        parts_labor: 'In Progress',
        estimate: 'In Progress',
        repair: 'In Progress'
      }[dept];

      if (workflowStatus) {
        await pool.query(
          `UPDATE repair_jobs SET status = ? WHERE id = ? AND company_id = ?`,
          [workflowStatus, jobId, companyId]
        );
      }

      let emailSent = false;
      if (dept === 'invoice') {
        await pool.query(
          `UPDATE repair_jobs SET status = 'Invoiced' WHERE id = ? AND company_id = ?`,
          [jobId, companyId]
        );

        const [customerRows] = await pool.query(
          `SELECT c.first_name, c.email, r.job_number, co.company_name
           FROM customers c
           INNER JOIN repair_jobs r ON r.id = c.repair_job_id AND r.company_id = c.company_id
           INNER JOIN companies co ON co.id = r.company_id
           WHERE c.repair_job_id = ? AND c.company_id = ?
           ORDER BY c.id DESC LIMIT 1`,
          [jobId, companyId]
        );

        if (customerRows[0]?.email) {
          await sendMail({
            to: customerRows[0].email,
            subject: `${customerRows[0].company_name}: your invoice is ready`,
            text: `Hello ${customerRows[0].first_name || 'there'},\n\nYour repair invoice has been generated and is ready to review through your Motivo customer portal.\n\nRepair job: ${customerRows[0].job_number || jobId}`,
            fromName: customerRows[0].company_name
          });
          emailSent = true;
        }
      }

      return res.json({
        success: true,
        id: result.insertId,
        email_sent: emailSent
      });

    } catch (err) {
      console.error(
        'Department save error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to save this record right now. Please try again.'
      });
    }
  }
);

module.exports = router;