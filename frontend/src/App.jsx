import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { makeApi, readBase64 } from './api.js';

const STAGES = ['jd', 'review_post', 'cv_shortlist', 'scheduling', 'interview', 'selection', 'joining'];
const STAGE_LABEL = { jd: '1 · JD & Requirement', review_post: '2 · Review & Post', cv_shortlist: '3 · CV Shortlist', scheduling: '4 · Scheduling', interview: '5 · Interview', selection: '6 · Selection', joining: '7 · Joining' };
const SHORT = (s) => (STAGE_LABEL[s] || s).replace(/^\d+\s·\s/, '');
const STAGE_OWNER = { jd: 'HOD', review_post: 'HR', cv_shortlist: 'HOD / HR', scheduling: 'Interviewer + HR', interview: 'Interviewer', selection: 'HR', joining: 'HR' };
const STAGE_ACT = { jd: ['hod'], review_post: ['hr'], cv_shortlist: ['hr', 'hod'], scheduling: ['hr', 'interviewer'], interview: ['interviewer', 'hod'], selection: ['hr'], joining: ['hr'] };
const POST_CHANNELS = ['Company website', 'Naukri', 'LinkedIn', 'Referrals', 'Consultants', 'Internal posting'];
const DOCS = [{ key: 'idProof', label: 'ID proof' }, { key: 'addressProof', label: 'Address proof' }, { key: 'education', label: 'Education certificates' }, { key: 'relieving', label: 'Relieving / experience letter' }, { key: 'bank', label: 'Bank details' }, { key: 'photo', label: 'Photograph' }];
const ASSESS_CRITERIA = ['Education / Training', 'Work Experience', 'Technical skills', 'Personality', 'Communication Skills', 'Others'];
const ASSESS_RATINGS = [{ v: 5, l: 'Excellent' }, { v: 4, l: 'Good' }, { v: 3, l: 'Average' }, { v: 2, l: 'Below Average' }];
const OUTCOME_COLOR = { Selected: 'var(--green)', 'On Hold': 'var(--orange)', 'Not Suitable': 'var(--red)' };
const STAGE_COLOR = { jd: 'var(--accent)', review_post: 'var(--accent)', cv_shortlist: 'var(--teal)', scheduling: 'var(--teal)', interview: 'var(--orange)', selection: 'var(--orange)', joining: 'var(--green)', on_hold: 'var(--muted)', dropped: 'var(--red)', closed: 'var(--muted)' };
const dv = (d) => d ? new Date(d).toISOString().slice(0, 10) : '';
const norm = (st) => STAGES.includes(st) ? st : (st === 'offer' || st === 'acceptance' ? 'joining' : 'jd');

function Field({ label, children }) { return <div className="field"><label>{label}</label>{children}</div>; }
function Pill({ text, color }) { return <span className="pill" style={{ background: color || 'var(--muted)' }}>{text}</span>; }

export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(sessionStorage.getItem('po_user') || 'null'); } catch { return null; } });
  const login = (u) => { sessionStorage.setItem('po_user', JSON.stringify(u)); setUser(u); };
  const logout = () => { sessionStorage.removeItem('po_user'); setUser(null); };
  if (!user) return <Login onLogin={login} />;
  return <Dashboard user={user} onLogout={logout} />;
}

