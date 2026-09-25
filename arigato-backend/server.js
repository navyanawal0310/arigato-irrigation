const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
let espIp = process.env.ESP32_IP || '10.110.8.97';
let pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);
let autoPollEnabled = process.env.AUTO_POLL_ENABLED !== 'false';

let mongoClient = null;
let db = null;
let telemetryCollection = null;
let eventsCollection = null;

let isMongoConnected = false;
let lastTelemetryReceived = null;
let lastPumpState = false;
let isHardwareOnline = false;
let hardwareOfflineCount = 0;
let pollerTimer = null;

// ============================================================
// 1. MONGODB CONNECTION SETUP & INDEXING
// ============================================================
async function connectToMongo() {
  if (!MONGODB_URI) {
    console.error('[DATABASE] ERROR: MONGODB_URI is not defined in .env');
    return;
  }

  try {
    console.log('[DATABASE] Connecting to MongoDB Atlas...');
    mongoClient = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });

    await mongoClient.connect();
    db = mongoClient.db('arigato_iot');
    telemetryCollection = db.collection('telemetry');
    eventsCollection = db.collection('events');

    // Create Indexes for fast querying
    await telemetryCollection.createIndex({ timestamp: -1 });
    await telemetryCollection.createIndex({ "system.anomaly": 1 });
    await telemetryCollection.createIndex({ "controller.action": 1 });
    await eventsCollection.createIndex({ timestamp: -1 });

    isMongoConnected = true;
    console.log('[DATABASE] Successfully connected to MongoDB Atlas (Cluster0)!');
    console.log('[DATABASE] Database: arigato_iot | Collections: telemetry, events');
  } catch (err) {
    isMongoConnected = false;
    console.error('[DATABASE] Connection error:', err.message);
    console.log('[DATABASE] Retrying connection in 5 seconds...');
    setTimeout(connectToMongo, 5000);
  }
}

