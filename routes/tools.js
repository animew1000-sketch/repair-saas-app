const express = require('express');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/vehicle/vin-lookup/:vin', authenticateToken, async (req, res) => {
  const vin = req.params.vin.toUpperCase();

  if (vin.length !== 17) {
    return res.status(400).json({
      error: 'VIN must be exactly 17 characters long.'
    });
  }

  const projectMakes = [
    'Apex-Motors',
    'Project-Auto',
    'Titan-Drive',
    'Vanguard-EV',
    'Hyperion-Motors'
  ];

  const projectModels = [
    'Interceptor',
    'Courier',
    'Falcon-X',
    'Omni-Truck',
    'Pioneer-SUV'
  ];

  const vinSum = vin
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);

  const simulatedMake =
    projectMakes[vinSum % projectMakes.length];

  const simulatedModel =
    projectModels[(vinSum * 7) % projectModels.length];

  const simulatedYear =
    2018 + (vinSum % 9);

  res.json({
    vin,
    make: simulatedMake,
    model: simulatedModel,
    year: simulatedYear.toString()
  });
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