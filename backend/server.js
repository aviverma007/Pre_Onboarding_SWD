/* Pre-Onboarding SWD — standalone backend (Express + SQL Server).
   Auth: role logins (admin/hr/hod/interviewer) via /api/login; the frontend sends
   x-user-role / x-user-name headers on each request. Tables auto-create on boot. */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const fs = require('fs');
const pathmod = require('path');

const app = express();
app.use(cors({ origin: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'x-user-role', 'x-user-name'] }));
app.use(express.json({ limit: '30mb' }));

const PORT = process.env.PORT || 5098;
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'SmartWorld@2026';
const UP_ROOT = pathmod.join(__dirname, 'uploads');
const CV_DIR = pathmod.join(UP_ROOT, 'cv');
const JD_DIR = pathmod.join(UP_ROOT, 'jd');
const DOC_DIR = pathmod.join(UP_ROOT, 'docs');
[UP_ROOT, CV_DIR, JD_DIR, DOC_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const dbConfig = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_DATABASE || 'PreOnboardingDB',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};
let poolPromise = null;
function getPool() { if (!poolPromise) poolPromise = new sql.ConnectionPool(dbConfig).connect(); return poolPromise; }

/* ---- roles / helpers ---- */
const ROLES = ['admin', 'hr', 'hod', 'interviewer'];
const role = (req) => String(req.headers['x-user-role'] || '').toLowerCase();
const actor = (req) => String(req.headers['x-user-name'] || req.headers['x-user-role'] || '');
const can = (req, ...roles) => roles.includes(role(req)) || role(req) === 'admin';
const deny = (res) => res.status(403).json({ success: false, error: 'Not allowed for your role.' });

const REC_STAGES = ['jd', 'review_post', 'cv_shortlist', 'scheduling', 'interview', 'selection', 'joining'];
const DOC_CHECKLIST = [
  { key: 'idProof', label: 'ID proof' }, { key: 'addressProof', label: 'Address proof' },
  { key: 'education', label: 'Education certificates' }, { key: 'relieving', label: 'Relieving / experience letter' },
  { key: 'bank', label: 'Bank details' }, { key: 'photo', label: 'Photograph' },
];
const freshDocs = () => DOC_CHECKLIST.map(d => ({ key: d.key, label: d.label, received: false, fileName: null }));

function recForwardGate(cur, cands) {
  const OK = { ok: true };
  const ch = (() => { try { return JSON.parse(cur.SourcingChannels || '[]'); } catch { return []; } })();
  switch (cur.Stage) {
    case 'jd': return (cur.JdText && String(cur.JdText).trim()) || cur.JdFileName ? OK : { ok: false, msg: 'Add the JD (paste text or upload a file) before handing it to HR.' };
    case 'review_post': return ch.length ? OK : { ok: false, msg: 'Tick where the JD was posted before moving on.' };
    case 'cv_shortlist': {
      if (!cands.length) return { ok: false, msg: 'Upload at least one CV first.' };
      if (!cur.CvSentForSelection) return { ok: false, msg: 'Click "Send for CV selection" so the HOD can review the CVs first.' };
      const pending = cands.filter(c => (c.HodDecision || 'pending') === 'pending');
      if (pending.length) return { ok: false, msg: `The HOD still has ${pending.length} CV(s) to review.` };
      if (!cands.some(c => c.HodDecision === 'accepted')) return { ok: false, msg: 'The HOD has not accepted any candidate.' };
      return OK;
    }
    case 'scheduling': return cands.some(c => c.HodDecision === 'accepted' && (['scheduled', 'in_progress', 'arrived'].includes(c.InterviewStatus) || c.Outcome)) ? OK : { ok: false, msg: 'HR must approve at least one proposed interview time.' };
    case 'interview': return cands.some(c => c.Outcome) ? OK : { ok: false, msg: 'Record at least one approved interview outcome first.' };
    case 'selection': return cur.SelectedCandidateId ? OK : { ok: false, msg: 'Take a Selected candidate forward (with a joining date).' };
    default: return OK;
  }
}

