# Pre-Onboarding SWD

Standalone recruitment / pre-onboarding pipeline for Smart World Developers.
Fresh React + Vite frontend and a Node/Express + SQL Server backend — self-contained,
separate from SmartDesk.

## Pipeline (7 steps, locked wizard — each unlocks after the previous completes)
1. **JD & Requirement** — HOD shares the JD (text or file); hands to HR.
2. **Review & Post** — HR reviews and marks where the JD was posted.
3. **CV Shortlist** — HR uploads CVs → **Send for CV selection** → HOD Accepts/Rejects → **Send for interview scheduling**.
4. **Scheduling** — Interviewer proposes a time → HR approves/edits → auto-starts at the time.
5. **Interview** — Interviewer marks Arrived/Reschedule/No-show, fills the assessment form (with CV alongside), sends for **level-2 HOD approval**; HOD edits/approves/rejects.
6. **Selection** — HR takes a Selected candidate forward **with a joining date**.
7. **Joining** — HR confirms **Arrived → ticket closes**, or keeps it open (and can add more candidates); document checklist.

## Roles / logins
`admin`, `hr`, `hod`, `interviewer` — same password (set `LOGIN_PASSWORD` in backend `.env`).
Each role sees/acts only on its own steps; other steps are greyed/read-only. Admin can delete directly; HR/HOD request deletion (admin approves).

## Run

### Backend (port 5098)
```
cd backend
cp .env.example .env      # fill in SQL Server details + LOGIN_PASSWORD
npm install
npm start                 # creates the DB/tables on first run ("✓ Tables ready")
```

### Frontend (port 91)
```
cd frontend
npm install
npm run dev               # dev server
# or: npm run build && npm run preview
```
The frontend calls the backend at `http://<same-host>:5098/api` (override with `VITE_API_BASE`).

## Notes
- Uploaded files live on the backend disk under `backend/uploads/` (git-ignored) — back this folder up.
- Live updates via a 0.8s version-poll.
- Login is role-based with a shared password held server-side; for real per-person security, add proper auth.
