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
// HELPERS
// ======================================================
function looksLikeBcryptHash(value) {
  return (
    typeof value === 'string' &&
    (
      value.startsWith('$2a$') ||
      value.startsWith('$2b$') ||
      value.startsWith('$2y$')
    )
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

    const passwordHash =
      await bcrypt.hash(
        password,
        10
      );

    connection =
      await pool.getConnection();

    await connection.beginTransaction();

    const jobNum =
      `JOB-${Date.now().toString().slice(-6)}`;

    const [jobRes] =
      await connection.query(
        `
        INSERT INTO repair_jobs
          (
            company_id,
            job_number,
            status
          )
        VALUES (?, ?, ?)
        `,
        [
          company_id,
          jobNum,
          'Requested'
        ]
      );

    const jobId =
      jobRes.insertId;

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

    console.error(
      'Registration error:',
      err
    );

    if (
      err.code === 'ER_DUP_ENTRY'
    ) {
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
    String(login_input || '').trim();

  try {
    if (!inputStr) {
      return res.status(400).json({
        error:
          'Please enter your email, username, or staff PIN.'
      });
    }

    let user = null;

    // ==================================================
    // STAFF 6-DIGIT PIN LOGIN
    // ==================================================
    if (/^\d{6}$/.test(inputStr)) {
      let staffRows = [];

      if (company_id) {
        [staffRows] =
          await pool.query(
            `
            SELECT
              u.*,
              c.company_name,
              c.primary_color
            FROM users u
            JOIN companies c
              ON u.company_id = c.id
            WHERE u.company_id = ?
              AND u.role != 'customer'
            `,
            [
              company_id
            ]
          );
      } else {
        [staffRows] =
          await pool.query(
            `
            SELECT
              u.*,
              c.company_name,
              c.primary_color
            FROM users u
            JOIN companies c
              ON u.company_id = c.id
            WHERE u.role != 'customer'
            `
          );
      }

      for (const account of staffRows) {
        const storedPin =
          String(account.pin_code || '');

        if (!storedPin) {
          continue;
        }

        let pinMatches = false;

        // ----------------------------------------------
        // BCRYPT PIN
        // ----------------------------------------------
        if (
          looksLikeBcryptHash(
            storedPin
          )
        ) {
          pinMatches =
            await bcrypt.compare(
              inputStr,
              storedPin
            );
        }

        // ----------------------------------------------
        // LEGACY PLAINTEXT PIN
        // ----------------------------------------------
        else {
          pinMatches =
            inputStr === storedPin;

          if (pinMatches) {
            const newPinHash =
              await bcrypt.hash(
                inputStr,
                10
              );

            await pool.query(
              `
              UPDATE users
              SET pin_code = ?
              WHERE id = ?
              `,
              [
                newPinHash,
                account.id
              ]
            );

            console.log(
              `Migrated staff user ${account.id} PIN to bcrypt.`
            );
          }
        }

        if (pinMatches) {
          user = account;
          break;
        }
      }
    }

    // ==================================================
    // CUSTOMER EMAIL / USERNAME LOGIN
    // ==================================================
    if (!user) {
      let customerRows = [];

      if (company_id) {
        [customerRows] =
          await pool.query(
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
            LIMIT 1
            `,
            [
              inputStr,
              inputStr,
              company_id
            ]
          );
      } else {
        [customerRows] =
          await pool.query(
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
            LIMIT 1
            `,
            [
              inputStr,
              inputStr
            ]
          );
      }

      if (customerRows.length > 0) {
        const account =
          customerRows[0];

        if (!password) {
          return res.status(401).json({
            error:
              'Password is required for customer login.'
          });
        }

        const storedPassword =
          String(
            account.password || ''
          );

        let passwordMatches = false;

        // ----------------------------------------------
        // BCRYPT PASSWORD
        // ----------------------------------------------
        if (
          looksLikeBcryptHash(
            storedPassword
          )
        ) {
          passwordMatches =
            await bcrypt.compare(
              password,
              storedPassword
            );
        }

        // ----------------------------------------------
        // LEGACY PLAINTEXT PASSWORD
        // ----------------------------------------------
        else {
          passwordMatches =
            password === storedPassword;

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

        if (passwordMatches) {
          user = account;
        }
      }
    }

    // ==================================================
    // INVALID LOGIN
    // ==================================================
    if (!user) {
      return res.status(401).json({
        error:
          'Invalid credentials for the selected shop.'
      });
    }

    // ==================================================
    // CREATE JWT
    // ==================================================
    const token =
      jwt.sign(
        {
          id: user.id,
          company_id: user.company_id,
          company_name: user.company_name,
          primary_color:
            user.primary_color,
          username:
            user.username,
          email:
            user.email,
          role:
            user.role,
          customer_id:
            user.customer_id
        },
        JWT_SECRET,
        {
          expiresIn: '8h'
        }
      );

    // ==================================================
    // SAFE LOGIN RESPONSE
    // ==================================================
    return res.json({
      token,
      company_id:
        user.company_id,

      company_name:
        user.company_name,

      primary_color:
        user.primary_color ||
        '#f97316',

      role:
        user.role,

      username:
        user.username,

      email:
        user.email,

      customer_id:
        user.customer_id
    });

  } catch (err) {
    console.error(
      'Login error:',
      err
    );

    return res.status(500).json({
      error:
        'Unable to log in right now. Please try again.'
    });
  }
});

module.exports = router;