async function initDb() {
  // Try to create the database if missing (needs elevated rights). If the login
  // can't create databases, that's fine — pre-create it in SSMS and we'll just
  // create the tables inside it.
  const master = { ...dbConfig, database: 'master' };
  try {
    const mp = await new sql.ConnectionPool(master).connect();
    await mp.request().query(`IF DB_ID('${dbConfig.database}') IS NULL CREATE DATABASE [${dbConfig.database}];`);
    await mp.close();
    console.log(`   \u2713 Database "${dbConfig.database}" ready`);
  } catch (e) {
    console.warn(`   (auto-create of "${dbConfig.database}" skipped: ${e.message}) — will use it if it already exists`);
  }
  console.log(`   Connecting as ${dbConfig.user}@${dbConfig.server}:${dbConfig.port}/${dbConfig.database} ...`);
  const p = await getPool();
  await p.request().batch(`
IF OBJECT_ID('dbo.Requirements','U') IS NULL
CREATE TABLE dbo.Requirements (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  Department NVARCHAR(150) NULL, Role NVARCHAR(150) NULL, Grade NVARCHAR(80) NULL,
  Positions INT NULL, TargetDate DATE NULL, MrfRef NVARCHAR(100) NULL,
  JdText NVARCHAR(MAX) NULL, JdFileName NVARCHAR(255) NULL,
  Stage NVARCHAR(30) NOT NULL DEFAULT('jd'),
  Status NVARCHAR(20) NOT NULL DEFAULT('active'),
  DropReason NVARCHAR(300) NULL,
  SourcingChannels NVARCHAR(MAX) NULL, SourcingNotes NVARCHAR(600) NULL,
  CvSentForSelection BIT NOT NULL DEFAULT(0),
  SelectedCandidateId INT NULL,
  DeleteRequested BIT NOT NULL DEFAULT(0), DeleteReason NVARCHAR(300) NULL, DeleteRequestedBy NVARCHAR(120) NULL,
  CreatedBy NVARCHAR(120) NULL, CreatedByRole NVARCHAR(30) NULL,
  CreatedAt DATETIME NOT NULL DEFAULT(GETDATE()), UpdatedAt DATETIME NOT NULL DEFAULT(GETDATE())
);
IF OBJECT_ID('dbo.Candidates','U') IS NULL
CREATE TABLE dbo.Candidates (
  Id INT IDENTITY(1,1) PRIMARY KEY,
  ReqId INT NOT NULL,
  Name NVARCHAR(200) NOT NULL, Phone NVARCHAR(60) NULL, Email NVARCHAR(200) NULL, Source NVARCHAR(120) NULL,
  CvFileName NVARCHAR(255) NULL,
  HodDecision NVARCHAR(20) NOT NULL DEFAULT('pending'), HodRemark NVARCHAR(300) NULL,
  InterviewDate DATE NULL, InterviewTime NVARCHAR(30) NULL, InterviewStatus NVARCHAR(20) NOT NULL DEFAULT('none'),
  InterviewerName NVARCHAR(200) NULL, Assessment NVARCHAR(MAX) NULL, AssessmentStatus NVARCHAR(20) NULL, Outcome NVARCHAR(20) NULL,
  CandStatus NVARCHAR(20) NOT NULL DEFAULT('shortlisted'),
  JoiningDate DATE NULL, Documents NVARCHAR(MAX) NULL, EngagementNotes NVARCHAR(600) NULL,
  CreatedAt DATETIME NOT NULL DEFAULT(GETDATE())
);
  `);
  console.log('   \u2713 Tables ready');
}

/* ---- auth ---- */
app.post('/api/login', (req, res) => {
  const username = String((req.body || {}).username || '').toLowerCase().trim();
  const password = String((req.body || {}).password || '');
  if (!ROLES.includes(username)) return res.status(401).json({ success: false, error: 'Unknown user.' });
  if (password !== LOGIN_PASSWORD) return res.status(401).json({ success: false, error: 'Wrong password.' });
  const names = { admin: 'Administrator', hr: 'HR Team', hod: 'HOD', interviewer: 'Interviewer' };
  res.json({ success: true, user: { role: username, name: names[username] } });
});