// ============================================================
// 2. TELEMETRY NORMALIZATION & EVENT DETECTION
// ============================================================
function normalizeTelemetry(raw, source = 'esp32_poller') {
  const timestamp = new Date();

  const doc = {
    timestamp: timestamp,
    system: {
      name: raw.system?.name || 'AquaMatrix-MaxCore',
      firmware: raw.system?.firmware || '6.5.0-NIRMAAN-MAX',
      uptime_sec: Number(raw.system?.uptime_sec || 0),
      free_heap: Number(raw.system?.free_heap || 0),
      wifi_rssi: Number(raw.system?.wifi_rssi || 0),
      wifi_status: raw.system?.wifi_status || 'CONNECTED',
      anomaly: raw.system?.anomaly || raw.controller?.anomaly || raw.decision?.anomaly || 'NONE',
    },
    crop: {
      profile_id: raw.crop?.profile_id || 'TOMATO_VEG',
      name: raw.crop?.name || 'Tomato (Vegetative)',
      kc_factor: Number(raw.crop?.kc_factor || 0.85),
      base_temp_c: Number(raw.crop?.base_temp_c || 10.0),
      mad_threshold_pct: Number(raw.crop?.mad_threshold_pct || 50.0),
    },
    soil: {
      raw_adc: Number(raw.soil?.raw_adc ?? raw.soil?.adc_raw ?? 0),
      moisture_pct: Number(raw.soil?.moisture_pct ?? raw.soil?.moisture_index ?? 0),
      dryness_pct: Number(raw.soil?.dryness_pct ?? raw.soil?.dryness ?? 0),
      status: raw.soil?.status || 'UNKNOWN',
    },
    rain_sensor: {
      raw_adc: Number(raw.rain_sensor?.raw_adc ?? 4095),
      surface_wetness_pct: Number(raw.rain_sensor?.surface_wetness_pct ?? 0),
      is_raining: Boolean(raw.rain_sensor?.is_raining),
    },
    reservoir: {
      distance_cm: Number(raw.reservoir?.distance_cm ?? 0),
      level_pct: Number(raw.reservoir?.level_pct ?? raw.reservoir?.level_percent ?? 0),
      storage_litres: Number(raw.reservoir?.storage_litres ?? ((raw.reservoir?.water_ml || 0) / 1000)),
      inflow_rate_lph: Number(raw.reservoir?.inflow_rate_lph ?? 0),
      status: raw.reservoir?.status || 'UNKNOWN',
    },
    atmosphere: {
      temp_c: Number(raw.atmosphere?.temp_c ?? raw.weather?.temp_c ?? 25.0),
      humidity_pct: Number(raw.atmosphere?.humidity_pct ?? raw.weather?.humidity_pct ?? 60.0),
      vpd_kpa: Number(raw.atmosphere?.vpd_kpa ?? 0.0),
      dew_point_c: Number(raw.atmosphere?.dew_point_c ?? 0.0),
      gdd_step: Number(raw.atmosphere?.gdd_step ?? 0.0),
      forecast_rain_mm: Number(raw.atmosphere?.forecast_rain_mm ?? raw.weather?.rain_forecast_mm ?? 0.0),
      et0_fao56_mm: Number(raw.atmosphere?.et0_fao56_mm ?? raw.weather?.et0_fao56_mm ?? 4.5),
      api_synced: Boolean(raw.atmosphere?.api_synced ?? raw.weather?.api_synced),
      weather_source: raw.atmosphere?.weather_source ?? raw.weather?.source ?? 'FALLBACK_OFFLINE',
    },
    disease: {
      risk_level: raw.disease?.risk_level ?? raw.pathology?.risk_index ?? 'LOW',
      reason: raw.disease?.reason ?? raw.pathology?.reasoning ?? 'Nominal microclimate',
    },
    drainage: {
      infiltration_rate_pct_min: Number(raw.drainage?.infiltration_rate_pct_min ?? 0.0),
      status: raw.drainage?.status || 'STABLE',
    },
    model: {
      crop_et_mm: Number(raw.model?.crop_et_mm ?? 0),
      effective_rain_mm: Number(raw.model?.effective_rain_mm ?? 0),
      net_demand_mm: Number(raw.model?.net_demand_mm ?? 0),
      prescribed_litres: Number(raw.model?.prescribed_litres ?? 0),
      run_duration_sec: Number(raw.model?.run_duration_sec ?? 0),
      harvest_potential_l: Number(raw.model?.harvest_potential_l ?? 0),
    },
    controller: {
      action: raw.controller?.action || raw.decision?.action || 'STANDBY',
      reason: raw.controller?.reason || raw.decision?.reason || 'Nominal operation',
      pump_active: Boolean(raw.controller?.pump_active ?? raw.decision?.pump_active),
      est_runtime_sec: Number(raw.controller?.est_runtime_sec ?? 0),
      confidence_percent: Number(raw.controller?.confidence_percent ?? raw.decision?.confidence_percent ?? 100),
    },
    nvs: {
      daily_water_litres: Number(raw.nvs?.daily_water_litres ?? 0),
      total_water_litres: Number(raw.nvs?.total_water_litres ?? 0),
      pump_cycles_count: Number(raw.nvs?.pump_cycles_count ?? 0),
      water_saved_litres: Number(raw.nvs?.water_saved_litres ?? 0),
    },
    metadata: {
      source: source,
      esp_ip: espIp,
      ingested_at: timestamp,
    }
  };

  return doc;
}

async function recordTelemetry(rawPayload, source = 'esp32_poller') {
  if (!isMongoConnected || !telemetryCollection) {
    throw new Error('Database not connected');
  }

  const doc = normalizeTelemetry(rawPayload, source);
  const result = await telemetryCollection.insertOne(doc);
  lastTelemetryReceived = doc;

  // Event Tracking: Pump state changes
  const currentPumpState = doc.controller.pump_active;
  if (currentPumpState !== lastPumpState) {
    const eventType = currentPumpState ? 'PUMP_STARTED' : 'PUMP_STOPPED';
    const eventDoc = {
      timestamp: new Date(),
      type: eventType,
      action: doc.controller.action,
      reason: doc.controller.reason,
      prescribed_litres: doc.model.prescribed_litres,
      soil_moisture_pct: doc.soil.moisture_pct,
      tank_level_pct: doc.reservoir.level_pct,
      source: source,
    };
    await eventsCollection.insertOne(eventDoc).catch(e => console.error('[EVENT] Save error:', e.message));
    console.log(`[EVENT] ${eventType}: ${doc.controller.reason}`);
    lastPumpState = currentPumpState;
  }

  // Event Tracking: Anomaly Triggered
  if (doc.system.anomaly !== 'NONE' && doc.system.anomaly !== 'NORMAL') {
    const anomalyDoc = {
      timestamp: new Date(),
      type: 'ANOMALY_DETECTED',
      anomaly: doc.system.anomaly,
      action: doc.controller.action,
      reason: doc.controller.reason,
    };
    await eventsCollection.insertOne(anomalyDoc).catch(() => {});
  }

  return { id: result.insertedId, doc };
}

