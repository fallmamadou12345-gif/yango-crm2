const express = require('express');
const fs      = require('fs');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use(express.json({limit:'50mb'}));
app.use(express.static(path.join(__dirname,'public')));

// ─── STOCKAGE ───────────────────────────────────────────
const DATA_DIR   = process.env.DATA_DIR || (process.platform==='win32'?'C:\\YangoCRM_Data':'/data');
const USERS_FILE = path.join(DATA_DIR,'yango_users.json');
const PARCS_FILE = path.join(DATA_DIR,'yango_parcs.json');
const SCORES_FILE= path.join(DATA_DIR,'yango_scores.json');

try{ if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); }catch(e){ console.error('DATA_DIR:',e.message); }

// Parcs par défaut
const DEFAULT_PARCS = [
  {id:'dakar',     nom:'Dakar',      ville:'Dakar',      couleur:'#f5c518', actif:true},
  {id:'thies',     nom:'Thiès',      ville:'Thiès',      couleur:'#22d3a0', actif:true},
  {id:'mbour',     nom:'Mbour',      ville:'Mbour',      couleur:'#a78bfa', actif:true},
  {id:'kaolack',   nom:'Kaolack',    ville:'Kaolack',    couleur:'#fb923c', actif:true},
  {id:'ziguinchor',nom:'Ziguinchor', ville:'Ziguinchor', couleur:'#f87171', actif:true}
];

// ─── PARCS ──────────────────────────────────────────────
function readParcs(){
  try{
    if(fs.existsSync(PARCS_FILE)) return JSON.parse(fs.readFileSync(PARCS_FILE,'utf8'));
  }catch(e){}
  return {parcs: DEFAULT_PARCS};
}
function writeParcs(data){ try{ fs.writeFileSync(PARCS_FILE,JSON.stringify(data,null,2)); return true; }catch(e){ return false; } }

// ─── DONNÉES PAR PARC ───────────────────────────────────
function getParcFile(parcId){
  return path.join(DATA_DIR,'parc_'+parcId+'.json');
}
function readParcData(parcId){
  try{
    const f=getParcFile(parcId);
    if(fs.existsSync(f)) return JSON.parse(fs.readFileSync(f,'utf8'));
  }catch(e){}
  return {drivers:[],notes:{},reminders:[],cstatus:{},callLogs:{},importHist:[],agents:[],scores:{},updatedAt:null};
}
function writeParcData(parcId,data){
  try{
    fs.writeFileSync(getParcFile(parcId),JSON.stringify({...data,updatedAt:new Date().toISOString()},null,2));
    return true;
  }catch(e){ console.error('writeParcData:',e.message); return false; }
}

// ─── UTILISATEURS ───────────────────────────────────────
function readUsers(){
  const def={id:'dir_001',username:'directeur',password:'ndongo2024',nom:'Ndongo Fall',role:'directeur',parcs:['all'],actif:true};
  try{ if(fs.existsSync(USERS_FILE)){ const d=JSON.parse(fs.readFileSync(USERS_FILE,'utf8')); const u=d.users||[]; if(!u.find(x=>x.id==='dir_001')) u.unshift(def); return u; } }catch(e){}
  return [def];
}
function writeUsers(users){
  try{ const def={id:'dir_001',username:'directeur',password:'ndongo2024',nom:'Ndongo Fall',role:'directeur',parcs:['all'],actif:true}; if(!users.find(u=>u.id==='dir_001')) users.unshift(def); fs.writeFileSync(USERS_FILE,JSON.stringify({users,updatedAt:new Date().toISOString()},null,2)); console.log('Users saved:',users.length); return true; }catch(e){ return false; }
}

// ─── SCORES ─────────────────────────────────────────────
function readScores(){ try{ if(fs.existsSync(SCORES_FILE)) return JSON.parse(fs.readFileSync(SCORES_FILE,'utf8')); }catch(e){} return {}; }
function writeScores(data){ try{ fs.writeFileSync(SCORES_FILE,JSON.stringify(data,null,2)); return true; }catch(e){ return false; } }

// ══════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════

// ─── LOGIN ──────────────────────────────────────────────
app.post('/api/login',(req,res)=>{
  const {username,password}=req.body;
  if(!username||!password) return res.status(400).json({success:false,message:'Identifiant et mot de passe requis'});
  // Directeur toujours valide
  if(username.toLowerCase()==='directeur'&&password==='ndongo2024'){
    return res.json({success:true,user:{id:'dir_001',username:'directeur',nom:'Ndongo Fall',role:'directeur',parcs:['all'],actif:true}});
  }
  const users=readUsers();
  console.log('Login:',username,'| Users:',users.length,'→',users.map(u=>u.username).join(','));
  const found=users.find(u=>u.username&&u.username.toLowerCase().trim()===username.toLowerCase().trim()&&u.password===password&&u.actif!==false);
  if(found){
    const {password:_,...safe}=found;
    console.log('Login success:',safe.username);
    return res.json({success:true,user:safe});
  }
  console.log('Login failed for:',username);
  res.status(401).json({success:false,message:'Identifiant ou mot de passe incorrect'});
});

// ─── USERS ADMIN ────────────────────────────────────────
app.get('/api/users-admin',(req,res)=>res.json({success:true,users:readUsers()}));
app.post('/api/users-admin',(req,res)=>res.json({success:writeUsers(req.body.users||[])}));
app.get('/api/debug-users',(req,res)=>{
  const users=readUsers().map(u=>({id:u.id,username:u.username,nom:u.nom,role:u.role,parcs:u.parcs,actif:u.actif,hasPassword:!!u.password}));
  res.json({count:users.length,users});
});

