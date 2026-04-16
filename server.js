const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Dossier de sauvegarde sur le disque Render
// Sur Render, le disque persistant est monté sur /data
const DATA_DIR = process.env.DATA_DIR || (process.platform === 'win32' ? 'C:\\YangoCRM_Data' : '/data');
const DB_FILE   = path.join(DATA_DIR, 'yango_crm_data.json');
const USERS_FILE = path.join(DATA_DIR, 'yango_users.json');

// Lire/écrire les utilisateurs (fichier séparé plus fiable)
function readUsers(){
  // Toujours inclure le directeur par défaut
  const defaultDir = {
    id:'dir_001', username:'directeur', password:'ndongo2024',
    nom:'Ndongo Fall', role:'directeur', actif:true
  };
  try {
    if(fs.existsSync(USERS_FILE)){
      const data = JSON.parse(fs.readFileSync(USERS_FILE,'utf8'));
      const users = data.users || [];
      // Toujours avoir le directeur
      if(!users.find(u=>u.id==='dir_001')) users.unshift(defaultDir);
      return users;
    }
  } catch(e){ console.error('readUsers error:', e.message); }
  return [defaultDir];
}

function writeUsers(users){
  try {
    // Toujours avoir le directeur
    const defaultDir = {
      id:'dir_001', username:'directeur', password:'ndongo2024',
      nom:'Ndongo Fall', role:'directeur', actif:true
    };
    if(!users.find(u=>u.id==='dir_001')) users.unshift(defaultDir);
    fs.writeFileSync(USERS_FILE, JSON.stringify({users, updatedAt:new Date().toISOString()}, null, 2));
    console.log('Users saved:', users.length, 'users:', users.map(u=>u.username).join(', '));
    return true;
  } catch(e){ console.error('writeUsers error:', e.message); return false; }
}

// S'assurer que le dossier de données existe
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch(e) {
  console.warn('Impossible de créer DATA_DIR:', e.message, '— utilisation du dossier courant');
  // Fallback au dossier courant si /data inaccessible
  const fallbackDir = path.join(__dirname, 'data');
  if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
  process.env.DATA_DIR = fallbackDir;
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

// ─── GESTION DES UTILISATEURS ──────────────
// Lire les utilisateurs (sans mdp - lecture publique)
app.get('/api/users', (req, res) => {
  const db = readDB();
  const users = (db.users || []).map(u => {
    const {password, ...safe} = u;
    return safe;
  });
  res.json({ success: true, users });
});

// Lire les utilisateurs AVEC mdp (route admin - sync depuis directeur)
app.get('/api/users-admin', (req, res) => {
  const users = readUsers();
  res.json({ success: true, users });
});

// Sauvegarder utilisateurs AVEC mdp (depuis directeur)
app.post('/api/users-admin', (req, res) => {
  const users = req.body.users || [];
  const ok = writeUsers(users);
  res.json({ success: ok, count: users.length });
});

// Connexion
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if(!username || !password) {
    return res.status(400).json({ success: false, message: 'Identifiant et mot de passe requis' });
  }

  // DIRECTEUR: toujours valide (priorité absolue)
  const dirUsers = ['directeur','Directeur','DIRECTEUR'];
  if(dirUsers.includes(username) && password === 'ndongo2024'){
    return res.json({ success: true, user: {
      id: 'dir_001', username: 'directeur', nom: 'Ndongo Fall',
      role: 'directeur', actif: true
    }});
  }

  // Chercher dans la DB (agents créés par le directeur)
  const users = readUsers();
  console.log('Login attempt:', username, '| Users:', users.length, '→', users.map(u=>u.username).join(','));

  const found = users.find(u => 
    u.username && 
    u.username.toLowerCase().trim() === username.toLowerCase().trim() && 
    u.password === password && 
    u.actif !== false
  );
  
  if(found){
    const safeUser = { id: found.id, username: found.username, nom: found.nom, role: found.role, actif: found.actif };
    console.log('Login success:', safeUser.username);
    return res.json({ success: true, user: safeUser });
  }
  
  console.log('Login failed for:', username);
  res.status(401).json({ success: false, message: 'Identifiant ou mot de passe incorrect. Vérifiez avec le directeur.' });
});

// Sauvegarder les utilisateurs (directeur seulement)
app.post('/api/users', (req, res) => {
  const db = readDB();
  db.users = req.body.users || [];
  const ok = writeDB(db);
  res.json({ success: ok });
});

// ─── SCORES AGENTS ─────────────────────────
const SCORES_FILE = path.join(DATA_DIR, 'yango_scores.json');

function readScores(){
  try {
    if(fs.existsSync(SCORES_FILE)){
      return JSON.parse(fs.readFileSync(SCORES_FILE,'utf8'));
    }
  } catch(e){}
  return {scores:{}, history:[], reactivations:{}, month:''};
}

