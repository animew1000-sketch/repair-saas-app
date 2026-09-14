const express = require('express');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/employees', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager') {
    return res.status(403).json({
      error: 'Only Managers can access employee rosters.'
    });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, pin_code, role, created_at FROM users WHERE company_id = ? AND role != "customer" ORDER BY id ASC',
      [req.user.company_id]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create-employee', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager') {
    return res.status(403).json({
      error: 'Only Managers can create employee profiles.'
    });
  }

  const { username, email, pin_code, role } = req.body;

  if (!/^\d{6}$/.test(pin_code)) {
    return res.status(400).json({
      error: 'PIN Code must be exactly 6 digits.'
    });
  }

  try {
    await pool.query(
      'INSERT INTO users (company_id, username, email, password, pin_code, role) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.user.company_id,
        username,
        email || null,
        'pass123',
        pin_code,
        role
      ]
    );

    res.json({
      success: true,
      message: `Staff profile created for ${username} with 6-digit PIN ${pin_code}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/update-employee', authenticateToken, async (req, res) => {
  if (req.user.role !== 'manager') {
    return res.status(403).json({
      error: 'Only Managers can edit employee PINs and roles.'
    });
  }

  const { id, pin_code, role } = req.body;

  if (!/^\d{6}$/.test(pin_code)) {
    return res.status(400).json({
      error: 'PIN Code must be exactly 6 digits.'
    });
  }

  try {
    await pool.query(
      'UPDATE users SET pin_code = ?, role = ? WHERE id = ? AND company_id = ?',
      [pin_code, role, id, req.user.company_id]
    );

    res.json({
      success: true,
      message: 'Employee PIN code and role updated successfully!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;