// ─── PARCS ──────────────────────────────────────────────
app.get('/api/parcs',(req,res)=>res.json(readParcs()));
app.post('/api/parcs',(req,res)=>res.json({success:writeParcs(req.body)}));

// Données d'un parc
app.get('/api/parcs/:id/data',(req,res)=>{
  const data=readParcData(req.params.id);
  res.json({success:true,data});
});
app.post('/api/parcs/:id/data',(req,res)=>{
  const ok=writeParcData(req.params.id,req.body);
  res.json({success:ok});
});

// Stats consolidées tous parcs (directeur)
app.get('/api/stats-global',(req,res)=>{
  const {parcs}=readParcs();
  const stats=parcs.filter(p=>p.actif).map(p=>{
    const d=readParcData(p.id);
    const total=d.drivers.length;
    const actifs=d.drivers.filter(x=>x.segment&&(x.segment.includes('Actif')||x.segment.includes('Alerte'))).length;
    const comm=d.drivers.reduce((s,x)=>(x.orders||0)>0?s+Math.round(x.orders*2026*0.03/30):s,0);
    return {id:p.id,nom:p.nom,couleur:p.couleur,total,actifs,comm,agents:(d.agents||[]).length,updatedAt:d.updatedAt};
  });
  res.json({success:true,stats});
});

// ─── SCORES ─────────────────────────────────────────────
app.get('/api/scores',(req,res)=>res.json({success:true,...readScores()}));
app.post('/api/scores',(req,res)=>res.json({success:writeScores(req.body)}));

// ─── CHAT IA (ANTHROPIC CLAUDE) ─────────────────────
app.post('/api/chat', async (req, res) => {
  // Essayer Anthropic d'abord, puis Groq en fallback
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
  const GROQ_KEY = process.env.GROQ_API_KEY || '';
  
  if(!ANTHROPIC_KEY && !GROQ_KEY){
    return res.json({content:[{type:'text',text:'⚠️ Aucune clé API configurée. Ajoutez ANTHROPIC_API_KEY ou GROQ_API_KEY dans Render → Environment.'}]});
  }

  const systemPrompt = req.body.system || '';
  const messages = req.body.messages || [];
  const agentsData = req.body.agents || [];
  const scoresData = req.body.scores || {};

  // Enrichir le système avec données agents
  let agentsCtx = '';
  if(agentsData.length > 0){
    agentsCtx = '\n\nEQUIPE AGENTS:\n';
    agentsData.forEach(a => {
      const sc = scoresData[a.id] || {};
      const pts = sc.points || 0;
      const badge = pts>=200?'👑':pts>=100?'💎':pts>=50?'🥇':pts>=25?'🥈':pts>=10?'🥉':'⭐';
      agentsCtx += `${a.nom}: ${pts} pts ${badge} | Rappels:${sc.rappels||0} | Reactives:${sc.reactives||0}\n`;
    });
  }
  const fullSystem = systemPrompt + agentsCtx;

  // 1. Essayer Anthropic Claude (meilleur pour VTC)
  if(ANTHROPIC_KEY){
    try{
      const https = require('https');
      const anthropicMsgs = messages.map(m => ({role: m.role==='user'?'user':'assistant', content: m.content}));
      const body = JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: fullSystem,
        messages: anthropicMsgs
      });
      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        }
      };
      const result = await new Promise((resolve, reject) => {
        const req2 = https.request(opts, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => {
            try{
              const p = JSON.parse(data);
              if(p.error) reject(new Error(p.error.message));
              else resolve(p.content?.[0]?.text || 'Pas de réponse');
            }catch(e){ reject(e); }
          });
        });
        req2.on('error', reject);
        req2.write(body);
        req2.end();
      });
      console.log('Claude repondu OK');
      return res.json({content:[{type:'text', text: result}]});
    }catch(e){
      console.error('Claude error:', e.message, '— fallback Groq');
    }
  }

  // 2. Fallback Groq
  if(GROQ_KEY){
    try{
      const https = require('https');
      const groqMsgs = [{role:'system', content: fullSystem}, ...messages];
      const body = JSON.stringify({model:'llama-3.3-70b-versatile', messages: groqMsgs, max_tokens:1200, temperature:0.7});
      const opts = {
        hostname:'api.groq.com', path:'/openai/v1/chat/completions', method:'POST',
        headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+GROQ_KEY}
      };
      const result = await new Promise((resolve, reject) => {
        const req2 = https.request(opts, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => {
            try{
              const p = JSON.parse(data);
              if(p.error) reject(new Error(p.error.message));
              else resolve(p.choices?.[0]?.message?.content || 'Pas de reponse');
            }catch(e){ reject(e); }
          });
        });
        req2.on('error', reject);
        req2.write(body);
        req2.end();
      });
      return res.json({content:[{type:'text', text: result}]});
    }catch(e){
      return res.json({content:[{type:'text', text:'❌ Erreur IA: '+e.message}]});
    }
  }
});

// ─── SANTÉ ──────────────────────────────────────────────
app.get('/api/health',(req,res)=>res.json({status:'OK',version:'multi-parc-v1',parcs:readParcs().parcs?.length||0}));

// ─── DÉMARRAGE ──────────────────────────────────────────
app.listen(PORT,()=>{
  console.log(`🚖 Yango CRM Multi-Parc démarré sur port ${PORT}`);
  console.log(`📁 Données: ${DATA_DIR}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
});
