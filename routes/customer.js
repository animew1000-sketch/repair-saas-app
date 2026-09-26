const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ======================================================
// CUSTOMER APPOINTMENT REQUEST
// ======================================================
router.post(
  '/request-appointment',
  authenticateToken,
  async (req, res) => {
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
        [
          companyId,
          jobId,
          scheduled_datetime
        ]
      );

      const roNum =
        `RO-${Date.now().toString().slice(-6)}`;

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

      return res.json({
        success: true,
        message: 'Service request created successfully!'
      });

    } catch (err) {
      console.error(
        'Appointment request error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to create your service request right now.'
      });
    }
  }
);

// ======================================================
// UPDATE CUSTOMER PROFILE
// ======================================================
router.put(
  '/update-profile',
  authenticateToken,
  async (req, res) => {
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        error: 'Access denied.'
      });
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
        SET
          first_name = ?,
          last_name = ?,
          phone = ?,
          email = ?
        WHERE repair_job_id = ?
          AND company_id = ?`,
        [
          first_name,
          last_name,
          phone,
          email,
          jobId,
          companyId
        ]
      );

      await pool.query(
        `UPDATE users
        SET email = ?
        WHERE id = ?
          AND company_id = ?`,
        [
          email,
          req.user.id,
          companyId
        ]
      );

      await pool.query(
        `UPDATE vehicles
        SET
          vin = ?,
          make = ?,
          model = ?,
          year = ?
        WHERE repair_job_id = ?
          AND company_id = ?`,
        [
          vin,
          make,
          model,
          year,
          jobId,
          companyId
        ]
      );

      await pool.query(
        `UPDATE repair_orders
        SET issue_description = ?
        WHERE repair_job_id = ?
          AND company_id = ?`,
        [
          issue_description,
          jobId,
          companyId
        ]
      );

      return res.json({
        success: true,
        message: 'Profile updated!'
      });

    } catch (err) {
      console.error(
        'Customer profile update error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to update your profile right now.'
      });
    }
  }
);

// ======================================================
// CUSTOMER REPAIR DATA
// ======================================================
router.get(
  '/my-repair',
  authenticateToken,
  async (req, res) => {
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        error: 'Access denied.'
      });
    }

    const jobId = req.user.customer_id;
    const companyId = req.user.company_id;

    try {
      const [job] =
        await pool.query(
          `
          SELECT *
          FROM repair_jobs
          WHERE id = ?
            AND company_id = ?
          `,
          [
            jobId,
            companyId
          ]
        );

      const [customer] =
        await pool.query(
          `
          SELECT *
          FROM customers
          WHERE repair_job_id = ?
            AND company_id = ?
          `,
          [
            jobId,
            companyId
          ]
        );

      const [vehicle] =
        await pool.query(
          `
          SELECT *
          FROM vehicles
          WHERE repair_job_id = ?
            AND company_id = ?
          `,
          [
            jobId,
            companyId
          ]
        );

      const [appointment] =
        await pool.query(
          `
          SELECT *
          FROM appointments
          WHERE repair_job_id = ?
            AND company_id = ?
          `,
          [
            jobId,
            companyId
          ]
        );

      const [repairOrder] =
        await pool.query(
          `
          SELECT *
          FROM repair_orders
          WHERE repair_job_id = ?
            AND company_id = ?
          `,
          [
            jobId,
            companyId
          ]
        );

      const [partsLabor] =
        await pool.query(
          `
          SELECT *
          FROM parts_and_labor
          WHERE repair_job_id = ?
            AND company_id = ?
          `,
          [
            jobId,
            companyId
          ]
        );

      const [repairExec] =
        await pool.query(
          `
          SELECT *
          FROM repair_executions
          WHERE repair_job_id = ?
            AND company_id = ?
          `,
          [
            jobId,
            companyId
          ]
        );

      const [invoice] =
        await pool.query(
          `
          SELECT *
          FROM invoices
          WHERE repair_job_id = ?
            AND company_id = ?
          `,
          [
            jobId,
            companyId
          ]
        );

      return res.json({
        status:
          job[0]
            ? job[0].status
            : 'Pending',

        customer:
          customer[0] || {},

        vehicle:
          vehicle[0] || {},

        appointment:
          appointment[0] || {},

        repairOrder:
          repairOrder[0] || {},

        partsLabor:
          partsLabor || [],

        repairExec:
          repairExec[0] || {},

        invoice:
          invoice[0] || null
      });

    } catch (err) {
      console.error(
        'Customer repair load error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to load your repair information right now.'
      });
    }
  }
);

// ======================================================
// CUSTOMER LIST FOR STAFF
// ======================================================
router.get(
  '/list',
  authenticateToken,
  async (req, res) => {
    try {
      const [rows] =
        await pool.query(
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
          [
            req.user.company_id
          ]
        );

      return res.json(rows);

    } catch (err) {
      console.error(
        'Customer list error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to load customers right now.'
      });
    }
  }
);

// ======================================================
// DELETE CUSTOMER ACCOUNT
// ======================================================
router.delete(
  '/account',
  authenticateToken,
  async (req, res) => {
    if (req.user.role !== 'customer') {
      return res.status(403).json({
        error:
          'Only customer accounts can be deleted here.'
      });
    }

    const {
      current_password
    } = req.body;

    if (!current_password) {
      return res.status(400).json({
        error:
          'Enter your current password to delete your account.'
      });
    }

    let connection;

    try {
      connection =
        await pool.getConnection();

      await connection.beginTransaction();

      const [users] =
        await connection.query(
          `
          SELECT
            id,
            company_id,
            password,
            customer_id
          FROM users
          WHERE id = ?
            AND company_id = ?
            AND role = 'customer'
          FOR UPDATE
          `,
          [
            req.user.id,
            req.user.company_id
          ]
        );

      if (users.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error:
            'Customer account not found.'
        });
      }

      const user =
        users[0];

      const passwordMatches =
        await bcrypt.compare(
          current_password,
          user.password
        );

      if (!passwordMatches) {
        await connection.rollback();

        return res.status(401).json({
          error:
            'Current password is incorrect.'
        });
      }

      const repairJobId =
        user.customer_id;

      // Delete login account first.
      await connection.query(
        `
        DELETE FROM users
        WHERE id = ?
          AND company_id = ?
        `,
        [
          user.id,
          user.company_id
        ]
      );

      // Delete the customer's repair job.
      // Existing foreign key cascades remove linked
      // customer, vehicle, appointment, order,
      // parts/labor, estimate, repair, and invoice data.
      if (repairJobId) {
        await connection.query(
          `
          DELETE FROM repair_jobs
          WHERE id = ?
            AND company_id = ?
          `,
          [
            repairJobId,
            user.company_id
          ]
        );
      }

      await connection.commit();

      return res.json({
        success: true,
        message:
          'Your account and associated repair data have been deleted.'
      });

    } catch (err) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackErr) {
          console.error(
            'Account deletion rollback error:',
            rollbackErr
          );
        }
      }

      console.error(
        'Account deletion error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to delete your account right now.'
      });

    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
);

module.exports = router;