// ============================================================
// 3. BACKGROUND HARDWARE POLLER
// ============================================================
async function pollHardware() {
  if (!autoPollEnabled || !espIp) return;

  const url = `http://${espIp}/api/status`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    isHardwareOnline = true;
    hardwareOfflineCount = 0;

    await recordTelemetry(data, 'esp32_poller');
    console.log(`[POLLER] Synced ESP32 (${espIp}) -> MongoDB | Soil: ${data.soil?.moisture_index ?? data.soil?.moisture_pct}% | Tank: ${data.reservoir?.level_percent ?? data.reservoir?.level_pct}% | Pump: ${data.decision?.pump_active ? 'ON' : 'OFF'}`);
  } catch (err) {
    clearTimeout(timeoutId);
    hardwareOfflineCount++;
    if (hardwareOfflineCount >= 3) {
      isHardwareOnline = false;
    }
    // Only log periodically to prevent terminal flooding
    if (hardwareOfflineCount === 1 || hardwareOfflineCount % 10 === 0) {
      console.log(`[POLLER] ESP32 unreachable at http://${espIp}/api/status (${err.name === 'AbortError' ? 'Timeout' : err.message}). Waiting for hardware...`);
    }
  }
}

function startPoller() {
  if (pollerTimer) clearInterval(pollerTimer);
  console.log(`[POLLER] Started polling ESP32 at http://${espIp}/api/status every ${pollIntervalMs}ms`);
  pollHardware();
  pollerTimer = setInterval(pollHardware, pollIntervalMs);
}

// ============================================================
// 4. REST API ROUTES
// ============================================================

// System Health & Diagnostics
app.get('/api/health', async (req, res) => {
  let docCount = 0;
  let eventCount = 0;
  if (isMongoConnected && telemetryCollection) {
    try {
      docCount = await telemetryCollection.countDocuments();
      eventCount = await eventsCollection.countDocuments();
    } catch {
      // count ignore
    }
  }

  res.json({
    status: 'ONLINE',
    service: 'Arigato MongoDB Telemetry Engine',
    database: {
      connected: isMongoConnected,
      cluster: 'Cluster0 (Atlas)',
      database_name: 'arigato_iot',
      records_recorded: docCount,
      events_recorded: eventCount,
    },
    hardware_poller: {
      enabled: autoPollEnabled,
      esp32_ip: espIp,
      poll_interval_ms: pollIntervalMs,
      hardware_online: isHardwareOnline,
      target_url: `http://${espIp}/api/status`,
    },
    latest_telemetry: lastTelemetryReceived ? {
      timestamp: lastTelemetryReceived.timestamp,
      soil_moisture_pct: lastTelemetryReceived.soil.moisture_pct,
      tank_level_pct: lastTelemetryReceived.reservoir.level_pct,
      pump_active: lastTelemetryReceived.controller.pump_active,
      action: lastTelemetryReceived.controller.action,
    } : null,
  });
});

