// server.js - Sicheres Backend für neightn App
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Sicherheits-Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://neightn.app', 'https://www.neightn.app'], // Deine App-Domain
  credentials: true
}));
app.use(express.json());

// Rate Limiting - maximal 100 Anfragen pro Minute pro IP
const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'middleware',
  points: 100, // Anzahl der erlaubten Anfragen
  duration: 60, // Zeitfenster in Sekunden
});

// Rate Limiter Middleware anwenden
app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    res.status(429).json({ error: 'Zu viele Anfragen. Versuche es später erneut.' });
  }
});

// Supabase Konfiguration aus Umgebungsvariablen laden
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Überprüfe ob alle erforderlichen Umgebungsvariablen vorhanden sind
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Fehler: SUPABASE_URL und SUPABASE_ANON_KEY müssen in der .env Datei definiert sein');
  process.exit(1);
}

// Hilfsfunktion: Device ID validieren (UUID Format)
function isValidDeviceId(id) {
  const uuidRegex = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
  return uuidRegex.test(id);
}

// Hilfsfunktion: Sichere Supabase API Aufrufe
async function callSupabase(endpoint, options = {}) {
  const defaultOptions = {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  // Optionen zusammenführen
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };

  const response = await fetch(`${SUPABASE_URL}${endpoint}`, mergedOptions);
  
  if (!response.ok) {
    throw new Error(`Supabase API Fehler: ${response.status} - ${response.statusText}`);
  }
  
  return await response.json();
}

// API Endpoints

// Health Check - Test ob der Server läuft
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    server: 'neightn-backend',
    version: '1.0.0'
  });
});

// Globale Variablen für einen Nutzer abrufen
app.get('/api/variables/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { key } = req.query;
    
    // Device ID Format validieren
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    // Supabase RPC Endpoint für Variablen abrufen
    let endpoint = `/rest/v1/rpc/get_user_variables?p_user_id=${userId}`;
    
    // Optional: Spezifischen Key filtern
    if (key) {
      endpoint += `&p_key=${encodeURIComponent(key)}`;
    }
    
    // Supabase API aufrufen
    const data = await callSupabase(endpoint);
    
    // Erfolgreiche Antwort senden
    res.json({
      success: true,
      data: data,
      userId: userId
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Abrufen der Variablen:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Abrufen der Variablen',
      code: 'VARIABLES_FETCH_ERROR'
    });
  }
});

// Variable erstellen oder aktualisieren
app.post('/api/variables/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { key, value, description } = req.body;
    
    // Eingabe validieren
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
    
    // Variable in Supabase speichern
    const variableData = {
      user_id: userId,
      key: key,
      value: value,
      description: description || null,
      updated_at: new Date().toISOString()
    };
    
    const data = await callSupabase('/rest/v1/global_variables', {
      method: 'POST',
      headers: {
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(variableData)
    });
    
    res.json({
      success: true,
      data: data,
      message: 'Variable erfolgreich gespeichert'
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Speichern der Variable:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Speichern der Variable',
      code: 'VARIABLE_SAVE_ERROR'
    });
  }
});

// Subscription erstellen oder erneuern
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
    
    // Subscription Daten vorbereiten
    const subscriptionData = {
      user_id: userId,
      status: plan,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 Tage Trial
      created_at: new Date().toISOString()
    };
    
    // Subscription in Supabase erstellen/aktualisieren
    const data = await callSupabase('/rest/v1/subscriptions?on_conflict=user_id', {
      method: 'POST',
      headers: {
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(subscriptionData)
    });
    
    res.json({ 
      success: true, 
      subscription: data[0] || data,
      message: 'Subscription erfolgreich aktiviert'
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Erstellen der Subscription:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Erstellen der Subscription',
      code: 'SUBSCRIPTION_CREATE_ERROR'
    });
  }
});

// Subscription Status prüfen
app.get('/api/subscription/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    // Aktuelle Zeit für Vergleich
    const now = new Date().toISOString();
    
    // Aktive Subscriptions abfragen
    const endpoint = `/rest/v1/subscriptions?user_id=eq.${userId}&expires_at=gt.${now}`;
    const data = await callSupabase(endpoint);
    
    const hasActiveSubscription = data.length > 0;
    const subscription = data[0] || null;
    
    res.json({ 
      success: true,
      hasActiveSubscription: hasActiveSubscription,
      subscription: subscription,
      userId: userId
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Prüfen der Subscription:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Prüfen der Subscription',
      code: 'SUBSCRIPTION_CHECK_ERROR'
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
    
    // Variable aus Supabase löschen
    const endpoint = `/rest/v1/global_variables?user_id=eq.${userId}&key=eq.${encodeURIComponent(key)}`;
    
    await callSupabase(endpoint, {
      method: 'DELETE'
    });
    
    res.json({
      success: true,
      message: 'Variable erfolgreich gelöscht'
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Löschen der Variable:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Löschen der Variable',
      code: 'VARIABLE_DELETE_ERROR'
    });
  }
});

// 404 Handler für unbekannte Routen
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint nicht gefunden',
    code: 'NOT_FOUND'
  });
});

// Globaler Error Handler
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
  console.log(`⏰ ${new Date().toISOString()}`);
});