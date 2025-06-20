// server.js - Mit RPC-Funktion
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Einfacher Rate Limiter
const requestCounts = new Map();
const RATE_LIMIT = 100;
const WINDOW_MS = 60 * 1000;

function simpleRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  for (const [key, data] of requestCounts.entries()) {
    if (now - data.windowStart > WINDOW_MS) {
      requestCounts.delete(key);
    }
  }
  
  const userRequests = requestCounts.get(ip);
  
  if (!userRequests) {
    requestCounts.set(ip, { count: 1, windowStart: now });
    next();
  } else if (now - userRequests.windowStart > WINDOW_MS) {
    requestCounts.set(ip, { count: 1, windowStart: now });
    next();
  } else if (userRequests.count >= RATE_LIMIT) {
    res.status(429).json({ error: 'Zu viele Anfragen' });
  } else {
    userRequests.count++;
    next();
  }
}

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://neightn.app', 'https://www.neightn.app', 'https://n8n.eab-solutions.net'],
  credentials: true
}));
app.use(express.json());
app.use(simpleRateLimit);

// Supabase Konfiguration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL und SUPABASE_ANON_KEY müssen definiert sein');
  process.exit(1);
}

// Helper Funktionen
function isValidDeviceId(id) {
  const uuidRegex = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
  return uuidRegex.test(id);
}

async function callSupabase(endpoint, options = {}) {
  const defaultOptions = {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };

  const url = `${SUPABASE_URL}${endpoint}`;
  console.log(`📡 Calling: ${url}`);
  
  const response = await fetch(url, mergedOptions);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Supabase Error: ${response.status} - ${errorText}`);
    throw new Error(`Supabase API Fehler: ${response.status} - ${errorText}`);
  }
  
  return await response.json();
}

// API Endpoints

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    server: 'neightn-backend',
    version: '1.0.0'
  });
});

// Variablen abrufen - MIT RPC-Funktion
app.get('/api/variables/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { key } = req.query;
    
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    // RPC-Funktion aufrufen
    let endpoint = `/rest/v1/rpc/get_user_variables`;
    const params = new URLSearchParams();
    params.append('p_user_id', userId);
    
    if (key) {
      params.append('p_key', key);
    }
    
    endpoint += `?${params.toString()}`;
    
    console.log(`🔍 Fetching variables for user: ${userId}, key: ${key || 'all'}`);
    
    const data = await callSupabase(endpoint);
    
    console.log(`✅ Got ${Array.isArray(data) ? data.length : 'unknown'} variables`);
    
    res.json({
      success: true,
      data: data,
      userId: userId
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Variablen:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Abrufen der Variablen',
      code: 'VARIABLES_FETCH_ERROR',
      details: error.message
    });
  }
});

// Subscription Status prüfen - Direkte Tabellen-Abfrage (das funktioniert)
app.get('/api/subscription/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    console.log(`🔍 Checking subscription for user: ${userId}`);
    
    const now = new Date().toISOString();
    const endpoint = `/rest/v1/subscriptions?user_id=eq.${userId}&expires_at=gt.${now}`;
    
    const data = await callSupabase(endpoint);
    
    console.log(`✅ Found ${data.length} active subscriptions`);
    
    res.json({ 
      success: true,
      hasActiveSubscription: data.length > 0,
      subscription: data[0] || null,
      userId: userId
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Prüfen der Subscription:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Prüfen der Subscription',
      code: 'SUBSCRIPTION_CHECK_ERROR',
      details: error.message
    });
  }
});

// Variable erstellen - Direkte Tabellen-Einfügung
app.post('/api/variables/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { key, value, description } = req.body;
    
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    if (!key || !value) {
      return res.status(400).json({ 
        error: 'Key und Value sind erforderlich',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    console.log(`📝 Creating variable: ${key} = ${value} for user: ${userId}`);
    
    const variableData = {
      user_id: userId,
      key: key,
      value: value,
      description: description || '',
      variable_type: 'string',
      updated_at: new Date().toISOString()
    };
    
    const data = await callSupabase('/rest/v1/global_variables', {
      method: 'POST',
      headers: {
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(variableData)
    });
    
    console.log(`✅ Variable created successfully`);
    
    res.json({
      success: true,
      data: data,
      message: 'Variable erfolgreich gespeichert'
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Speichern der Variable:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Speichern der Variable',
      code: 'VARIABLE_SAVE_ERROR',
      details: error.message
    });
  }
});

// Subscription erstellen
app.post('/api/subscription/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { plan = 'trial' } = req.body;
    
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    console.log(`📝 Creating subscription for user: ${userId}, plan: ${plan}`);
    
    const subscriptionData = {
      user_id: userId,
      status: plan,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    
    const data = await callSupabase('/rest/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(subscriptionData)
    });
    
    console.log(`✅ Subscription created successfully`);
    
    res.json({ 
      success: true, 
      subscription: data[0] || data,
      message: 'Subscription erfolgreich aktiviert'
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Erstellen der Subscription:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Erstellen der Subscription',
      code: 'SUBSCRIPTION_CREATE_ERROR',
      details: error.message
    });
  }
});

// Variable löschen
app.delete('/api/variables/:userId/:key', async (req, res) => {
  try {
    const { userId, key } = req.params;
    
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    console.log(`🗑️ Deleting variable: ${key} for user: ${userId}`);
    
    const endpoint = `/rest/v1/global_variables?user_id=eq.${userId}&key=eq.${encodeURIComponent(key)}`;
    
    await callSupabase(endpoint, {
      method: 'DELETE'
    });
    
    console.log(`✅ Variable deleted successfully`);
    
    res.json({
      success: true,
      message: 'Variable erfolgreich gelöscht'
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Löschen der Variable:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Löschen der Variable',
      code: 'VARIABLE_DELETE_ERROR',
      details: error.message
    });
  }
});

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint nicht gefunden',
    code: 'NOT_FOUND'
  });
});

// Error Handler
app.use((error, req, res, next) => {
  console.error('❌ Unerwarteter Fehler:', error);
  res.status(500).json({ 
    error: 'Interner Server Fehler',
    code: 'INTERNAL_ERROR'
  });
});

// Server starten
app.listen(port, () => {
  console.log(`🚀 neightn Backend läuft auf Port ${port}`);
  console.log(`📋 Health Check: http://localhost:${port}/health`);
  console.log(`🔒 Supabase API-Schlüssel sind sicher versteckt`);
  console.log(`📊 Supabase URL: ${SUPABASE_URL}`);
});