// POST /api/telemetry - Receive live telemetry pushed from ESP32 or Dashboard
app.post('/api/telemetry', async (req, res) => {
  try {
    const rawData = req.body;
    if (!rawData || typeof rawData !== 'object') {
      return res.status(400).json({ status: 'ERROR', message: 'Invalid payload: JSON object expected' });
    }

    const source = req.query.source || 'esp32_direct_push';
    const { id, doc } = await recordTelemetry(rawData, source);

    return res.status(201).json({
      status: 'RECORDED',
      message: 'Telemetry successfully written to MongoDB Atlas',
      inserted_id: id,
      timestamp: doc.timestamp,
    });
  } catch (err) {
    console.error('[API] /api/telemetry error:', err.message);
    return res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// GET /api/telemetry/latest - Return the most recent telemetry document
app.get('/api/telemetry/latest', async (req, res) => {
  try {
    if (!isMongoConnected || !telemetryCollection) {
      return res.status(503).json({ status: 'ERROR', message: 'MongoDB not connected' });
    }

    const doc = await telemetryCollection.findOne({}, { sort: { timestamp: -1 } });
    if (!doc) {
      return res.status(404).json({ status: 'EMPTY', message: 'No telemetry records stored yet' });
    }

    res.json({ status: 'OK', data: doc });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// GET /api/telemetry/history - Return time-series history
app.get('/api/telemetry/history', async (req, res) => {
  try {
    if (!isMongoConnected || !telemetryCollection) {
      return res.status(503).json({ status: 'ERROR', message: 'MongoDB not connected' });
    }

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
    const filter = {};

    if (req.query.from) {
      filter.timestamp = { $gte: new Date(req.query.from) };
    }
    if (req.query.to) {
      filter.timestamp = filter.timestamp || {};
      filter.timestamp.$lte = new Date(req.query.to);
    }

    const records = await telemetryCollection
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    res.json({
      status: 'OK',
      count: records.length,
      limit: limit,
      data: records,
    });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// GET /api/telemetry/events - Return logged system events (pumps, alarms, trips)
app.get('/api/telemetry/events', async (req, res) => {
  try {
    if (!isMongoConnected || !eventsCollection) {
      return res.status(503).json({ status: 'ERROR', message: 'MongoDB not connected' });
    }

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const events = await eventsCollection
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    res.json({ status: 'OK', count: events.length, data: events });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// GET /api/telemetry/stats - Aggregate stats
app.get('/api/telemetry/stats', async (req, res) => {
  try {
    if (!isMongoConnected || !telemetryCollection) {
      return res.status(503).json({ status: 'ERROR', message: 'MongoDB not connected' });
    }

    const totalRecords = await telemetryCollection.countDocuments();
    const latestDoc = await telemetryCollection.findOne({}, { sort: { timestamp: -1 } });
    const oldestDoc = await telemetryCollection.findOne({}, { sort: { timestamp: 1 } });

    // Aggregate averages over the last 100 samples
    const recentSamples = await telemetryCollection
      .find({})
      .sort({ timestamp: -1 })
      .limit(100)
      .project({
        'soil.moisture_pct': 1,
        'reservoir.level_pct': 1,
        'atmosphere.temp_c': 1,
        'atmosphere.humidity_pct': 1,
      })
      .toArray();

    let avgMoisture = 0;
    let avgTank = 0;
    let avgTemp = 0;
    let avgHumidity = 0;

    if (recentSamples.length > 0) {
      avgMoisture = recentSamples.reduce((sum, d) => sum + (d.soil?.moisture_pct || 0), 0) / recentSamples.length;
      avgTank = recentSamples.reduce((sum, d) => sum + (d.reservoir?.level_pct || 0), 0) / recentSamples.length;
      avgTemp = recentSamples.reduce((sum, d) => sum + (d.atmosphere?.temp_c || 0), 0) / recentSamples.length;
      avgHumidity = recentSamples.reduce((sum, d) => sum + (d.atmosphere?.humidity_pct || 0), 0) / recentSamples.length;
    }

    res.json({
      status: 'OK',
      total_records: totalRecords,
      timespan: {
        first_record: oldestDoc ? oldestDoc.timestamp : null,
        latest_record: latestDoc ? latestDoc.timestamp : null,
      },
      averages_recent_100: {
        soil_moisture_pct: Number(avgMoisture.toFixed(1)),
        reservoir_level_pct: Number(avgTank.toFixed(1)),
        temperature_c: Number(avgTemp.toFixed(1)),
        humidity_pct: Number(avgHumidity.toFixed(1)),
      },
      latest_snapshot: latestDoc ? {
        soil_moisture_pct: latestDoc.soil.moisture_pct,
        reservoir_level_pct: latestDoc.reservoir.level_pct,
        pump_active: latestDoc.controller.pump_active,
        daily_water_litres: latestDoc.nvs.daily_water_litres,
        total_water_litres: latestDoc.nvs.total_water_litres,
        pump_cycles_count: latestDoc.nvs.pump_cycles_count,
        water_saved_litres: latestDoc.nvs.water_saved_litres,
        action: latestDoc.controller.action,
        reason: latestDoc.controller.reason,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

// POST /api/config/esp-ip - Change ESP32 IP dynamically
app.post('/api/config/esp-ip', (req, res) => {
  const { ip, intervalMs, autoPoll } = req.body;
  if (ip && typeof ip === 'string') {
    espIp = ip.trim();
    console.log(`[CONFIG] Updated ESP32 IP to: ${espIp}`);
  }
  if (intervalMs && Number(intervalMs) >= 1000) {
    pollIntervalMs = Number(intervalMs);
  }
  if (autoPoll !== undefined) {
    autoPollEnabled = Boolean(autoPoll);
  }

  startPoller();
  res.json({
    status: 'OK',
    message: 'Configuration updated successfully',
    esp32_ip: espIp,
    poll_interval_ms: pollIntervalMs,
    auto_poll: autoPollEnabled,
  });
});

// GET /api/export/csv - Export telemetry to CSV
app.get('/api/export/csv', async (req, res) => {
  try {
    if (!isMongoConnected || !telemetryCollection) {
      return res.status(503).send('MongoDB not connected');
    }

    const limit = Math.min(parseInt(req.query.limit || '1000', 10), 5000);
    const records = await telemetryCollection
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    const header = [
      'Timestamp',
      'Soil_Moisture_%',
      'Soil_Raw_ADC',
      'Reservoir_Level_%',
      'Reservoir_Litres',
      'Rain_Detected',
      'Rain_Surface_%',
      'Temperature_C',
      'Humidity_%',
      'VPD_kPa',
      'Crop_Profile',
      'Prescribed_Litres',
      'Pump_Active',
      'Action',
      'Reason',
      'Daily_Water_L',
      'Total_Water_L',
      'Source'
    ].join(',');

    const rows = records.map(r => [
      `"${r.timestamp ? r.timestamp.toISOString() : ''}"`,
      r.soil?.moisture_pct ?? '',
      r.soil?.raw_adc ?? '',
      r.reservoir?.level_pct ?? '',
      r.reservoir?.storage_litres ?? '',
      r.rain_sensor?.is_raining ? 'YES' : 'NO',
      r.rain_sensor?.surface_wetness_pct ?? '',
      r.atmosphere?.temp_c ?? '',
      r.atmosphere?.humidity_pct ?? '',
      r.atmosphere?.vpd_kpa ?? '',
      `"${r.crop?.name || ''}"`,
      r.model?.prescribed_litres ?? '',
      r.controller?.pump_active ? 'ON' : 'OFF',
      `"${(r.controller?.action || '').replace(/"/g, '""')}"`,
      `"${(r.controller?.reason || '').replace(/"/g, '""')}"`,
      r.nvs?.daily_water_litres ?? '',
      r.nvs?.total_water_litres ?? '',
      `"${r.metadata?.source || ''}"`
    ].join(','));

    const csvContent = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="arigato_telemetry_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).send('Error generating CSV: ' + err.message);
  }
});

// ============================================================
// 5. SERVER STARTUP
// ============================================================
async function startServer() {
  await connectToMongo();

  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  ARIGATO MONGODB IOT RECORDER SERVICE ONLINE`);
    console.log(`  Local API Server : http://localhost:${PORT}`);
    console.log(`  Health Check     : http://localhost:${PORT}/api/health`);
    console.log(`  Latest Telemetry : http://localhost:${PORT}/api/telemetry/latest`);
    console.log(`  Telemetry History: http://localhost:${PORT}/api/telemetry/history`);
    console.log(`  Target ESP32     : http://${espIp}/api/status`);
    console.log(`======================================================\n`);

    startPoller();
  });
}

startServer();
