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
// Ergänzung für server.js - Automatische Workflow-Erstellung

// Beispiel-Workflow Template (vereinfacht)
const EXAMPLE_WORKFLOW_TEMPLATE = {
  "name": "🎯 neightn Starter Workflow",
  "nodes": [
    {
      "parameters": {},
      "id": "manual_trigger",
      "name": "🚀 Manueller Start",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [240, 300]
    },
    {
      "parameters": {
        "httpMethod": "GET",
        "url": "https://api.eab-solutions.net/api/variables/USER_DEVICE_ID",
        "options": {}
      },
      "id": "get_variables",
      "name": "📋 Meine Variablen abrufen",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [460, 300]
    }
  ],
  "connections": {
    "🚀 Manueller Start": {
      "main": [
        [
          {
            "node": "📋 Meine Variablen abrufen",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
};

// n8n API Helper Funktionen
async function createWorkflowInN8n(userId, userN8nUrl, userN8nApiKey) {
  try {
    console.log(`🎯 Creating example workflow for user: ${userId}`);
    
    // Workflow Template anpassen für den User
    const workflow = JSON.parse(JSON.stringify(EXAMPLE_WORKFLOW_TEMPLATE));
    
    // Device ID in allen URLs ersetzen
    const replaceDeviceId = (obj) => {
      if (typeof obj === 'string') {
        return obj.replace('USER_DEVICE_ID', userId);
      }
      if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          return obj.map(replaceDeviceId);
        }
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = replaceDeviceId(value);
        }
        return result;
      }
      return obj;
    };
    
    const personalizedWorkflow = replaceDeviceId(workflow);
    
    // n8n API aufrufen
    const response = await fetch(`${userN8nUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': userN8nApiKey
      },
      body: JSON.stringify(personalizedWorkflow)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`n8n API Error: ${response.status} - ${errorText}`);
    }
    
    const createdWorkflow = await response.json();
    console.log(`✅ Workflow created successfully: ${createdWorkflow.id}`);
    
    return {
      success: true,
      workflowId: createdWorkflow.id,
      workflowName: personalizedWorkflow.name
    };
    
  } catch (error) {
    console.error(`❌ Failed to create workflow for user ${userId}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Willkommens-Variablen erstellen
async function createWelcomeVariables(userId) {
  try {
    console.log(`📝 Creating welcome variables for user: ${userId}`);
    
    const welcomeVariables = [
      {
        key: 'WELCOME_MESSAGE',
        value: 'Herzlich willkommen bei neightn! 🎉',
        description: 'Automatisch erstellte Willkommensnachricht'
      },
      {
        key: 'API_EXAMPLE',
        value: 'Beispiel für API-Integration',
        description: 'Diese Variable zeigt, wie du Daten zwischen App und n8n austauschen kannst'
      },
      {
        key: 'SUBSCRIPTION_STARTED',
        value: new Date().toISOString(),
        description: 'Zeitstempel wann die Subscription gestartet wurde'
      }
    ];
    
    const results = [];
    
    for (const variable of welcomeVariables) {
      try {
        const data = await callSupabase('/rest/v1/global_variables', {
          method: 'POST',
          headers: {
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            user_id: userId,
            key: variable.key,
            value: variable.value,
            description: variable.description,
            variable_type: 'string',
            updated_at: new Date().toISOString()
          })
        });
        
        results.push({
          success: true,
          variable: variable.key
        });
        
        console.log(`✅ Created variable: ${variable.key}`);
        
      } catch (error) {
        console.error(`❌ Failed to create variable ${variable.key}:`, error.message);
        results.push({
          success: false,
          variable: variable.key,
          error: error.message
        });
      }
    }
    
    return results;
    
  } catch (error) {
    console.error(`❌ Failed to create welcome variables for user ${userId}:`, error.message);
    return [];
  }
}

// Erweiterte Subscription-Erstellung mit Workflow
app.post('/api/subscription/:userId/with-workflow', async (req, res) => {
  try {
    const { userId } = req.params;
    const { plan = 'trial', n8nUrl, n8nApiKey } = req.body;
    
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    console.log(`🚀 Creating subscription with workflow for user: ${userId}`);
    
    // 1. Subscription erstellen
    const subscriptionData = {
      user_id: userId,
      status: plan,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      started_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    
    const subscriptionResult = await callSupabase('/rest/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(subscriptionData)
    });
    
    console.log(`✅ Subscription created successfully`);
    
    // 2. Willkommens-Variablen erstellen
    const variablesResult = await createWelcomeVariables(userId);
    
    // 3. n8n Workflow erstellen (optional)
    let workflowResult = { success: false, error: 'n8n credentials not provided' };
    
    if (n8nUrl && n8nApiKey) {
      workflowResult = await createWorkflowInN8n(userId, n8nUrl, n8nApiKey);
    }
    
    // 4. Response zusammenstellen
    res.json({ 
      success: true, 
      subscription: subscriptionResult[0] || subscriptionResult,
      variables: variablesResult,
      workflow: workflowResult,
      message: 'Subscription mit Beispiel-Setup erfolgreich erstellt'
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Erstellen der erweiterten Subscription:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Erstellen der Subscription mit Workflow',
      code: 'SUBSCRIPTION_WORKFLOW_CREATE_ERROR',
      details: error.message
    });
  }
});

// Workflow-Template abrufen
app.get('/api/workflow-template/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!isValidDeviceId(userId)) {
      return res.status(400).json({ 
        error: 'Ungültige Device ID Format',
        code: 'INVALID_DEVICE_ID'
      });
    }
    
    // Template personalisieren
    const workflow = JSON.parse(JSON.stringify(EXAMPLE_WORKFLOW_TEMPLATE));
    
    // Device ID in URLs ersetzen
    const workflowString = JSON.stringify(workflow);
    const personalizedWorkflowString = workflowString.replace(/USER_DEVICE_ID/g, userId);
    const personalizedWorkflow = JSON.parse(personalizedWorkflowString);
    
    res.json({
      success: true,
      workflow: personalizedWorkflow,
      instructions: {
        title: "So importierst du den Workflow in n8n:",
        steps: [
          "1. Öffne deine n8n-Instanz",
          "2. Klicke auf 'Neuer Workflow'",
          "3. Klicke auf die drei Punkte (⋯) → 'Import from JSON'",
          "4. Kopiere den Workflow-Code unten",
          "5. Füge ihn ein und klicke 'Import'",
          "6. Speichere den Workflow",
          "7. Klicke auf 'Execute Workflow' zum Testen"
        ]
      }
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Generieren des Workflow-Templates:', error.message);
    res.status(500).json({ 
      error: 'Fehler beim Generieren des Workflow-Templates',
      code: 'WORKFLOW_TEMPLATE_ERROR'
    });
  }
});
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
