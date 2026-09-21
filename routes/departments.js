const express = require('express');
const pool = require('../db/pool');
const {
  authenticateToken,
  authorizeDepartment
} = require('../middleware/auth');

const router = express.Router();

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

      return res.json({
        success: true,
        id: result.insertId
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