function writeScores(data){
  try {
    fs.writeFileSync(SCORES_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch(e){ console.error('writeScores:', e.message); return false; }
}

app.get('/api/scores', (req, res) => {
  res.json({ success: true, ...readScores() });
});

app.post('/api/scores', (req, res) => {
  const ok = writeScores(req.body);
  res.json({ success: ok });
});

// Diagnostic utilisateurs
app.get('/api/debug-users', (req, res) => {
  const users = readUsers().map(u => ({
    id: u.id,
    username: u.username,
    nom: u.nom,
    role: u.role,
    actif: u.actif,
    hasPassword: !!u.password
  }));
  res.json({ count: users.length, users });
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

// ─── PROXY COACH IA INTELLIGENT (GROQ) ─────────────
app.post('/api/chat', async (req, res) => {
  const GROQ_KEY = process.env.GROQ_API_KEY || '';
  if (!GROQ_KEY) {
    return res.json({content:[{type:'text',text:'⚠️ Clé GROQ_API_KEY manquante dans Render → Environment.'}]});
  }
  try {
    const https = require('https');
    const messages = req.body.messages || [];
    const systemPrompt = req.body.system || '';

    // ── Recherche de chauffeur dans la base de données ──
    const db = readDB();
    const drivers = db.drivers || [];
    const lastUserMsg = messages.length > 0 ? messages[messages.length-1].content : '';

    // Détection: nom, téléphone ou permis dans le message
    let driverContext = '';
    if (drivers.length > 0 && lastUserMsg.length > 2) {
      const query = lastUserMsg.toLowerCase().trim();
      // Recherche par nom, téléphone ou permis
      const found = drivers.filter(d => {
        const name = (d.name||'').toLowerCase();
        const phone = (d.phone||'').replace(/\s/g,'');
        const permis = (d.permis||'').toLowerCase();
        return name.includes(query) ||
               phone.includes(query.replace(/\s/g,'')) ||
               permis.includes(query) ||
               query.includes(name.split(' ')[0].toLowerCase()) ||
               query.includes(name.split(' ').pop().toLowerCase());
      }).slice(0, 3);

      if (found.length > 0) {
        const now = new Date();
        driverContext = '\n\n🔍 CHAUFFEURS TROUVÉS DANS LA BASE DE DONNÉES:\n';
        found.forEach(d => {
          const days = d.lastDate ? Math.round((now - new Date(d.lastDate)) / 864e5) : null;
          const commMois = d.orders > 0 ? Math.round(d.orders * 2026 * 0.03 / 30) : 0;
          driverContext += `\n👤 ${d.name}
  📱 Téléphone: ${d.phone||'—'}
  🪪 Permis: ${d.permis||'—'}
  🚗 Véhicule: ${d.vehicule||'—'} | Plaque: ${d.plaque||'—'}
  📊 Statut: ${d.segment||'—'} | Courses: ${(d.orders||0).toLocaleString()}
  ⏰ Inactivité: ${days !== null ? days+'j' : '—'}
  💰 Commission estimée/mois: ${commMois.toLocaleString()} FCFA
  🏅 Palier bonus: ${commMois>=200000?'👑 VIP → Bonus 50 000 FCFA':commMois>=100000?'💎 Platinum → Bonus 20 000 FCFA':commMois>=50000?'🥇 Gold → Bonus 7 500 FCFA':commMois>=25000?'🥈 Silver → Bonus 2 500 FCFA':'🥉 Pas encore (manque '+(25000-commMois).toLocaleString()+' FCFA/mois pour Silver)'}
  🏙️ Ville: ${d.city||'Dakar'}`;
        });
        driverContext += '\n';
      }
    }

    // ── Données agents depuis la requête ──
    const agentsData = req.body.agents || [];
    const scoresData = req.body.scores || {};
    let agentsContext = '';
    if(agentsData.length > 0){
      agentsContext = '\n\n👥 EQUIPE AGENTS DU PARC:\n';
      agentsData.forEach(function(a){
        const sc = scoresData[a.id] || {points:0,rappels:0,reactives:0,actives:0,rapports:0};
        const pts = sc.points || 0;
        const prime = Math.floor(pts/10)*1000;
        const badge = pts>=200?'👑 Agent du mois':pts>=100?'💎 VIP':pts>=50?'🥇 Gold':pts>=25?'🥈 Silver':pts>=10?'🥉 Bronze':'⭐ Débutant';
        agentsContext += `\n🧑 ${a.nom} (@${a.username||a.id})
  Rôle: ${a.role} | Zone: ${a.zone||'—'}
  📊 Points: ${pts} | Badge: ${badge}
  📞 Rappels effectués: ${sc.rappels||0}
  🔄 Dormants réactivés: ${sc.reactives||0}
  🆕 Jamais actifs activés: ${sc.actives||0}
  💰 Prime accumulée: ${prime.toLocaleString()} FCFA`;
      });
      // Classement
      const sorted = agentsData.slice().sort((a,b)=>((scoresData[b.id]||{}).points||0)-((scoresData[a.id]||{}).points||0));
      agentsContext += `\n\n🏆 CLASSEMENT: ${sorted.map((a,i)=>(i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1))+' '+a.nom+' ('+((scoresData[a.id]||{}).points||0)+' pts)').join(' | ')}`;
    }

    // ── Statistiques temps réel pour le système ──
    const stats = {
      total: drivers.length,
      actif2j: drivers.filter(d=>d.segment==='Actif 2j').length,
      actif7j: drivers.filter(d=>d.segment==='Actif 7j').length,
      alerte14j: drivers.filter(d=>d.segment==='Alerte 14j').length,
      alerte30j: drivers.filter(d=>d.segment==='Alerte 30j').length,
      dormant: drivers.filter(d=>d.segment==='Dormant récent'||d.segment==='Dormant').length,
      perdu: drivers.filter(d=>d.segment==='Perdu').length,
      jamais: drivers.filter(d=>d.segment==='Jamais actif').length
    };

    // Top 5 VIP (plus de courses)
    const top5 = drivers.slice().sort((a,b)=>(b.orders||0)-(a.orders||0)).slice(0,5);
    const top5txt = top5.map(d=>`${d.name} (${(d.orders||0).toLocaleString()} courses)`).join(', ');

    // Alertes urgentes (inactifs depuis 8-14j)
    const now2 = new Date();
    const urgents = drivers.filter(d=>{
      if(!d.lastDate) return false;
      const days = Math.round((now2-new Date(d.lastDate))/864e5);
      return days>=8 && days<=14 && (d.orders||0)>100;
    }).sort((a,b)=>(b.orders||0)-(a.orders||0)).slice(0,5);
    const urgentsTxt = urgents.map(d=>{
      const days=Math.round((now2-new Date(d.lastDate))/864e5);
      return `${d.name} (${days}j inactif, ${(d.orders||0).toLocaleString()} courses, ${d.phone||''})`;
    }).join('\n  ');

    const enrichedSystem = systemPrompt + driverContext + agentsContext + `

══════════════════════════════════════
📊 DONNÉES EN TEMPS RÉEL DU PARC NDONGO FALL
══════════════════════════════════════
🚖 Total inscrits: ${stats.total.toLocaleString()}
🟢 Actifs ≤2j: ${stats.actif2j} | ≤7j: ${stats.actif7j}
⚠️ Alerte 8-14j: ${stats.alerte14j} | 15-30j: ${stats.alerte30j}
🔴 Dormants: ${stats.dormant} | Perdus: ${stats.perdu}
⬛ Jamais actifs: ${stats.jamais}

🏆 TOP 5 VIP (plus de courses):
  ${top5txt}

🚨 CHAUFFEURS URGENTS À APPELER (8-14j inactifs, +100 courses):
  ${urgentsTxt||'Aucun urgent actuellement'}

💡 RAPPEL: Chaque actif = ~1 826 FCFA/mois pour le parc.
   Objectif 3000 actifs = ~5,5M FCFA/mois de commission.

💰 PROGRAMME BONUS (NE JAMAIS réduire la commission 3%):
   🥈 25 000-49 999 FCFA/mois générés → Bonus 2 500 FCFA
   🥇 50 000-99 999 FCFA/mois générés → Bonus 7 500 FCFA
   💎 100 000-199 999 FCFA/mois générés → Bonus 20 000 FCFA
   👑 200 000+ FCFA/mois générés → Bonus 50 000 FCFA + VIP
══════════════════════════════════════`;

    const groqMessages = [
      {role:'system', content: enrichedSystem},
      ...messages
    ];

    const groqBody = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: groqMessages,
      max_tokens: 1200,
      temperature: 0.7
    });

    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(groqBody),
        'Authorization': 'Bearer ' + GROQ_KEY
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return res.json({content:[{type:'text',text:'❌ Erreur Groq: '+parsed.error.message}]});
          }
          const text = parsed.choices?.[0]?.message?.content || 'Pas de réponse';
          res.json({content:[{type:'text', text}]});
        } catch(e) {
          res.json({content:[{type:'text',text:'Erreur parsing: '+e.message}]});
        }
      });
    });
    apiReq.on('error', e => {
      res.json({content:[{type:'text',text:'Erreur réseau: '+e.message}]});
    });
    apiReq.write(groqBody);
    apiReq.end();
  } catch(err) {
    res.json({content:[{type:'text',text:'Erreur serveur: '+err.message}]});
  }
});

// ─── DÉMARRAGE ──────────────────────────────
app.listen(PORT, () => {
  console.log(`🚖 Yango CRM démarré sur le port ${PORT}`);
  console.log(`💾 Données sauvegardées dans : ${DB_FILE}`);
  console.log(`🌐 URL : http://localhost:${PORT}`);
});