function Login({ onLogin }) {
  const api = useMemo(() => makeApi(null), []);
  const [role, setRole] = useState('hr');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(''); setBusy(true);
    const d = await api.call('/login', 'POST', { username: role, password: pw });
    setBusy(false);
    if (d.success) onLogin(d.user); else setErr(d.error || 'Login failed.');
  };
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand"><div className="logo">PO</div><div><div style={{ fontWeight: 900, fontSize: '1.1rem' }}>Pre-Onboarding</div><div className="sub">Smart World Developers</div></div></div>
        <p className="muted" style={{ fontSize: '.84rem' }}>Sign in with your role.</p>
        <div className="role-grid">
          {['admin', 'hr', 'hod', 'interviewer'].map(r => <div key={r} className={'chip' + (role === r ? ' on' : '')} onClick={() => setRole(r)}>{r.toUpperCase()}</div>)}
        </div>
        <Field label="Password"><input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="••••••••" /></Field>
        {err && <div className="note warn" style={{ marginBottom: 10 }}>{err}</div>}
        <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={submit}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }) {
  const api = useMemo(() => makeApi(user), [user]);
  const [list, setList] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(user.role === 'hod' ? 'hod' : 'active');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ department: '', role: '', grade: '', positions: 1, mrfRef: '', targetDate: '', jdText: '' });
  const [msg, setMsg] = useState('');
  const verRef = useRef('');

  const load = useCallback(async () => { const d = await api.call('/requirements'); if (d.success) setList(d.records); }, [api]);
  useEffect(() => {
    let alive = true; load();
    const t = setInterval(async () => { const v = await api.call('/requirements/version'); if (alive && v.success && v.version !== verRef.current) { verRef.current = v.version; load(); } }, 800);
    return () => { alive = false; clearInterval(t); };
  }, [load, api]);

  const isAdmin = user.role === 'admin', isInterviewer = user.role === 'interviewer';
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const create = async () => { if (!form.role && !form.department) return setMsg('Enter a role or department.'); const d = await api.call('/requirements', 'POST', form); if (d.success) { setForm({ department: '', role: '', grade: '', positions: 1, mrfRef: '', targetDate: '', jdText: '' }); setShowForm(false); load(); } else setMsg(d.error || 'Failed.'); };
  const needsHod = (r) => r.Stage === 'cv_shortlist' && r.CvSentForSelection && (r.candidates || []).some(c => (c.HodDecision || 'pending') === 'pending');
  const adminDelete = async (id, e) => { e.stopPropagation(); if (!window.confirm('Permanently delete this requirement and all candidates?')) return; const d = await api.call(`/requirements/${id}`, 'DELETE'); if (d.success) load(); };

  const filtered = list.filter(r => {
    const s = search.trim().toLowerCase();
    const ms = !s || [r.Role, r.Department, r.MrfRef].filter(Boolean).some(x => x.toLowerCase().includes(s));
    const mf = filter === 'all' ? true : filter === 'hod' ? needsHod(r) : filter === 'active' ? r.Status === 'active' : filter === 'closed' ? r.Status === 'closed' : r.Status === filter;
    return ms && mf;
  });
  const openRec = openId ? list.find(x => x.Id === openId) : null;

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand"><div className="logo">PO</div><div><div style={{ fontWeight: 900 }}>Pre-Onboarding</div><div className="sub">Smart World Developers</div></div></div>
        <div className="spacer" />
        <div className="who muted">Signed in as <b style={{ color: 'var(--text)' }}>{user.name}</b> ({user.role})</div>
        <button className="btn ghost sm" onClick={onLogout}>Log out</button>
      </div>

      {openRec ? (
        <RequirementDetail user={user} api={api} record={openRec} reload={load} onClose={() => setOpenId(null)} />
      ) : (
        <>
          {!showForm && !isInterviewer && <button className="btn" style={{ marginBottom: 16 }} onClick={() => { setShowForm(true); setMsg(''); }}>+ New requirement (JD)</button>}
          {showForm && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>New requirement — Stage 1 (JD)</h3>
              <div className="grid2">
                <Field label="Department"><input value={form.department} onChange={e => set('department', e.target.value)} /></Field>
                <Field label="Role / position"><input value={form.role} onChange={e => set('role', e.target.value)} /></Field>
                <Field label="Grade / band"><input value={form.grade} onChange={e => set('grade', e.target.value)} /></Field>
                <Field label="No. of positions"><input type="number" min="1" value={form.positions} onChange={e => set('positions', e.target.value)} /></Field>
                <Field label="MRF reference"><input value={form.mrfRef} onChange={e => set('mrfRef', e.target.value)} /></Field>
                <Field label="Target date"><input type="date" value={form.targetDate} onChange={e => set('targetDate', e.target.value)} /></Field>
              </div>
              <Field label="Job description (JD)"><textarea rows="4" value={form.jdText} onChange={e => set('jdText', e.target.value)} placeholder="Paste the JD (you can also upload a file on the JD step)." /></Field>
              <div className="row"><button className="btn" onClick={create}>Create</button><button className="btn ghost" onClick={() => setShowForm(false)}>Cancel</button>{msg && <span className="muted" style={{ fontSize: '.82rem' }}>{msg}</span>}</div>
            </div>
          )}

          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Requirements</h3>
              <span className="pill" style={{ background: 'var(--green)' }}>● LIVE</span>
              <div className="spacer" />
              <input style={{ maxWidth: 240 }} placeholder="Search role / dept / MRF…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="row wrap" style={{ marginBottom: 12 }}>
              {[['active', 'Active'], ['hod', 'HOD review'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => {
                const count = k === 'all' ? list.length : k === 'hod' ? list.filter(needsHod).length : list.filter(r => r.Status === k).length;
                return <div key={k} className={'chip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l} <b>{count}</b></div>;
              })}
            </div>
            {filtered.length === 0 && <p className="muted">No requirements.</p>}
            {filtered.map(r => (
              <div key={r.Id} className="list-row">
                <div style={{ flex: 1 }}>
                  <div className="title">{r.Role || '(role)'} <span className="sub">· {r.Department || '—'}{r.Positions ? ` · ${r.Positions} pos` : ''}{r.MrfRef ? ` · ${r.MrfRef}` : ''}</span></div>
                  <div className="sub">{(r.candidates || []).length} candidate(s){r.Status !== 'active' ? ` · ${r.Status}` : ''}</div>
                </div>
                {needsHod(r) && <Pill text="HOD review" color="var(--orange)" />}
                {r.DeleteRequested ? <Pill text="Delete requested" color="var(--red)" /> : null}
                <Pill text={SHORT(norm(r.Stage))} color={STAGE_COLOR[norm(r.Stage)]} />
                <button className="btn ghost sm" onClick={() => setOpenId(r.Id)}>Open</button>
                {isAdmin && <button className="btn danger-ghost sm" onClick={(e) => adminDelete(r.Id, e)}>Delete</button>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RequirementDetail({ user, api, record, reload, onClose }) {
  const [r, setR] = useState(record);
  const [viewStage, setViewStage] = useState(norm(record.Stage));
  const [cand, setCand] = useState({ name: '', email: '' });
  const [joinDates, setJoinDates] = useState({});
  const [msg, setMsg] = useState('');
  useEffect(() => { setR(record); }, [record]);
  useEffect(() => { setViewStage(norm(r.Stage)); }, [r.Stage]);

  const role = user.role, isAdmin = role === 'admin', isHr = role === 'hr', isHod = role === 'hod', isInterviewer = role === 'interviewer';
  const canActStage = (st) => isAdmin || (STAGE_ACT[st] || []).includes(role);
  const cands = r.candidates || [];
  const accepted = cands.filter(c => c.HodDecision === 'accepted');
  const idx = Math.max(0, STAGES.indexOf(norm(r.Stage)));
  const channels = (() => { try { return JSON.parse(r.SourcingChannels || '[]'); } catch { return []; } })();

  const refresh = async () => { const d = await api.call('/requirements'); if (d.success) { const u = d.records.find(x => x.Id === r.Id); if (u) setR(u); } };
  const save = async (patch) => { const d = await api.call(`/requirements/${r.Id}`, 'PUT', patch); if (d.success) { await refresh(); reload(); setMsg('Saved.'); } else window.alert(d.error || 'Failed.'); };
  const goStage = (s) => save({ stage: s });
  const saveCand = async (cid, patch) => { const d = await api.call(`/candidates/${cid}`, 'PUT', patch); if (d.success) { await refresh(); reload(); } else window.alert(d.error || 'Failed.'); };
  const addCand = async () => { if (!cand.name.trim()) return; const d = await api.call(`/requirements/${r.Id}/candidates`, 'POST', cand); if (d.success) { setCand({ name: '', email: '' }); await refresh(); reload(); } };
  const delCand = async (cid) => { if (!window.confirm('Remove this candidate?')) return; const d = await api.call(`/candidates/${cid}`, 'DELETE'); if (d.success) { await refresh(); reload(); } };
  const uploadCVs = async (files) => { for (const f of files) { const b = await readBase64(f); await api.call(`/requirements/${r.Id}/cv`, 'POST', { fileName: f.name, dataBase64: b }); } await refresh(); reload(); };
  const uploadJd = async (file) => { const b = await readBase64(file); const d = await api.call(`/requirements/${r.Id}/jd-upload`, 'POST', { fileName: file.name, dataBase64: b }); if (d.success) { await refresh(); reload(); } };
  const requestDelete = async () => { const why = window.prompt('Delete this requirement? Reason goes to Admin:'); if (why === null) return; const d = await api.call(`/requirements/${r.Id}/request-delete`, 'POST', { reason: why }); if (d.success) { window.alert('Deletion requested — pending Admin.'); await refresh(); reload(); } };
  const deleteNow = async () => { if (!window.confirm('Permanently delete this requirement and all candidates?')) return; const d = await api.call(`/requirements/${r.Id}`, 'DELETE'); if (d.success) { reload(); onClose(); } };
  const toggleChannel = (c) => { const nx = channels.includes(c) ? channels.filter(x => x !== c) : [...channels, c]; save({ sourcingChannels: nx }); };

  const gateMsg = (() => {
    switch (r.Stage) {
      case 'jd': return (r.JdText && String(r.JdText).trim()) || r.JdFileName ? null : 'Add the JD (text or file).';
      case 'review_post': return channels.length ? null : 'Tick where the JD was posted.';
      case 'cv_shortlist': { if (!cands.length) return 'Upload at least one CV.'; if (!r.CvSentForSelection) return 'Send the CVs for HOD selection.'; const p = cands.filter(c => (c.HodDecision || 'pending') === 'pending'); if (p.length) return `HOD must review ${p.length} CV(s).`; if (!cands.some(c => c.HodDecision === 'accepted')) return 'HOD has not accepted any CV.'; return null; }
      case 'scheduling': return accepted.some(c => ['scheduled', 'in_progress', 'arrived'].includes(c.InterviewStatus) || c.Outcome) ? null : 'Approve at least one interview time.';
      case 'interview': return cands.some(c => c.Outcome) ? null : 'Record at least one approved outcome.';
      case 'selection': return r.SelectedCandidateId ? null : 'Take a candidate forward.';
      default: return null;
    }
  })();
  const stagePending = (s) => {
    switch (s) {
      case 'jd': return ((r.JdText && String(r.JdText).trim()) || r.JdFileName) ? 0 : 1;
      case 'review_post': return channels.length ? 0 : 1;
      case 'cv_shortlist': return cands.filter(c => (c.HodDecision || 'pending') === 'pending').length;
      case 'scheduling': return accepted.filter(c => !['scheduled', 'in_progress', 'arrived'].includes(c.InterviewStatus) && !c.Outcome).length;
      case 'interview': return accepted.filter(c => ['scheduled', 'in_progress', 'arrived'].includes(c.InterviewStatus) && !c.Outcome).length;
      case 'selection': return r.SelectedCandidateId ? 0 : cands.filter(c => c.Outcome === 'Selected').length;
      case 'joining': return r.Status === 'closed' ? 0 : 1;
      default: return 0;
    }
  };
  const editable = canActStage(viewStage) && viewStage === r.Stage && !['closed', 'dropped'].includes(r.Status);
  const viewReason = !canActStage(viewStage) ? `Handled by ${STAGE_OWNER[viewStage]} — view only for you.`
    : viewStage !== r.Stage ? `Earlier step — view only. Live step: ${STAGE_LABEL[r.Stage] || r.Stage}.`
      : ['closed', 'dropped'].includes(r.Status) ? 'This requirement is closed — view only.' : '';

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={onClose}>← All requirements</button>
        <div style={{ flex: 1 }}>
          <div className="title" style={{ fontSize: '1.1rem' }}>{r.Role || '(role)'} — {STAGE_LABEL[norm(r.Stage)]}</div>
          <div className="sub">{[r.Department, `${r.Positions || 1} position(s)`, `owned by ${STAGE_OWNER[norm(r.Stage)]}`, r.MrfRef].filter(Boolean).join('  ·  ')}</div>
        </div>
        <Pill text={SHORT(norm(r.Stage))} color={STAGE_COLOR[norm(r.Stage)]} />
      </div>

      <div className="tabs">
        {STAGES.map((s, i) => {
          const locked = i > idx, cnt = stagePending(s);
          return <div key={s} className={'tab' + (s === viewStage ? ' active' : i < idx ? ' done' : locked ? ' locked' : '')} onClick={() => !locked && setViewStage(s)}>
            {locked ? '🔒 ' : ''}{i + 1}. {SHORT(s)}{s === r.Stage ? ' ●' : ''}{!locked && cnt > 0 ? <span className="badge-red">{cnt}</span> : null}
          </div>;
        })}
      </div>
      <p className="sub" style={{ margin: '4px 0 12px' }}>Steps unlock one by one as each is completed. 🔒 = not reached yet.</p>

      <div className="card">
        {r.DeleteRequested && (
          <div className="note warn" style={{ marginBottom: 12 }}>
            Deletion requested{r.DeleteRequestedBy ? ` by ${r.DeleteRequestedBy}` : ''}{r.DeleteReason ? ` — ${r.DeleteReason}` : ''}.
            {isAdmin && <div className="row" style={{ marginTop: 8 }}><button className="btn red sm" onClick={deleteNow}>Approve deletion</button><button className="btn ghost sm" onClick={() => api.call(`/requirements/${r.Id}/reject-delete`, 'POST', {}).then(refresh)}>Reject</button></div>}
          </div>
        )}

        {viewReason && <div className="note" style={{ marginBottom: 12 }}>🔒 {viewReason}</div>}
        <div style={{ opacity: editable ? 1 : 0.5, pointerEvents: editable ? 'auto' : 'none' }}>

          {viewStage === 'jd' && (
            <div>
              <div className="grid2">
                <Field label="Department"><input defaultValue={r.Department || ''} onBlur={e => save({ department: e.target.value })} /></Field>
                <Field label="Role"><input defaultValue={r.Role || ''} onBlur={e => save({ role: e.target.value })} /></Field>
                <Field label="Grade"><input defaultValue={r.Grade || ''} onBlur={e => save({ grade: e.target.value })} /></Field>
                <Field label="Positions"><input type="number" defaultValue={r.Positions || 1} onBlur={e => save({ positions: e.target.value })} /></Field>
              </div>
              <Field label="Job description"><textarea rows="5" defaultValue={r.JdText || ''} onBlur={e => save({ jdText: e.target.value })} /></Field>
              <div className="row wrap">
                <label className="btn ghost sm" style={{ cursor: 'pointer' }}>{r.JdFileName ? 'Replace JD file' : 'Upload JD file'}<input type="file" style={{ display: 'none' }} onChange={e => e.target.files[0] && uploadJd(e.target.files[0])} /></label>
                {r.JdFileName && <button className="btn ghost sm" onClick={() => api.openFile(`/requirements/${r.Id}/jd-file`)}>View JD ({r.JdFileName})</button>}
              </div>
              <p className="sub">The HOD shares the JD, then hands it to HR.</p>
            </div>
          )}

          {viewStage === 'review_post' && (
            <div>
              <p className="sub" style={{ marginTop: 0 }}>HR reviews and posts the JD. Tick where it was posted.</p>
              {r.JdFileName && <button className="btn ghost sm" style={{ marginBottom: 10 }} onClick={() => api.openFile(`/requirements/${r.Id}/jd-file`)}>View JD</button>}
              <div className="row wrap" style={{ marginBottom: 10 }}>{POST_CHANNELS.map(c => <span key={c} className={'chip' + (channels.includes(c) ? ' on' : '')} onClick={() => toggleChannel(c)}>{c}</span>)}</div>
              <Field label="Notes"><textarea rows="2" defaultValue={r.SourcingNotes || ''} onBlur={e => save({ sourcingNotes: e.target.value })} /></Field>
            </div>
          )}

          {viewStage === 'cv_shortlist' && (() => {
            const sent = !!r.CvSentForSelection;
            const allReviewed = cands.length > 0 && cands.every(c => (c.HodDecision || 'pending') !== 'pending');
            const anyAccepted = cands.some(c => c.HodDecision === 'accepted');
            return (
              <div>
                <div className="note warn" style={{ marginBottom: 12 }}>{!sent ? 'HR uploads CVs, then clicks Send for CV selection. The HOD accepts/rejects each, then HR sends for interview scheduling.' : 'CVs sent to the HOD. Once every CV is reviewed, HR sends the accepted ones for scheduling.'}</div>
                {(isHr || isAdmin) && !sent && (
                  <div className="row wrap" style={{ marginBottom: 10 }}>
                    <label className="btn" style={{ cursor: 'pointer' }}>+ Upload CVs (multiple)<input type="file" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files.length) uploadCVs([...e.target.files]); e.target.value = ''; }} /></label>
                    <button className="btn teal" disabled={cands.length === 0} onClick={() => { if (window.confirm(`Send ${cands.length} CV(s) to the HOD?`)) save({ cvSentForSelection: true }); }}>Send for CV selection →</button>
                  </div>
                )}
                {(isHr || isAdmin) && sent && <p className="sub" style={{ color: 'var(--teal)' }}>✓ Sent to HOD — {allReviewed ? (anyAccepted ? 'review complete.' : 'no CV accepted yet.') : `${cands.filter(c => (c.HodDecision || 'pending') === 'pending').length} awaiting review.`}</p>}
                {isHod && !sent && <p className="sub">Waiting for HR to send the CVs.</p>}
                {cands.length === 0 && <p className="muted">No CVs uploaded yet.</p>}
                {cands.map(c => (
                  <div key={c.Id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <input style={{ maxWidth: 210 }} defaultValue={c.Name} disabled={sent} onBlur={e => saveCand(c.Id, { name: e.target.value })} />
                    <div className="spacer" />
                    {c.CvFileName && <button className="btn ghost sm" onClick={() => api.openFile(`/candidates/${c.Id}/cv`)}>View CV</button>}
                    <Pill text={c.HodDecision === 'accepted' ? 'Accepted' : c.HodDecision === 'rejected' ? 'Rejected' : 'Pending'} color={c.HodDecision === 'accepted' ? 'var(--green)' : c.HodDecision === 'rejected' ? 'var(--red)' : 'var(--orange)'} />
                    {sent && (isHod || isAdmin) && c.HodDecision !== 'accepted' && <button className="btn green sm" onClick={() => saveCand(c.Id, { hodDecision: 'accepted' })}>Accept</button>}
                    {sent && (isHod || isAdmin) && c.HodDecision !== 'rejected' && <button className="btn danger-ghost sm" onClick={() => { const rm = window.prompt('Reject — remark (optional):') || ''; saveCand(c.Id, { hodDecision: 'rejected', hodRemark: rm }); }}>Reject</button>}
                    {!sent && (isHr || isAdmin) && <button className="btn danger-ghost sm" onClick={() => delCand(c.Id)}>✕</button>}
                  </div>
                ))}
                {(isHr || isAdmin) && sent && (
                  <div className="row wrap" style={{ marginTop: 12 }}>
                    <button className="btn teal" disabled={!(allReviewed && anyAccepted)} onClick={() => goStage('scheduling')}>Send for interview scheduling →</button>
                    {!(allReviewed && anyAccepted) && <span className="sub" style={{ color: 'var(--orange)' }}>{!allReviewed ? 'HOD must review every CV.' : 'HOD must accept at least one.'}</span>}
                    <button className="btn ghost sm" onClick={() => { if (window.confirm('Reopen uploads?')) save({ cvSentForSelection: false }); }}>Reopen uploads</button>
                  </div>
                )}
              </div>
            );
          })()}

          {viewStage === 'scheduling' && (
            <div>
              <p className="sub" style={{ marginTop: 0 }}>The interviewer proposes a time; HR approves/edits. The interview auto-starts at the approved time.</p>
              {accepted.length === 0 && <p className="muted">No HOD-accepted candidates yet.</p>}
              {accepted.map(c => <InterviewLifecycle key={c.Id} c={c} req={r} api={api} user={user} save={(p) => saveCand(c.Id, p)} />)}
            </div>
          )}

          {viewStage === 'interview' && (
            <div>
              <p className="sub" style={{ marginTop: 0 }}>Interviews auto-start at the scheduled time. The interviewer marks Arrived / Reschedule / No-show and fills the assessment; the HOD approves it (level 2).</p>
              {accepted.length === 0 && <p className="muted">No scheduled candidates yet.</p>}
              {accepted.map(c => <InterviewLifecycle key={c.Id} c={c} req={r} api={api} user={user} save={(p) => saveCand(c.Id, p)} />)}
            </div>
          )}

          {viewStage === 'selection' && (
            <div>
              <p className="sub" style={{ marginTop: 0 }}>Positions: {r.Positions || 1}. Set the joining date and take a candidate forward.</p>
              {cands.filter(c => c.Outcome).length === 0 && <p className="muted">No interview outcomes yet.</p>}
              {cands.filter(c => c.Outcome).map(c => (
                <div key={c.Id} className="cand" style={r.SelectedCandidateId === c.Id ? { borderColor: 'var(--green)' } : null}>
                  <div className="row wrap">
                    <div style={{ flex: 1 }}><div className="title">{c.Name}{r.SelectedCandidateId === c.Id ? ' ★' : ''}</div><div className="sub">Outcome: {c.Outcome}{c.InterviewerName ? ` · by ${c.InterviewerName}` : ''}</div></div>
                    <Pill text={c.Outcome} color={OUTCOME_COLOR[c.Outcome]} />
                    {c.Outcome === 'Selected' && <>
                      <div style={{ maxWidth: 150 }}><Field label="Joining date"><input type="date" value={joinDates[c.Id] ?? dv(c.JoiningDate)} onChange={e => setJoinDates(s => ({ ...s, [c.Id]: e.target.value }))} /></Field></div>
                      <button className="btn sm" onClick={() => { const jd = joinDates[c.Id] ?? dv(c.JoiningDate); if (!jd) return window.alert('Enter a joining date first.'); save({ selectedCandidateId: c.Id }); saveCand(c.Id, { candStatus: 'selected', joiningDate: jd }); }}>Take forward</button>
                    </>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {viewStage === 'joining' && (() => {
            const sel = cands.find(c => c.Id === r.SelectedCandidateId);
            if (!sel) return <p style={{ color: 'var(--red)' }}>Take a candidate forward at the Selection step first.</p>;
            const closed = r.Status === 'closed';
            return (
              <div>
                <div className="title" style={{ marginBottom: 8 }}>{sel.Name}</div>
                <div style={{ maxWidth: 240 }}><Field label="Joining date (HR)"><input type="date" disabled={closed} defaultValue={dv(sel.JoiningDate)} onBlur={e => saveCand(sel.Id, { joiningDate: e.target.value })} /></Field></div>
                {closed ? <p style={{ color: 'var(--green)', fontWeight: 700 }}>✓ Candidate joined — ticket closed{sel.JoiningDate ? ` (${dv(sel.JoiningDate)})` : ''}.</p> : (
                  <>
                    <div className="row wrap">
                      <button className="btn green" disabled={!sel.JoiningDate} onClick={() => { if (window.confirm('Mark arrived / joined? This closes the ticket.')) save({ status: 'closed' }); }}>Arrived — close ticket</button>
                      <button className="btn ghost" onClick={() => { if (window.confirm("Didn't join — keep open and pick another candidate?")) save({ selectedCandidateId: null }); }}>Didn't join — keep open</button>
                    </div>
                    <DocChecklist c={sel} api={api} reload={async () => { await refresh(); reload(); }} />
                  </>
                )}
              </div>
            );
          })()}

          {['cv_shortlist', 'scheduling', 'selection', 'joining'].includes(viewStage) && (isHr || isAdmin) && r.Status !== 'closed' && (
            <div className="row wrap" style={{ marginTop: 10 }}>
              <input style={{ maxWidth: 180 }} placeholder="Add candidate name" value={cand.name} onChange={e => setCand(s => ({ ...s, name: e.target.value }))} />
              <input style={{ maxWidth: 180 }} placeholder="Email" value={cand.email} onChange={e => setCand(s => ({ ...s, email: e.target.value }))} />
              <button className="btn ghost sm" onClick={addCand}>+ Add manually</button>
            </div>
          )}
        </div>
      </div>

      {(isAdmin || (r.Stage === 'jd' ? isHod : isHr)) && (
        <div className="row wrap" style={{ marginTop: 14 }}>
          {viewStage === r.Stage && idx > 0 && <button className="btn ghost" onClick={() => goStage(STAGES[idx - 1])}>← Back</button>}
          {viewStage === r.Stage && idx < STAGES.length - 1 && r.Stage !== 'cv_shortlist' && <button className="btn" onClick={() => goStage(STAGES[idx + 1])}>{r.Stage === 'jd' ? 'Send to HR (Review & Post) →' : `Advance to ${STAGE_LABEL[STAGES[idx + 1]]} →`}</button>}
          {r.Status === 'active' ? <button className="btn ghost" onClick={() => save({ status: 'on_hold' })}>Put on hold</button> : r.Status === 'on_hold' ? <button className="btn ghost" onClick={() => save({ status: 'active' })}>Resume</button> : null}
          <button className="btn danger-ghost" onClick={() => { const why = window.prompt('Reason for dropping?') || ''; save({ status: 'dropped', dropReason: why }); }}>Drop</button>
          {isAdmin ? <button className="btn red" onClick={deleteNow}>Delete entry</button> : (!r.DeleteRequested && <button className="btn danger-ghost" onClick={requestDelete}>Request delete</button>)}
          {viewStage === r.Stage && idx < STAGES.length - 1 && (gateMsg ? <span className="sub" style={{ color: 'var(--orange)', fontWeight: 600 }}>⚠ Pending: {gateMsg}</span> : <span className="sub" style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Ready to advance</span>)}
          {viewStage !== r.Stage && <span className="sub">Viewing {STAGE_LABEL[viewStage]} · live is {STAGE_LABEL[r.Stage]}</span>}
        </div>
      )}
    </div>
  );
}

function InterviewLifecycle({ c, req, api, user, save }) {
  const role = user.role, isHr = role === 'hr', isHod = role === 'hod', isInterviewer = role === 'interviewer', isAdmin = role === 'admin';
  const [assess, setAssess] = useState(false);
  const [d, setD] = useState(dv(c.InterviewDate));
  const [t, setT] = useState(c.InterviewTime || '');
  const [, tick] = useState(0);
  useEffect(() => { setD(dv(c.InterviewDate)); setT(c.InterviewTime || ''); }, [c.Id, c.InterviewDate, c.InterviewTime]);
  useEffect(() => { const iv = setInterval(() => tick(x => x + 1), 20000); return () => clearInterval(iv); }, []);
  const st = c.InterviewStatus || 'none';
  const schedDT = c.InterviewDate && c.InterviewTime ? new Date(`${dv(c.InterviewDate)}T${c.InterviewTime}`) : (c.InterviewDate ? new Date(dv(c.InterviewDate)) : null);
  const due = schedDT && !isNaN(schedDT) && Date.now() >= schedDT.getTime();
  const live = st === 'in_progress' || (st === 'scheduled' && due);
  const canPropose = isInterviewer || isAdmin, canApprove = isHr || isAdmin, canRun = isInterviewer || isAdmin;
  const aStatus = c.AssessmentStatus || (c.Outcome ? 'approved' : 'draft');
  const viewCv = () => c.CvFileName ? api.openFile(`/candidates/${c.Id}/cv`) : window.alert('No CV on file.');

  return (
    <div className="cand">
      <div className="row wrap">
        <div className="title" style={{ flex: 1 }}>{c.Name}</div>
        {st === 'none' && <Pill text="No time yet" color="var(--muted)" />}
        {st === 'time_proposed' && <Pill text="Proposed · awaiting HR" color="var(--orange)" />}
        {st === 'scheduled' && !live && <Pill text={`Scheduled · ${dv(c.InterviewDate)} ${c.InterviewTime || ''}`} color="var(--accent)" />}
        {live && st !== 'arrived' && !c.Outcome && <Pill text="In progress" color="var(--teal)" />}
        {st === 'reschedule' && <Pill text="Rescheduled — needs time" color="var(--orange)" />}
        {st === 'no_show' && <Pill text="No-show — needs time" color="var(--red)" />}
        {c.Outcome && <Pill text={c.Outcome} color={OUTCOME_COLOR[c.Outcome]} />}
      </div>

      {['none', 'reschedule', 'no_show'].includes(st) && !c.Outcome && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          {canPropose ? <>
            <input type="date" style={{ maxWidth: 150 }} value={d} onChange={e => setD(e.target.value)} />
            <input placeholder="Time (15:30)" style={{ maxWidth: 120 }} value={t} onChange={e => setT(e.target.value)} />
            <button className="btn sm" onClick={() => { if (!d) return window.alert('Pick a date.'); save({ interviewDate: d, interviewTime: t, interviewStatus: 'time_proposed' }); }}>Propose time → HR</button>
          </> : <span className="sub">Waiting for the interviewer to propose a time.</span>}
        </div>
      )}
      {st === 'time_proposed' && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          {canApprove ? <>
            <input type="date" style={{ maxWidth: 150 }} value={d} onChange={e => setD(e.target.value)} />
            <input placeholder="Time" style={{ maxWidth: 120 }} value={t} onChange={e => setT(e.target.value)} />
            <button className="btn green sm" onClick={() => save({ interviewDate: d, interviewTime: t, interviewStatus: 'scheduled' })}>Approve time</button>
          </> : <span className="sub">Proposed {dv(c.InterviewDate)} {c.InterviewTime} — awaiting HR approval.</span>}
        </div>
      )}
      {st === 'scheduled' && !live && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          <span className="sub">Starts automatically at {dv(c.InterviewDate)} {c.InterviewTime}.</span>
          {canRun && <button className="btn teal sm" onClick={() => save({ interviewStatus: 'in_progress' })}>Start now</button>}
          {canApprove && <button className="btn ghost sm" onClick={() => save({ interviewStatus: 'time_proposed' })}>Edit time</button>}
        </div>
      )}
      {live && st !== 'arrived' && !c.Outcome && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          {canRun ? <>
            <button className="btn green sm" onClick={() => save({ interviewStatus: 'arrived' })}>Arrived</button>
            <button className="btn ghost sm" onClick={() => { if (window.confirm('Reschedule reopens the ticket.')) save({ interviewStatus: 'reschedule', interviewDate: null, interviewTime: null }); }}>Reschedule</button>
            <button className="btn danger-ghost sm" onClick={() => { if (window.confirm('No-show reopens the ticket.')) save({ interviewStatus: 'no_show', interviewDate: null, interviewTime: null }); }}>No-show</button>
          </> : <span className="sub">Interview in progress.</span>}
        </div>
      )}
      {(st === 'arrived' || c.Outcome || c.AssessmentStatus) && (
        <div style={{ marginTop: 8 }}>
          <div className="row wrap">
            {c.CvFileName && <button className="btn ghost sm" onClick={viewCv}>📄 View CV</button>}
            {aStatus === 'pending_hod' && <Pill text="Level 2 · awaiting HOD" color="var(--orange)" />}
            {aStatus === 'rejected' && <Pill text="HOD sent back" color="var(--red)" />}
            {aStatus === 'approved' && <Pill text="HOD approved" color="var(--green)" />}
            {canRun && aStatus !== 'approved' && aStatus !== 'pending_hod' && <button className="btn ghost sm" onClick={() => setAssess(a => !a)}>{assess ? 'Close form' : (c.Assessment ? 'Edit assessment' : 'Fill assessment form')}</button>}
            {(isHod || isAdmin) && aStatus === 'pending_hod' && <button className="btn ghost sm" onClick={() => setAssess(a => !a)}>{assess ? 'Close' : 'Review assessment (level 2)'}</button>}
            {canRun && aStatus === 'pending_hod' && <span className="sub">Sent to HOD for level-2 approval.</span>}
          </div>
          {assess && <AssessmentForm c={c} req={req} viewCv={c.CvFileName ? viewCv : null}
            hodMode={(isHod || isAdmin) && !isInterviewer && aStatus === 'pending_hod'}
            onReject={() => { const rm = window.prompt('Send back — remark (optional):') || ''; save({ assessmentStatus: 'rejected', hodRemark: rm }); setAssess(false); }}
            onSave={(patch, keepOpen) => { save(patch); if (!keepOpen) setAssess(false); }} />}
        </div>
      )}
    </div>
  );
}

function AssessmentForm({ c, req, onSave, viewCv, hodMode, onReject }) {
  const parsed = (() => { try { return JSON.parse(c.Assessment || 'null'); } catch { return null; } })();
  const init = parsed || { position: req.Role || '', department: req.Department || '', expectedCtc: '', currentCtc: '', noticePeriod: '', experience: '', dob: '', qualification: '', maritalStatus: '', source: '', interviewedEarlier: 'No', ratings: {}, comments: {}, knowledge: '', experienceInput: '', exposure: '', date: new Date().toISOString().slice(0, 10) };
  const [f, setF] = useState(init);
  const [interviewer, setInterviewer] = useState(c.InterviewerName || '');
  const [outcome, setOutcome] = useState((parsed && parsed.status) || c.Outcome || '');
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const setRating = (crit, v) => setF(s => ({ ...s, ratings: { ...s.ratings, [crit]: v } }));
  const setComment = (crit, v) => setF(s => ({ ...s, comments: { ...s.comments, [crit]: v } }));
  const saveDraft = () => onSave({ assessment: { ...f, status: outcome }, interviewerName: interviewer, assessmentStatus: 'draft' }, true);
  const sendForApproval = () => { if (!outcome) return window.alert('Select a recommendation first.'); onSave({ assessment: { ...f, status: outcome }, interviewerName: interviewer, assessmentStatus: 'pending_hod' }, false); };
  const approve = () => { if (!outcome) return window.alert('Select a recommendation.'); onSave({ assessment: { ...f, status: outcome }, interviewerName: interviewer, outcome, assessmentStatus: 'approved', candStatus: outcome === 'Selected' ? 'selected' : outcome === 'Not Suitable' ? 'rejected' : 'interviewing' }, false); };

  return (
    <div className="card" style={{ marginTop: 10, background: 'var(--bg-2)' }}>
      <div className="row"><div className="title" style={{ flex: 1 }}>Interview Assessment — {c.Name}</div>{viewCv && <button className="btn ghost sm" onClick={viewCv}>📄 View CV</button>}</div>
      <div className="grid3" style={{ marginTop: 10 }}>
        <Field label="Position"><input value={f.position} onChange={e => set('position', e.target.value)} /></Field>
        <Field label="Department"><input value={f.department} onChange={e => set('department', e.target.value)} /></Field>
        <Field label="Qualification"><input value={f.qualification} onChange={e => set('qualification', e.target.value)} /></Field>
        <Field label="Experience"><input value={f.experience} onChange={e => set('experience', e.target.value)} /></Field>
        <Field label="Current CTC"><input value={f.currentCtc} onChange={e => set('currentCtc', e.target.value)} /></Field>
        <Field label="Expected CTC"><input value={f.expectedCtc} onChange={e => set('expectedCtc', e.target.value)} /></Field>
        <Field label="Notice period"><input value={f.noticePeriod} onChange={e => set('noticePeriod', e.target.value)} /></Field>
        <Field label="DOB"><input type="date" value={f.dob} onChange={e => set('dob', e.target.value)} /></Field>
        <Field label="Marital status"><input value={f.maritalStatus} onChange={e => set('maritalStatus', e.target.value)} /></Field>
      </div>
      <label className="field"><span style={{ display: 'block', fontSize: '.74rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Evaluation (one rating per row)</span></label>
      {ASSESS_CRITERIA.map(crit => (
        <div key={crit} className="row wrap" style={{ marginBottom: 6 }}>
          <span style={{ minWidth: 150, fontSize: '.82rem' }}>{crit}</span>
          {ASSESS_RATINGS.map(rt => <label key={rt.v} className="sub" style={{ display: 'flex', alignItems: 'center', gap: 3 }}><input type="radio" style={{ width: 'auto' }} name={`r-${c.Id}-${crit}`} checked={f.ratings[crit] === rt.v} onChange={() => setRating(crit, rt.v)} />{rt.l}</label>)}
          <input placeholder="Comment" style={{ maxWidth: 150 }} value={f.comments[crit] || ''} onChange={e => setComment(crit, e.target.value)} />
        </div>
      ))}
      <Field label="Knowledge"><textarea rows="2" value={f.knowledge} onChange={e => set('knowledge', e.target.value)} /></Field>
      <Field label="Experience"><textarea rows="2" value={f.experienceInput} onChange={e => set('experienceInput', e.target.value)} /></Field>
      <Field label="Exposure"><textarea rows="2" value={f.exposure} onChange={e => set('exposure', e.target.value)} /></Field>
      <div className="grid2"><Field label="Interviewer name"><input value={interviewer} onChange={e => setInterviewer(e.target.value)} /></Field><Field label="Date"><input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></Field></div>
      <label className="field"><span style={{ display: 'block', fontSize: '.74rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Status / recommendation</span></label>
      <div className="row" style={{ marginBottom: 12 }}>{['Selected', 'On Hold', 'Not Suitable'].map(o => <span key={o} className="chip" style={outcome === o ? { background: OUTCOME_COLOR[o], borderColor: OUTCOME_COLOR[o], color: '#fff' } : null} onClick={() => setOutcome(o)}>{o}</span>)}</div>
      {hodMode ? (
        <div className="row wrap"><button className="btn ghost" onClick={() => onSave({ assessment: { ...f, status: outcome }, interviewerName: interviewer }, true)}>Save changes</button><button className="btn green" onClick={approve}>Approve (level 2)</button><button className="btn danger-ghost" onClick={onReject}>Reject — send back</button></div>
      ) : (
        <div className="row wrap"><button className="btn ghost" onClick={saveDraft}>Save draft</button><button className="btn teal" onClick={sendForApproval}>Send to level 2 for HOD approval →</button></div>
      )}
    </div>
  );
}

function DocChecklist({ c, api, reload }) {
  const docs = (() => { try { return JSON.parse(c.Documents || '[]'); } catch { return DOCS.map(d => ({ ...d, received: false })); } })();
  const save = (patch) => api.call(`/candidates/${c.Id}`, 'PUT', patch).then(d => { if (d.success) reload(); else window.alert(d.error || 'Failed.'); });
  const toggle = (key) => save({ documents: docs.map(d => d.key === key ? { ...d, received: !d.received } : d) });
  const upload = async (key, file) => { const b = await readBase64(file); const d = await api.call(`/candidates/${c.Id}/doc-upload`, 'POST', { key, fileName: file.name, dataBase64: b }); if (d.success) reload(); else window.alert(d.error || 'Failed.'); };
  const del = async (key, lbl) => { if (!window.confirm(`Remove the file for "${lbl}"?`)) return; const d = await api.call(`/candidates/${c.Id}/doc/${key}`, 'DELETE'); if (d.success) reload(); };
  return (
    <div style={{ marginTop: 14 }}>
      <div className="sub" style={{ fontWeight: 700, marginBottom: 6 }}>Documents (tick when received; upload optional)</div>
      {docs.map(d => (
        <div key={d.key} className="row" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
          <label className="row" style={{ flex: 1, cursor: 'pointer' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!d.received} onChange={() => toggle(d.key)} />{d.label}</label>
          {d.fileName && <button className="btn ghost sm" onClick={() => api.openFile(`/candidates/${c.Id}/doc/${d.key}`)}>View</button>}
          {d.fileName && <button className="btn danger-ghost sm" onClick={() => del(d.key, d.label)}>Delete</button>}
          <label className="btn ghost sm" style={{ cursor: 'pointer' }}>{d.fileName ? 'Replace' : 'Upload'}<input type="file" style={{ display: 'none' }} onChange={e => e.target.files[0] && upload(d.key, e.target.files[0])} /></label>
        </div>
      ))}
    </div>
  );
}
