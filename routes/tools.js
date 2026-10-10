const express = require('express');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// NHTSA vPIC is a public vehicle decoder; no API key is required.
// Cache successful responses to limit requests to the public service.
const vinCache = new Map();
const VIN_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_VIN_CACHE_ENTRIES = 300;
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

router.get('/vehicle/vin-lookup/:vin', authenticateToken, async (req, res) => {
  const vin = String(req.params.vin || '').trim().toUpperCase();
  if (!VIN_PATTERN.test(vin)) {
    return res.status(400).json({
      error: 'Enter a valid 17-character VIN (letters I, O, and Q are not allowed).'
    });
  }

  const cached = vinCache.get(vin);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.value);
  }
  if (cached) vinCache.delete(vin);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
        { signal: controller.signal, headers: { Accept: 'application/json' } }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return res.status(502).json({
        error: 'NHTSA VIN lookup is temporarily unavailable. Enter vehicle details manually.'
      });
    }

    const payload = await response.json();
    const decoded = payload && Array.isArray(payload.Results) ? payload.Results[0] : null;
    if (!decoded) {
      return res.status(502).json({
        error: 'NHTSA returned an unexpected response. Enter vehicle details manually.'
      });
    }

    const make = String(decoded.Make || '').trim();
    const model = String(decoded.Model || '').trim();
    const year = String(decoded.ModelYear || '').trim();
    const errorCode = String(decoded.ErrorCode || '').trim();
    const warning = String(decoded.ErrorText || '').trim();

    if (!make || !model || !/^\d{4}$/.test(year)) {
      return res.status(422).json({
        error: 'NHTSA could not identify a complete year, make, and model for this VIN. Enter details manually.',
        source: 'NHTSA vPIC',
        warning: warning || undefined
      });
    }

    const result = {
      vin,
      make,
      model,
      year,
      source: 'NHTSA vPIC',
      // Nonzero error codes can indicate check-digit or decoding problems.
      // The UI must warn staff/customers before relying on decoded data.
      warning: errorCode && errorCode !== '0' ? (warning || 'NHTSA reported a decoding warning.') : null
    };
    if (vinCache.size >= MAX_VIN_CACHE_ENTRIES) {
      vinCache.delete(vinCache.keys().next().value);
    }
    vinCache.set(vin, { expiresAt: Date.now() + VIN_CACHE_MS, value: result });
    return res.json(result);
  } catch (error) {
    const isTimeout = error && error.name === 'AbortError';
    console.error('NHTSA VIN lookup error:', error && error.message);
    return res.status(isTimeout ? 504 : 502).json({
      error: isTimeout
        ? 'NHTSA VIN lookup timed out. Enter vehicle details manually.'
        : 'NHTSA VIN lookup is unavailable. Enter vehicle details manually.'
    });
  }
});

router.get('/parts/catalog-lookup', authenticateToken, async (req, res) => {
  const { jobId, partName } = req.query;

  try {
    const [vehicles] = await pool.query(
      'SELECT * FROM vehicles WHERE repair_job_id = ? AND company_id = ?',
      [jobId, req.user.company_id]
    );

    const car = vehicles[0] || {
      make: 'Project-Auto',
      model: 'Vehicle',
      year: '2022'
    };

    let basePrice = 50.00;
    const nameLower = (partName || '').toLowerCase();

    if (nameLower.includes('brake') || nameLower.includes('pad')) {
      basePrice = 89.99;
    }

    if (nameLower.includes('rotor')) {
      basePrice = 135.50;
    }

    if (nameLower.includes('spark') || nameLower.includes('plug')) {
      basePrice = 18.00;
    }

    if (
      nameLower.includes('alternator') ||
      nameLower.includes('starter')
    ) {
      basePrice = 240.00;
    }

    if (nameLower.includes('filter') || nameLower.includes('oil')) {
      basePrice = 22.50;
    }

    res.json({
      vehicle: `${car.year} ${car.make} ${car.model}`,
      part: partName,
      market_price: basePrice.toFixed(2)
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;