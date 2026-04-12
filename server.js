const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Dossier de sauvegarde sur le disque Render
// Sur Render, le disque persistant est monté sur /data
const DATA_DIR = process.env.DATA_DIR || (process.platform === 'win32' ? 'C:\\YangoCRM_Data' : '/data');
const DB_FILE  = path.join(DATA_DIR, 'yango_crm_data.json');

// S'assurer que le dossier /data existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialiser le fichier de données s'il n'existe pas
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({
    notes: {},
    reminders: [],
    cstatus: {},
    callLogs: {},
    importHist: [],
    drivers: [],
    createdAt: new Date().toISOString()
  }, null, 2));
  console.log('✅ Fichier de données initialisé :', DB_FILE);
}

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ─── HELPERS ───────────────────────────────
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('Erreur lecture DB:', e.message);
    return { notes:{}, reminders:[], cstatus:{}, callLogs:{}, importHist:[], drivers:[] };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Erreur écriture DB:', e.message);
    return false;
  }
}

// ─── API ROUTES ────────────────────────────

// Lire toutes les données
app.get('/api/data', (req, res) => {
  const db = readDB();
  res.json({ success: true, data: db });
});

// Sauvegarder toutes les données (sync complet)
app.post('/api/data', (req, res) => {
  const ok = writeDB({ ...req.body, updatedAt: new Date().toISOString() });
  if (ok) {
    res.json({ success: true, message: 'Données sauvegardées sur le disque' });
  } else {
    res.status(500).json({ success: false, message: 'Erreur de sauvegarde' });
  }
});

// Sauvegarder un appel/note pour un chauffeur
app.post('/api/calls/:driverName', (req, res) => {
  const db = readDB();
  const key = decodeURIComponent(req.params.driverName);
  if (!db.callLogs) db.callLogs = {};
  if (!db.callLogs[key]) db.callLogs[key] = [];
  db.callLogs[key].unshift({ ...req.body, ts: Date.now() });
  const ok = writeDB(db);
  res.json({ success: ok });
});

// Sauvegarder un rappel
app.post('/api/reminders', (req, res) => {
  const db = readDB();
  if (!db.reminders) db.reminders = [];
  db.reminders.push({ ...req.body, id: 'rem_' + Date.now() });
  const ok = writeDB(db);
  res.json({ success: ok, id: req.body.id });
});

// Mettre à jour un rappel (done, etc.)
app.patch('/api/reminders/:id', (req, res) => {
  const db = readDB();
  const rem = db.reminders.find(r => r.id === req.params.id);
  if (rem) Object.assign(rem, req.body);
  const ok = writeDB(db);
  res.json({ success: ok });
});

// Supprimer un rappel
app.delete('/api/reminders/:id', (req, res) => {
  const db = readDB();
  db.reminders = (db.reminders || []).filter(r => r.id !== req.params.id);
  const ok = writeDB(db);
  res.json({ success: ok });
});

// Sauvegarder statut contact
app.post('/api/status', (req, res) => {
  const db = readDB();
  if (!db.cstatus) db.cstatus = {};
  db.cstatus[req.body.name] = req.body.status;
  const ok = writeDB(db);
  res.json({ success: ok });
});

// Importer des chauffeurs (CSV parsé côté client)
app.post('/api/drivers', (req, res) => {
  const db = readDB();
  db.drivers = req.body.drivers || [];
  db.importHist = req.body.importHist || db.importHist || [];
  const ok = writeDB(db);
  res.json({ success: ok, count: db.drivers.length });
});

// Export complet (téléchargement sauvegarde)
app.get('/api/export', (req, res) => {
  const db = readDB();
  res.setHeader('Content-Disposition', `attachment; filename="yango_crm_backup_${new Date().toISOString().split('T')[0]}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(db, null, 2));
});

// Sauvegarde synchrone (sendBeacon avant fermeture page)
app.post('/api/data-sync', (req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      writeDB({ ...data, updatedAt: new Date().toISOString() });
    } catch(e) {}
    res.status(200).end();
  });
});

// Santé du serveur
app.get('/api/health', (req, res) => {
  const db = readDB();
  const stats = {
    status: 'OK',
    uptime: process.uptime(),
    dbFile: DB_FILE,
    dbSize: fs.existsSync(DB_FILE) ? (fs.statSync(DB_FILE).size / 1024).toFixed(1) + ' KB' : '0 KB',
    notes: Object.keys(db.notes || {}).length,
    reminders: (db.reminders || []).length,
    callLogs: Object.keys(db.callLogs || {}).length,
    drivers: (db.drivers || []).length,
    lastUpdate: db.updatedAt || 'jamais'
  };
  res.json(stats);
});

// ─── PROXY COACH IA (GEMINI) ────────────────
// Utilise Google Gemini — gratuit avec clé Google AI Studio
app.post('/api/chat', async (req, res) => {
  const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
  if (!GEMINI_KEY) {
    return res.status(200).json({
      candidates: [{content:{parts:[{text:'⚠️ Clé API Gemini manquante. Allez dans Render → Environment → ajoutez GEMINI_API_KEY avec votre clé Google AI Studio.'}]}}]
    });
  }
  try {
    const https = require('https');
    // Convertir format messages en format Gemini
    const messages = req.body.messages || [];
    const systemPrompt = req.body.system || '';
    // Construire l'historique Gemini
    const contents = [];
    if(systemPrompt) {
      contents.push({role:'user', parts:[{text: systemPrompt}]});
      contents.push({role:'model', parts:[{text: 'Compris, je suis votre Coach Yango IA. Comment puis-je vous aider ?'}]});
    }
    messages.forEach(function(m) {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{text: m.content}]
      });
    });
    const geminiBody = JSON.stringify({
      contents: contents,
      generationConfig: { maxOutputTokens: 1000, temperature: 0.7 }
    });
    const path = '/v1beta/models/gemini-1.5-flash:generateContent?key=' + GEMINI_KEY;
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(geminiBody)
      }
    };
    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Convertir réponse Gemini → format attendu par le CRM
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || 'Pas de réponse';
          res.json({ content: [{type:'text', text: text}] });
        } catch(e) {
          res.status(500).json({content:[{type:'text',text:'Erreur de réponse: '+data.substring(0,100)}]});
        }
      });
    });
    apiReq.on('error', (e) => {
      res.status(500).json({content:[{type:'text',text:'Erreur réseau: '+e.message}]});
    });
    apiReq.write(geminiBody);
    apiReq.end();
  } catch (err) {
    res.status(500).json({content:[{type:'text',text:'Erreur: '+err.message}]});
  }
});

// Servir le CRM (toutes les routes → index.html)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚖 Yango CRM démarré sur le port ${PORT}`);
  console.log(`💾 Données sauvegardées dans : ${DB_FILE}`);
  console.log(`🌐 URL : http://localhost:${PORT}`);
});
