const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_STAFF_ROLES = [
  'manager',
  'service_advisor',
  'technician',
  'parts_manager',
  'billing'
];

function requireManager(req, res, next) {
  if (req.user.role !== 'manager') {
    return res.status(403).json({
      error: 'Manager access is required.'
    });
  }

  next();
}

// ======================================================
// CHECK WHETHER A PIN IS ALREADY IN USE
// ======================================================
async function isPinInUse(
  companyId,
  enteredPin,
  excludeUserId = null
) {
  let sql = `
    SELECT id, pin_code
    FROM users
    WHERE company_id = ?
      AND role != 'customer'
  `;

  const params = [companyId];

  if (excludeUserId !== null) {
    sql += ' AND id != ?';
    params.push(excludeUserId);
  }

  const [rows] = await pool.query(
    sql,
    params
  );

  for (const user of rows) {
    if (!user.pin_code) {
      continue;
    }

    const storedPin =
      String(user.pin_code);

    const looksHashed =
      storedPin.startsWith('$2a$') ||
      storedPin.startsWith('$2b$') ||
      storedPin.startsWith('$2y$');

    if (looksHashed) {
      const match =
        await bcrypt.compare(
          enteredPin,
          storedPin
        );

      if (match) {
        return true;
      }
    } else {
      // Temporary support for old plaintext PINs.
      if (storedPin === enteredPin) {
        return true;
      }
    }
  }

  return false;
}

// ======================================================
// GET EMPLOYEE ROSTER
// ======================================================
router.get(
  '/employees',
  authenticateToken,
  requireManager,
  async (req, res) => {
    try {
      const [rows] =
        await pool.query(
          `
          SELECT
            id,
            username,
            email,
            role,
            created_at
          FROM users
          WHERE company_id = ?
            AND role != 'customer'
          ORDER BY id ASC
          `,
          [
            req.user.company_id
          ]
        );

      return res.json(rows);

    } catch (err) {
      console.error(
        'Employee roster error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to load the employee roster right now.'
      });
    }
  }
);

// ======================================================
// CREATE EMPLOYEE
// ======================================================
router.post(
  '/create-employee',
  authenticateToken,
  requireManager,
  async (req, res) => {
    const {
      username,
      email,
      pin_code,
      role
    } = req.body;

    if (
      !username ||
      typeof username !== 'string' ||
      username.trim().length < 3 ||
      username.trim().length > 100
    ) {
      return res.status(400).json({
        error:
          'Username must be between 3 and 100 characters.'
      });
    }

    if (
      email &&
      (
        typeof email !== 'string' ||
        email.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      )
    ) {
      return res.status(400).json({
        error:
          'Please enter a valid email address.'
      });
    }

    if (
      typeof pin_code !== 'string' ||
      !/^\d{6}$/.test(pin_code)
    ) {
      return res.status(400).json({
        error:
          'PIN code must be exactly 6 digits.'
      });
    }

    if (
      !ALLOWED_STAFF_ROLES.includes(role)
    ) {
      return res.status(400).json({
        error:
          'Invalid staff role.'
      });
    }

    try {
      const [existingUser] =
        await pool.query(
          `
          SELECT id
          FROM users
          WHERE company_id = ?
            AND username = ?
          LIMIT 1
          `,
          [
            req.user.company_id,
            username.trim()
          ]
        );

      if (existingUser.length > 0) {
        return res.status(409).json({
          error:
            'That username is already being used for this shop.'
        });
      }

      const pinInUse =
        await isPinInUse(
          req.user.company_id,
          pin_code
        );

      if (pinInUse) {
        return res.status(409).json({
          error:
            'That PIN is already being used by another employee.'
        });
      }

      const pinHash =
        await bcrypt.hash(
          pin_code,
          10
        );

      const randomPassword =
        crypto
          .randomBytes(32)
          .toString('hex');

      const passwordHash =
        await bcrypt.hash(
          randomPassword,
          10
        );

      await pool.query(
        `
        INSERT INTO users
          (
            company_id,
            username,
            email,
            password,
            pin_code,
            role
          )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          req.user.company_id,
          username.trim(),
          email
            ? email.trim()
            : null,
          passwordHash,
          pinHash,
          role
        ]
      );

      return res.json({
        success: true,
        message:
          `Staff profile created successfully for ${username.trim()}.`
      });

    } catch (err) {
      console.error(
        'Create employee error:',
        err
      );

      if (
        err.code === 'ER_DUP_ENTRY'
      ) {
        return res.status(409).json({
          error:
            'That employee information is already being used.'
        });
      }

      return res.status(500).json({
        error:
          'Unable to create the employee profile right now.'
      });
    }
  }
);

// ======================================================
// UPDATE EMPLOYEE
// ======================================================
router.put(
  '/update-employee',
  authenticateToken,
  requireManager,
  async (req, res) => {
    const {
      id,
      pin_code,
      role
    } = req.body;

    const employeeId =
      Number(id);

    const newPin =
      typeof pin_code === 'string'
        ? pin_code.trim()
        : '';

    if (
      !Number.isInteger(employeeId) ||
      employeeId <= 0
    ) {
      return res.status(400).json({
        error:
          'Invalid employee ID.'
      });
    }

    // Blank PIN means "leave it unchanged"
    if (
      newPin &&
      !/^\d{6}$/.test(newPin)
    ) {
      return res.status(400).json({
        error:
          'PIN code must be exactly 6 digits.'
      });
    }

    if (
      !ALLOWED_STAFF_ROLES.includes(role)
    ) {
      return res.status(400).json({
        error:
          'Invalid staff role.'
      });
    }

    try {
      const [employeeRows] =
        await pool.query(
          `
          SELECT
            id,
            role
          FROM users
          WHERE id = ?
            AND company_id = ?
            AND role != 'customer'
          LIMIT 1
          `,
          [
            employeeId,
            req.user.company_id
          ]
        );

      if (employeeRows.length === 0) {
        return res.status(404).json({
          error:
            'Employee not found.'
        });
      }

      // Prevent a signed-in manager from demoting themselves.
      if (
        employeeId === req.user.id &&
        role !== 'manager'
      ) {
        return res.status(400).json({
          error:
            'You cannot remove your own manager role.'
        });
      }

      // ==================================================
      // PIN RESET + ROLE UPDATE
      // ==================================================
      if (newPin) {
        const pinInUse =
          await isPinInUse(
            req.user.company_id,
            newPin,
            employeeId
          );

        if (pinInUse) {
          return res.status(409).json({
            error:
              'That PIN is already being used by another employee.'
          });
        }

        const pinHash =
          await bcrypt.hash(
            newPin,
            10
          );

        await pool.query(
          `
          UPDATE users
          SET
            pin_code = ?,
            role = ?
          WHERE id = ?
            AND company_id = ?
          `,
          [
            pinHash,
            role,
            employeeId,
            req.user.company_id
          ]
        );

        return res.json({
          success: true,
          message:
            'Employee role and PIN updated successfully.'
        });
      }

      // ==================================================
      // ROLE-ONLY UPDATE
      // ==================================================
      await pool.query(
        `
        UPDATE users
        SET role = ?
        WHERE id = ?
          AND company_id = ?
        `,
        [
          role,
          employeeId,
          req.user.company_id
        ]
      );

      return res.json({
        success: true,
        message:
          'Employee role updated successfully.'
      });

    } catch (err) {
      console.error(
        'Update employee error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to update the employee profile right now.'
      });
    }
  }
);

module.exports = router;