app.get('/api/health', async (req, res) => { try { await getPool(); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

/* ---- requirements ---- */
app.get('/api/requirements/version', async (req, res) => {
  if (!can(req, 'hr', 'hod', 'interviewer')) return deny(res);
  try { const p = await getPool(); const q = await p.request().query(`SELECT COUNT(*) c, CONVERT(VARCHAR(30),MAX(UpdatedAt),126) u FROM dbo.Requirements`); const r = q.recordset[0] || {}; res.json({ success: true, version: `${r.c || 0}:${r.u || ''}` }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/requirements', async (req, res) => {
  if (!can(req, 'hr', 'hod', 'interviewer')) return deny(res);
  try {
    const p = await getPool();
    const reqs = (await p.request().query(`SELECT * FROM dbo.Requirements ORDER BY CASE Status WHEN 'active' THEN 0 ELSE 1 END, UpdatedAt DESC`)).recordset;
    const cands = (await p.request().query(`SELECT * FROM dbo.Candidates ORDER BY CreatedAt`)).recordset;
    const byReq = {}; cands.forEach(c => { (byReq[c.ReqId] = byReq[c.ReqId] || []).push(c); });
    reqs.forEach(r => r.candidates = byReq[r.Id] || []);
    res.json({ success: true, records: reqs, stages: REC_STAGES, checklist: DOC_CHECKLIST });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/requirements', async (req, res) => {
  if (!can(req, 'hr', 'hod')) return deny(res);
  try {
    const b = req.body || {};
    if (!b.role && !b.department) return res.status(400).json({ success: false, error: 'Enter at least a role or department.' });
    const p = await getPool();
    const r = await p.request()
      .input('Dept', sql.NVarChar, b.department || null).input('Role', sql.NVarChar, b.role || null)
      .input('Grade', sql.NVarChar, b.grade || null).input('Pos', sql.Int, b.positions || 1)
      .input('TD', sql.Date, b.targetDate || null).input('Mrf', sql.NVarChar, b.mrfRef || null)
      .input('JdText', sql.NVarChar, b.jdText || null)
      .input('By', sql.NVarChar, actor(req)).input('ByRole', sql.NVarChar, role(req))
      .query(`INSERT INTO dbo.Requirements (Department,Role,Grade,Positions,TargetDate,MrfRef,JdText,CreatedBy,CreatedByRole,Stage)
              OUTPUT INSERTED.* VALUES (@Dept,@Role,@Grade,@Pos,@TD,@Mrf,@JdText,@By,@ByRole,'jd')`);
    res.json({ success: true, record: r.recordset[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/requirements/:id', async (req, res) => {
  if (!can(req, 'hr', 'hod')) return deny(res);
  try {
    const b = req.body || {};
    const p = await getPool();
    const cur = (await p.request().input('Id', sql.Int, req.params.id).query(`SELECT * FROM dbo.Requirements WHERE Id=@Id`)).recordset[0];
    if (!cur) return res.status(404).json({ success: false, error: 'Not found.' });
    const stage = b.stage || cur.Stage;
    if (stage !== cur.Stage) {
      const ci = REC_STAGES.indexOf(cur.Stage), ni = REC_STAGES.indexOf(stage);
      if (ni > ci) {
        const advancers = cur.Stage === 'jd' ? ['hod'] : ['hr'];
        if (!can(req, ...advancers)) return res.status(403).json({ success: false, error: 'Only ' + advancers.join('/').toUpperCase() + ' can advance this stage.' });
        const cands = (await p.request().input('R', sql.Int, req.params.id).query(`SELECT * FROM dbo.Candidates WHERE ReqId=@R`)).recordset;
        const gate = recForwardGate(cur, cands);
        if (!gate.ok) return res.status(400).json({ success: false, error: gate.msg });
      }
    }
    const g = (k, col) => { const v = b[k] !== undefined ? b[k] : cur[col]; return v === undefined ? null : v; };
    await p.request().input('Id', sql.Int, req.params.id)
      .input('Dept', sql.NVarChar, g('department', 'Department')).input('Role', sql.NVarChar, g('role', 'Role'))
      .input('Grade', sql.NVarChar, g('grade', 'Grade')).input('Pos', sql.Int, g('positions', 'Positions'))
      .input('TD', sql.Date, g('targetDate', 'TargetDate') || null).input('Mrf', sql.NVarChar, g('mrfRef', 'MrfRef'))
      .input('JdText', sql.NVarChar, g('jdText', 'JdText'))
      .input('Stage', sql.NVarChar, stage).input('Status', sql.NVarChar, g('status', 'Status')).input('Drop', sql.NVarChar, g('dropReason', 'DropReason'))
      .input('SC', sql.NVarChar, b.sourcingChannels !== undefined ? JSON.stringify(b.sourcingChannels) : cur.SourcingChannels)
      .input('SN', sql.NVarChar, g('sourcingNotes', 'SourcingNotes'))
      .input('CvSent', sql.Bit, (b.cvSentForSelection !== undefined ? b.cvSentForSelection : cur.CvSentForSelection) ? 1 : 0)
      .input('Sel', sql.Int, g('selectedCandidateId', 'SelectedCandidateId') || null)
      .query(`UPDATE dbo.Requirements SET Department=@Dept,Role=@Role,Grade=@Grade,Positions=@Pos,TargetDate=@TD,MrfRef=@Mrf,JdText=@JdText,
        Stage=@Stage,Status=@Status,DropReason=@Drop,SourcingChannels=@SC,SourcingNotes=@SN,CvSentForSelection=@CvSent,SelectedCandidateId=@Sel,UpdatedAt=GETDATE() WHERE Id=@Id`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* delete (admin direct; hr/hod request) */
app.post('/api/requirements/:id/request-delete', async (req, res) => {
  if (!can(req, 'hr', 'hod')) return deny(res);
  try { const p = await getPool(); await p.request().input('Id', sql.Int, req.params.id).input('R', sql.NVarChar, (req.body || {}).reason || null).input('By', sql.NVarChar, actor(req))
    .query(`UPDATE dbo.Requirements SET DeleteRequested=1, DeleteReason=@R, DeleteRequestedBy=@By, UpdatedAt=GETDATE() WHERE Id=@Id`); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.delete('/api/requirements/:id', async (req, res) => {
  if (!can(req)) return deny(res); // admin only
  try { const p = await getPool(); await p.request().input('Id', sql.Int, req.params.id).query(`DELETE FROM dbo.Candidates WHERE ReqId=@Id; DELETE FROM dbo.Requirements WHERE Id=@Id`); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/requirements/:id/reject-delete', async (req, res) => {
  if (!can(req)) return deny(res);
  try { const p = await getPool(); await p.request().input('Id', sql.Int, req.params.id).query(`UPDATE dbo.Requirements SET DeleteRequested=0, DeleteReason=NULL, DeleteRequestedBy=NULL WHERE Id=@Id`); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* JD file */
app.post('/api/requirements/:id/jd-upload', async (req, res) => {
  if (!can(req, 'hr', 'hod')) return deny(res);
  try {
    const b = req.body || {}; if (!b.dataBase64) return res.status(400).json({ success: false, error: 'Missing file.' });
    const safe = String(b.fileName || 'jd.pdf').replace(/[^A-Za-z0-9._-]/g, '_');
    try { fs.readdirSync(JD_DIR).filter(n => n.startsWith(req.params.id + '__')).forEach(n => fs.rmSync(pathmod.join(JD_DIR, n), { force: true })); } catch {}
    fs.writeFileSync(pathmod.join(JD_DIR, `${req.params.id}__${safe}`), Buffer.from(b.dataBase64.split(',').pop(), 'base64'));
    const p = await getPool(); await p.request().input('Id', sql.Int, req.params.id).input('F', sql.NVarChar, b.fileName || safe).query(`UPDATE dbo.Requirements SET JdFileName=@F, UpdatedAt=GETDATE() WHERE Id=@Id`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/requirements/:id/jd-file', async (req, res) => {
  if (!can(req, 'hr', 'hod', 'interviewer')) return deny(res);
  try { const f = fs.readdirSync(JD_DIR).find(n => n.startsWith(req.params.id + '__')); if (!f) return res.status(404).send('Not found'); res.download(pathmod.join(JD_DIR, f), f.split('__').slice(1).join('__')); }
  catch (e) { res.status(500).send(e.message); }
});

/* candidates + CV */
async function bumpReq(p, reqId) { await p.request().input('R', sql.Int, reqId).query(`UPDATE dbo.Requirements SET UpdatedAt=GETDATE() WHERE Id=@R`); }
app.post('/api/requirements/:id/cv', async (req, res) => {
  if (!can(req, 'hr', 'hod')) return deny(res);
  try {
    const b = req.body || {}; if (!b.dataBase64) return res.status(400).json({ success: false, error: 'Missing file.' });
    const name = b.name || (b.fileName ? b.fileName.replace(/\.[^.]+$/, '') : 'Candidate');
    const p = await getPool();
    const r = await p.request().input('ReqId', sql.Int, req.params.id).input('Name', sql.NVarChar, name).input('CvF', sql.NVarChar, b.fileName || null).input('Docs', sql.NVarChar, JSON.stringify(freshDocs()))
      .query(`INSERT INTO dbo.Candidates (ReqId,Name,CvFileName,Documents) OUTPUT INSERTED.Id VALUES (@ReqId,@Name,@CvF,@Docs)`);
    const cid = r.recordset[0].Id;
    const dir = pathmod.join(CV_DIR, String(cid)); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pathmod.join(dir, String(b.fileName || 'cv.pdf').replace(/[^A-Za-z0-9._-]/g, '_')), Buffer.from(b.dataBase64.split(',').pop(), 'base64'));
    await bumpReq(p, req.params.id);
    res.json({ success: true, id: cid });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/candidates/:cid/cv', async (req, res) => {
  if (!can(req, 'hr', 'hod', 'interviewer')) return deny(res);
  try { const dir = pathmod.join(CV_DIR, String(req.params.cid)); if (!fs.existsSync(dir)) return res.status(404).send('Not found'); const f = fs.readdirSync(dir)[0]; if (!f) return res.status(404).send('Not found'); res.download(pathmod.join(dir, f), f); }
  catch (e) { res.status(500).send(e.message); }
});
app.post('/api/requirements/:id/candidates', async (req, res) => {
  if (!can(req, 'hr', 'hod')) return deny(res);
  try { const b = req.body || {}; if (!b.name) return res.status(400).json({ success: false, error: 'Name required.' });
    const p = await getPool(); const r = await p.request().input('ReqId', sql.Int, req.params.id).input('Name', sql.NVarChar, b.name).input('Phone', sql.NVarChar, b.phone || null).input('Email', sql.NVarChar, b.email || null).input('Source', sql.NVarChar, b.source || null).input('Docs', sql.NVarChar, JSON.stringify(freshDocs()))
      .query(`INSERT INTO dbo.Candidates (ReqId,Name,Phone,Email,Source,Documents) OUTPUT INSERTED.* VALUES (@ReqId,@Name,@Phone,@Email,@Source,@Docs)`);
    await bumpReq(p, req.params.id); res.json({ success: true, record: r.recordset[0] }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.put('/api/candidates/:cid', async (req, res) => {
  if (!can(req, 'hr', 'hod', 'interviewer')) return deny(res);
  try {
    const b = req.body || {};
    const p = await getPool();
    const cur = (await p.request().input('Id', sql.Int, req.params.cid).query(`SELECT * FROM dbo.Candidates WHERE Id=@Id`)).recordset[0];
    if (!cur) return res.status(404).json({ success: false, error: 'Not found.' });
    const rl = role(req), adminR = rl === 'admin';
    if (b.hodDecision !== undefined && !(adminR || rl === 'hod')) return res.status(403).json({ success: false, error: 'Only the HOD can accept/reject CVs.' });
    if ((b.assessment !== undefined || b.outcome !== undefined || b.assessmentStatus !== undefined) && !(adminR || rl === 'interviewer' || rl === 'hod')) return res.status(403).json({ success: false, error: 'Only the Interviewer or HOD can update the assessment.' });
    if ((b.interviewDate !== undefined || b.interviewTime !== undefined || b.interviewStatus !== undefined) && !(adminR || rl === 'hr' || rl === 'interviewer')) return res.status(403).json({ success: false, error: 'Only HR or the Interviewer can set interview timing.' });
    if (b.joiningDate !== undefined && !(adminR || rl === 'hr')) return res.status(403).json({ success: false, error: 'Only HR can set the joining date.' });
    const MAP = { name: 'Name', phone: 'Phone', email: 'Email', source: 'Source', candStatus: 'CandStatus',
      hodDecision: 'HodDecision', hodRemark: 'HodRemark', interviewDate: 'InterviewDate', interviewTime: 'InterviewTime',
      interviewStatus: 'InterviewStatus', interviewerName: 'InterviewerName', assessment: 'Assessment', assessmentStatus: 'AssessmentStatus',
      outcome: 'Outcome', joiningDate: 'JoiningDate', documents: 'Documents', engagementNotes: 'EngagementNotes' };
    const JSONF = new Set(['assessment', 'documents']);
    const DATEF = new Set(['interviewDate', 'joiningDate']);
    const rq = p.request().input('Id', sql.Int, req.params.cid);
    const sets = []; let i = 0;
    for (const [k, col] of Object.entries(MAP)) {
      if (b[k] === undefined) continue; const pn = 'p' + (i++); let v = b[k];
      if (JSONF.has(k)) { rq.input(pn, sql.NVarChar, JSON.stringify(v)); }
      else if (DATEF.has(k)) rq.input(pn, sql.Date, v || null);
      else rq.input(pn, sql.NVarChar, v === undefined ? null : v);
      sets.push(`${col}=@${pn}`);
    }
    if (!sets.length) return res.json({ success: true });
    await rq.query(`UPDATE dbo.Candidates SET ${sets.join(', ')} WHERE Id=@Id; UPDATE dbo.Requirements SET UpdatedAt=GETDATE() WHERE Id=(SELECT ReqId FROM dbo.Candidates WHERE Id=@Id)`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.delete('/api/candidates/:cid', async (req, res) => {
  if (!can(req, 'hr', 'hod')) return deny(res);
  try { const p = await getPool(); await p.request().input('Id', sql.Int, req.params.cid).query(`UPDATE dbo.Requirements SET UpdatedAt=GETDATE() WHERE Id=(SELECT ReqId FROM dbo.Candidates WHERE Id=@Id); DELETE FROM dbo.Candidates WHERE Id=@Id`); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* stage-9 documents on a candidate */
app.post('/api/candidates/:cid/doc-upload', async (req, res) => {
  if (!can(req, 'hr')) return deny(res);
  try {
    const b = req.body || {}; if (!b.key || !b.dataBase64) return res.status(400).json({ success: false, error: 'Missing file.' });
    const p = await getPool(); const cur = (await p.request().input('Id', sql.Int, req.params.cid).query(`SELECT Documents FROM dbo.Candidates WHERE Id=@Id`)).recordset[0];
    if (!cur) return res.status(404).json({ success: false, error: 'Not found.' });
    const dir = pathmod.join(DOC_DIR, String(req.params.cid)); fs.mkdirSync(dir, { recursive: true });
    const safe = String(b.fileName || (b.key + '.bin')).replace(/[^A-Za-z0-9._-]/g, '_');
    fs.writeFileSync(pathmod.join(dir, `${b.key}__${safe}`), Buffer.from(b.dataBase64.split(',').pop(), 'base64'));
    let docs = []; try { docs = JSON.parse(cur.Documents || '[]'); } catch {}
    docs = docs.map(d => d.key === b.key ? { ...d, received: true, fileName: b.fileName || safe } : d);
    await p.request().input('Id', sql.Int, req.params.cid).input('Docs', sql.NVarChar, JSON.stringify(docs)).query(`UPDATE dbo.Candidates SET Documents=@Docs WHERE Id=@Id`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/candidates/:cid/doc/:key', async (req, res) => {
  if (!can(req, 'hr')) return deny(res);
  try { const dir = pathmod.join(DOC_DIR, String(req.params.cid)); if (!fs.existsSync(dir)) return res.status(404).send('Not found'); const f = fs.readdirSync(dir).find(n => n.startsWith(req.params.key + '__')); if (!f) return res.status(404).send('Not found'); res.download(pathmod.join(dir, f), f.split('__').slice(1).join('__')); }
  catch (e) { res.status(500).send(e.message); }
});
app.delete('/api/candidates/:cid/doc/:key', async (req, res) => {
  if (!can(req, 'hr')) return deny(res);
  try {
    const p = await getPool(); const cur = (await p.request().input('Id', sql.Int, req.params.cid).query(`SELECT Documents FROM dbo.Candidates WHERE Id=@Id`)).recordset[0];
    if (!cur) return res.status(404).json({ success: false, error: 'Not found.' });
    const dir = pathmod.join(DOC_DIR, String(req.params.cid));
    try { if (fs.existsSync(dir)) { const f = fs.readdirSync(dir).find(n => n.startsWith(req.params.key + '__')); if (f) fs.rmSync(pathmod.join(dir, f), { force: true }); } } catch {}
    let docs = []; try { docs = JSON.parse(cur.Documents || '[]'); } catch {}
    docs = docs.map(d => d.key === req.params.key ? { ...d, received: false, fileName: null } : d);
    await p.request().input('Id', sql.Int, req.params.cid).input('Docs', sql.NVarChar, JSON.stringify(docs)).query(`UPDATE dbo.Candidates SET Documents=@Docs WHERE Id=@Id`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

initDb().then(() => app.listen(PORT, () => console.log(`Pre-Onboarding backend on :${PORT}`)))
  .catch(err => {
    console.error('\nStartup failed:', err.message);
    console.error('Check backend/.env — DB_SERVER/DB_PORT reachable, DB_USER/DB_PASSWORD correct, and the login has access to DB_DATABASE.');
    console.error('If the login cannot CREATE DATABASE, pre-create it once in SSMS:  CREATE DATABASE ' + (process.env.DB_DATABASE || 'PreOnboardingDB') + ';\n');
    process.exit(1);
  });
