// API base: same host as the page, backend on :5098 (override with VITE_API_BASE)
const API = (import.meta.env.VITE_API_BASE) || `http://${window.location.hostname}:5098/api`;
export const API_BASE = API;

export function makeApi(user) {
  const headers = () => ({ 'Content-Type': 'application/json', 'x-user-role': user?.role || '', 'x-user-name': user?.name || '' });
  const call = async (path, method = 'GET', body) => {
    try {
      const res = await fetch(`${API}${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
      return await res.json();
    } catch (e) { return { success: false, error: 'Cannot reach the server. Is the backend running on :5098?' }; }
  };
  // fetch a file (with auth headers) and open it in a new tab
  const openFile = async (path) => {
    try {
      const res = await fetch(`${API}${path}`, { headers: { 'x-user-role': user?.role || '', 'x-user-name': user?.name || '' } });
      if (!res.ok) { window.alert('Could not open the file (' + res.status + ').'); return; }
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { window.alert('Could not reach the server.'); }
  };
  return { call, openFile };
}

export const readBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
