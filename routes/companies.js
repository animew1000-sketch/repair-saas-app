const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const [companies] = await pool.query(
      'SELECT * FROM companies ORDER BY id ASC'
    );

    res.json(companies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const [companies] = await pool.query(
      'SELECT * FROM companies WHERE slug = ?',
      [req.params.slug]
    );

    if (companies.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json(companies[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;