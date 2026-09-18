const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Add JWT_SECRET to your .env file before starting the server.'
  );
}

// ======================================================
// CUSTOMER REGISTRATION
// ======================================================
router.post('/register', async (req, res) => {
  const {
    company_id,
    username,
    email,
    password,
    first_name,
    last_name,
    phone
  } = req.body;

  let connection;

  try {
    if (
      !company_id ||
      !username ||
      !email ||
      !password ||
      !first_name ||
      !last_name ||
      !phone
    ) {
      return res.status(400).json({
        error: 'Please complete all required fields.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    connection = await pool.getConnection();

    await connection.beginTransaction();

    const jobNum =
      `JOB-${Date.now().toString().slice(-6)}`;

    const [jobRes] = await connection.query(
      `
      INSERT INTO repair_jobs
        (company_id, job_number, status)
      VALUES (?, ?, ?)
      `,
      [
        company_id,
        jobNum,
        'Requested'
      ]
    );

    const jobId = jobRes.insertId;

    await connection.query(
      `
      INSERT INTO customers
        (
          company_id,
          repair_job_id,
          first_name,
          last_name,
          phone,
          email
        )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        company_id,
        jobId,
        first_name,
        last_name,
        phone,
        email
      ]
    );

    await connection.query(
      `
      INSERT INTO users
        (
          company_id,
          username,
          email,
          password,
          role,
          customer_id
        )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        company_id,
        username,
        email,
        passwordHash,
        'customer',
        jobId
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message:
        'Account created successfully! You can now log in.'
    });
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error(
          'Registration rollback error:',
          rollbackErr
        );
      }
    }

    console.error('Registration error:', err);

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error:
          'An account with that username or email already exists for this shop.'
      });
    }

    return res.status(500).json({
      error:
        'Unable to create your account right now. Please try again.'
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ======================================================
// LOGIN
// ======================================================
router.post('/login', async (req, res) => {
  const {
    company_id,
    login_input,
    password
  } = req.body;

  const inputStr =
    (login_input || '').trim();

  try {
    if (!inputStr) {
      return res.status(400).json({
        error:
          'Please enter your email, username, or staff PIN.'
      });
    }

    let rows = [];

    // ==================================================
    // STAFF 6-DIGIT PIN LOGIN
    // ==================================================
    if (/^\d{6}$/.test(inputStr)) {
      if (company_id) {
        [rows] = await pool.query(
          `
          SELECT
            u.*,
            c.company_name,
            c.primary_color
          FROM users u
          JOIN companies c
            ON u.company_id = c.id
          WHERE u.pin_code = ?
            AND u.company_id = ?
          `,
          [
            inputStr,
            company_id
          ]
        );
      } else {
        [rows] = await pool.query(
          `
          SELECT
            u.*,
            c.company_name,
            c.primary_color
          FROM users u
          JOIN companies c
            ON u.company_id = c.id
          WHERE u.pin_code = ?
          `,
          [
            inputStr
          ]
        );
      }
    }

    // ==================================================
    // CUSTOMER EMAIL / USERNAME LOGIN
    // ==================================================
    if (rows.length === 0) {
      if (company_id) {
        [rows] = await pool.query(
          `
          SELECT
            u.*,
            c.company_name,
            c.primary_color
          FROM users u
          JOIN companies c
            ON u.company_id = c.id
          WHERE
            (
              u.email = ?
              OR u.username = ?
            )
            AND u.company_id = ?
          `,
          [
            inputStr,
            inputStr,
            company_id
          ]
        );
      } else {
        [rows] = await pool.query(
          `
          SELECT
            u.*,
            c.company_name,
            c.primary_color
          FROM users u
          JOIN companies c
            ON u.company_id = c.id
          WHERE
            (
              u.email = ?
              OR u.username = ?
            )
          `,
          [
            inputStr,
            inputStr
          ]
        );
      }

      if (rows.length > 0) {
        const account = rows[0];

        if (!password) {
          return res.status(401).json({
            error:
              'Password is required for customer login.'
          });
        }

        const storedPassword =
          account.password || '';

        const passwordIsHashed =
          storedPassword.startsWith('$2a$') ||
          storedPassword.startsWith('$2b$') ||
          storedPassword.startsWith('$2y$');

        let passwordMatches = false;

        // ----------------------------------------------
        // BCRYPT ACCOUNT
        // ----------------------------------------------
        if (passwordIsHashed) {
          passwordMatches =
            await bcrypt.compare(
              password,
              storedPassword
            );
        }

        // ----------------------------------------------
        // LEGACY PLAINTEXT ACCOUNT
        // ----------------------------------------------
        else {
          passwordMatches =
            password === storedPassword;

          // Automatically upgrade old plaintext account
          if (passwordMatches) {
            const newHash =
              await bcrypt.hash(
                password,
                10
              );

            await pool.query(
              `
              UPDATE users
              SET password = ?
              WHERE id = ?
              `,
              [
                newHash,
                account.id
              ]
            );

            console.log(
              `Migrated user ${account.id} password to bcrypt.`
            );
          }
        }

        if (!passwordMatches) {
          rows = [];
        }
      }
    }

    // ==================================================
    // INVALID LOGIN
    // ==================================================
    if (rows.length === 0) {
      return res.status(401).json({
        error:
          'Invalid credentials for the selected shop.'
      });
    }

    const user = rows[0];

    // ==================================================
    // CREATE JWT
    // ==================================================
    const token = jwt.sign(
      {
        id: user.id,
        company_id: user.company_id,
        company_name: user.company_name,
        primary_color: user.primary_color,
        username: user.username,
        email: user.email,
        role: user.role,
        customer_id: user.customer_id
      },
      JWT_SECRET,
      {
        expiresIn: '8h'
      }
    );

    return res.json({
      token,
      company_id: user.company_id,
      company_name: user.company_name,

      primary_color:
        user.primary_color ||
        '#f97316',

      role: user.role,
      username: user.username,
      email: user.email,
      customer_id: user.customer_id,
      pin_code: user.pin_code
    });
  } catch (err) {
    console.error('Login error:', err);

    return res.status(500).json({
      error:
        'Unable to log in right now. Please try again.'
    });
  }
});

module.exports = router;