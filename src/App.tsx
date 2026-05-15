import { useState, useEffect, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

interface Provider {
  id: string;
  provider_type: string;
  provider_uid: string;
  provider_username: string;
  created_at: string;
}

interface JwtSession {
  id: string;
  user_id: string;
  ip_address: string;
  created_at: string;
}

interface User {
  id: string;
  name: string;
  avatar: string;
  email: string | null;
  role: string;
  status: string;
  created_at: string;
  provider?: Provider[];
  jwt_token?: JwtSession[];
}

interface AuthResponse {
  detail: string;
  csrf_token: string;
}

interface JWK {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

interface ApiLog {
  id: number;
  method: string;
  url: string;
  status: number;
  time: string;
  request?: string;
  response?: string;
}

// =============================================================================
// Config
// =============================================================================

const API_BASE = window.location.port === '5173' ? 'http://localhost:8000' : 'https://api.fixvolvv.ru';
const CSRF_STORAGE_KEY = 'alastaauth_csrf_token';

const getCsrfToken = (): string | null => localStorage.getItem(CSRF_STORAGE_KEY);
const setCsrfToken = (t: string) => localStorage.setItem(CSRF_STORAGE_KEY, t);
const clearCsrfToken = () => localStorage.removeItem(CSRF_STORAGE_KEY);

// =============================================================================
// API Client
// =============================================================================

let logId = 0;

const createApiClient = (addLog: (l: ApiLog) => void) => {
  const request = async (
    method: string,
    endpoint: string,
    opts: { body?: unknown; contentType?: string; includeCsrf?: boolean } = {},
  ) => {
    const { body, contentType = 'application/json', includeCsrf = false } = opts;
    const headers: Record<string, string> = {};

    if (contentType === 'application/json' && body) headers['Content-Type'] = 'application/json';
    else if (contentType === 'application/x-www-form-urlencoded') headers['Content-Type'] = contentType;

    if (includeCsrf) {
      const csrf = getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    const url = `${API_BASE}${endpoint}`;
    const t0 = Date.now();
    let requestBody: string | undefined;
    if (body) {
      requestBody = contentType === 'application/json' ? JSON.stringify(body) : (body as string);
    }

    try {
      const res = await fetch(url, { method, headers, body: requestBody, credentials: 'include' });
      const text = await res.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = text; }

      addLog({
        id: ++logId, method, url: endpoint, status: res.status, time: `${Date.now() - t0}ms`,
        request: requestBody, response: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      });

      if (!res.ok) throw { status: res.status, data };
      return data;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      addLog({ id: ++logId, method, url: endpoint, status: 0, time: `${Date.now() - t0}ms`, request: requestBody, response: String(error) });
      throw error;
    }
  };

  return {
    register: (email: string, password: string, name: string) =>
      request('POST', '/api/v1/auth/registration', { body: { email, password, name } }) as Promise<AuthResponse>,
    login: (username: string, password: string) =>
      request('POST', '/api/v1/auth/login', {
        body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
        contentType: 'application/x-www-form-urlencoded',
      }) as Promise<AuthResponse>,
    refresh: () => request('POST', '/api/v1/auth/refresh') as Promise<AuthResponse>,
    logout: () => request('POST', '/api/v1/auth/logout'),
    exchange: (code: string) => request('POST', '/api/v1/auth/exchange', { body: { code } }) as Promise<AuthResponse>,

    getCurrentUser: () => request('GET', '/api/v1/users') as Promise<User>,
    updateUser: (data: Record<string, unknown>) => request('PATCH', '/api/v1/users', { body: data, includeCsrf: true }) as Promise<User>,
    deleteUser: () => request('DELETE', '/api/v1/users', { includeCsrf: true }),
    getAllUsers: () => request('GET', '/api/v1/users/all') as Promise<User[]>,
    updateUserById: (id: string, data: Record<string, unknown>) =>
      request('PATCH', `/api/v1/users/${id}`, { body: data, includeCsrf: true }) as Promise<User>,
    deleteUserById: (id: string) => request('DELETE', `/api/v1/users/${id}`, { includeCsrf: true }),

    uploadAvatar: async (file: File) => {
      const formData = new FormData();
      formData.append('avatar', file); // Имя поля должно совпадать с backend (UploadFile parameter name)

      const url = `${API_BASE}/api/v1/users/avatar`;
      const t0 = Date.now();
      // Не задавать Content-Type вручную при FormData, иначе теряется boundary
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;

      try {
        const res = await fetch(url, {
          method: 'PATCH',
          headers,
          body: formData,
          credentials: 'include',
        });
        const text = await res.text();
        let data: unknown;
        try { data = JSON.parse(text); } catch { data = text; }

        addLog({
          id: ++logId, method: 'PATCH', url: '/api/v1/users/avatar', status: res.status,
          time: `${Date.now() - t0}ms`, request: `[file: ${file.name}, ${(file.size / 1024).toFixed(1)}KB]`,
          response: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        });

        if (!res.ok) throw { status: res.status, data };
        return data as User;
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error) throw error;
        addLog({ id: ++logId, method: 'PATCH', url: '/api/v1/users/avatar', status: 0, time: `${Date.now() - t0}ms`, response: String(error) });
        throw error;
      }
    },

    unlinkSteam: () => request('DELETE', '/api/v1/providers/steam', { includeCsrf: true }),
    getJWKS: () => request('GET', '/api/v1/.well-known/keys') as Promise<{ keys: JWK[] }>,
  };
};

// =============================================================================
// UI Components
// =============================================================================

function StatusBadge({ status }: { status: number }) {
  const c = status >= 200 && status < 300 ? 'bg-green-500/20 text-green-400' : status >= 400 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400';
  return <span className={`px-2 py-0.5 text-xs rounded ${c}`}>{status}</span>;
}

function MethodBadge({ method }: { method: string }) {
  const c: Record<string, string> = { GET: 'text-emerald-400', POST: 'text-blue-400', PATCH: 'text-amber-400', DELETE: 'text-red-400' };
  return <span className={`font-mono text-xs font-bold ${c[method] || 'text-gray-400'}`}>{method}</span>;
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    Root: 'bg-red-500/20 text-red-400', Admin: 'bg-orange-500/20 text-orange-400',
    Moderator: 'bg-blue-500/20 text-blue-400', User: 'bg-gray-700 text-gray-300',
  };
  return <span className={`px-2 py-0.5 text-xs rounded ${styles[role] || 'bg-gray-700 text-gray-300'}`}>{role}</span>;
}

function StatusLabel({ status }: { status: string }) {
  const s = status.toLowerCase();
  const c = s === 'active' ? 'bg-green-500/20 text-green-400' : s === 'banned' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400';
  return <span className={`px-2 py-0.5 text-xs rounded ${c}`}>{status}</span>;
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 rounded-xl border border-gray-800 overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-gray-800 bg-gray-800/50">
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Button({ onClick, disabled, variant = 'primary', children, className = '' }: {
  onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger' | 'steam'; children: React.ReactNode; className?: string;
}) {
  const v = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    secondary: 'bg-gray-700 hover:bg-gray-600 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    steam: 'bg-[#1b2838] hover:bg-[#2a475e] text-white',
  };
  return <button onClick={onClick} disabled={disabled} className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v[variant]} ${className}`}>{children}</button>;
}

function Input({ label, type = 'text', value, onChange, placeholder }: {
  label: string; type?: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-gray-400">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-gray-400">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 ${type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
      <div className="flex items-center gap-2">
        <span>{type === 'success' ? '✓' : '✕'}</span><span>{message}</span>
        <button onClick={onClose} className="ml-2 hover:opacity-80">×</button>
      </div>
    </div>
  );
}

function Avatar({ src, name, size = 'md' }: { src?: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-16 h-16 text-xl' };
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img src={src} alt={name} onError={() => setFailed(true)}
        className={`${sizes[size]} rounded-full object-cover border-2 border-gray-700`} />
    );
  }
  return (
    <div className={`${sizes[size]} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold border-2 border-gray-700`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const icons: Record<string, string> = { steam: '🎮', discord: '💬' };
  return (
    <div className="flex items-center gap-3 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
      <span className="text-2xl">{icons[provider.provider_type] || '🔗'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white capitalize">{provider.provider_type}</span>
          <span className="text-xs text-gray-500">#{provider.provider_uid}</span>
        </div>
        <div className="text-xs text-gray-400 truncate">{provider.provider_username}</div>
      </div>
      <div className="text-xs text-gray-500">{new Date(provider.created_at).toLocaleDateString()}</div>
    </div>
  );
}

// =============================================================================
// Admin Edit Modal
// =============================================================================

function AdminEditModal({ user, onSave, onDelete, onClose, loading }: {
  user: User; onSave: (id: string, data: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>; onClose: () => void; loading: boolean;
}) {
  const [form, setForm] = useState({ name: user.name, role: user.role, status: user.status });

  const handleSave = async () => {
    await onSave(user.id, form);
    onClose();
  };
  const handleDelete = async () => {
    if (!confirm(`Delete user "${user.name}"?`)) return;
    await onDelete(user.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="font-semibold text-white">Edit User</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          {/* User header */}
          <div className="flex items-center gap-4">
            <Avatar src={user.avatar || undefined} name={user.name} size="lg" />
            <div className="min-w-0">
              <h4 className="text-lg font-semibold text-white">{user.name}</h4>
              <p className="text-sm text-gray-400">{user.email || 'No email'}</p>
              <div className="flex gap-2 mt-1">
                <RoleBadge role={user.role} />
                <StatusLabel status={user.status} />
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">ID</span>
              <p className="font-mono text-xs text-gray-400 truncate">{user.id}</p>
            </div>
            <div>
              <span className="text-gray-500">Created</span>
              <p className="text-gray-300">{new Date(user.created_at).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-gray-500">Sessions</span>
              <p className="text-gray-300">{user.jwt_token?.length ?? 0}</p>
            </div>
            <div>
              <span className="text-gray-500">Providers</span>
              <p className="text-gray-300">{user.provider?.length ?? 0}</p>
            </div>
          </div>

          {/* Providers */}
          {user.provider && user.provider.length > 0 && (
            <div>
              <span className="text-sm text-gray-500">Linked Providers</span>
              <div className="mt-1 space-y-2">
                {user.provider.map((p) => <ProviderCard key={p.id} provider={p} />)}
              </div>
            </div>
          )}

          {/* Sessions */}
          {user.jwt_token && user.jwt_token.length > 0 && (
            <div>
              <span className="text-sm text-gray-500">Active Sessions</span>
              <div className="mt-1 space-y-1">
                {user.jwt_token.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-2 bg-gray-800/50 rounded text-xs">
                    <span className="text-gray-400 font-mono">{s.ip_address}</span>
                    <span className="text-gray-500">{new Date(s.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <hr className="border-gray-800" />

          {/* Editable fields */}
          <Input label="Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Select label="Role" value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: v }))}
            options={[
              { value: 'User', label: 'User' }, { value: 'Moderator', label: 'Moderator' },
              { value: 'Admin', label: 'Admin' }, { value: 'Root', label: 'Root' },
            ]} />
          <Select label="Status" value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))}
            options={[
              { value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }, { value: 'Banned', label: 'Banned' },
            ]} />

          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={loading} className="flex-1">Save</Button>
            <Button onClick={handleDelete} disabled={loading} variant="danger">Delete</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main App
// =============================================================================

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [logs, setLogs] = useState<ApiLog[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'auth' | 'profile' | 'admin' | 'jwks' | 'logs'>('auth');

  const [registerForm, setRegisterForm] = useState({ email: '', password: '', name: '' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [profileForm, setProfileForm] = useState({ name: '' });
  const [jwks, setJwks] = useState<JWK[] | null>(null);
  const [allUsers, setAllUsers] = useState<User[] | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [selectedLog, setSelectedLog] = useState<ApiLog | null>(null);

  const addLog = useCallback((l: ApiLog) => setLogs((p) => [l, ...p].slice(0, 50)), []);
  const api = createApiClient(addLog);
  const showToast = (m: string, t: 'success' | 'error') => setToast({ message: m, type: t });

  const refreshCurrentUser = async () => {
    try {
      const u = await api.getCurrentUser();
      setUser(u);
      setIsLoggedIn(true);
    } catch {
      setUser(null);
      setIsLoggedIn(false);
      clearCsrfToken();
    }
  };

  useEffect(() => { refreshCurrentUser(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const success = params.get('success');
    const error = params.get('error');
    if (code || success || error) window.history.replaceState({}, '', window.location.pathname);

    if (code) {
      (async () => {
        setLoading(true);
        try {
          const r = await api.exchange(code);
          setCsrfToken(r.csrf_token);
          await refreshCurrentUser();
          showToast('Logged in via Steam!', 'success');
        } catch { showToast('Failed to exchange code', 'error'); }
        setLoading(false);
      })();
    }
    if (success === 'provider_linked') { showToast('Steam linked!', 'success'); refreshCurrentUser(); }
    if (error) showToast(`Error: ${error}`, 'error');
  }, []);

  useEffect(() => { if (user) setProfileForm({ name: user.name }); }, [user]);

  // Handlers
  const handleRegister = async () => {
    setLoading(true);
    try {
      const r = await api.register(registerForm.email, registerForm.password, registerForm.name);
      setCsrfToken(r.csrf_token);
      await refreshCurrentUser();
      showToast('Registered!', 'success');
      setRegisterForm({ email: '', password: '', name: '' });
    } catch (e: unknown) { showToast((e as { data?: { detail?: string } }).data?.detail || 'Failed', 'error'); }
    setLoading(false);
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      const r = await api.login(loginForm.email, loginForm.password);
      setCsrfToken(r.csrf_token);
      await refreshCurrentUser();
      showToast('Logged in!', 'success');
      setLoginForm({ email: '', password: '' });
    } catch (e: unknown) { showToast((e as { data?: { detail?: string } }).data?.detail || 'Failed', 'error'); }
    setLoading(false);
  };

  const handleSteamLogin = () => {
    const r = encodeURIComponent(window.location.origin);
    window.location.href = `${API_BASE}/api/v1/oauth/steam?return_to_frontend=${r}`;
  };

  const handleRefresh = async () => {
    setLoading(true);
    try { const r = await api.refresh(); setCsrfToken(r.csrf_token); showToast('Refreshed!', 'success'); }
    catch { showToast('Refresh failed', 'error'); }
    setLoading(false);
  };

  const handleLogout = async () => {
    setLoading(true);
    try { await api.logout(); } catch { /* */ }
    setUser(null); setIsLoggedIn(false); clearCsrfToken();
    showToast('Logged out', 'success'); setLoading(false);
  };

  const handleUpdateProfile = async () => {
    setLoading(true);
    try { await api.updateUser(profileForm); await refreshCurrentUser(); showToast('Saved!', 'success'); }
    catch { showToast('Update failed', 'error'); }
    setLoading(false);
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Delete your account?')) return;
    setLoading(true);
    try { await api.deleteUser(); setUser(null); setIsLoggedIn(false); clearCsrfToken(); showToast('Deleted', 'success'); }
    catch { showToast('Failed', 'error'); }
    setLoading(false);
  };

  const handleLinkSteam = () => {
    const r = encodeURIComponent(window.location.origin);
    window.location.href = `${API_BASE}/api/v1/providers/steam/link?return_to_frontend=${r}`;
  };

  const handleUnlinkSteam = async () => {
    setLoading(true);
    try { await api.unlinkSteam(); await refreshCurrentUser(); showToast('Steam unlinked!', 'success'); }
    catch (e: unknown) { showToast((e as { data?: { detail?: string } }).data?.detail || 'Failed', 'error'); }
    setLoading(false);
  };

  const handleGetAllUsers = async () => {
    setLoading(true);
    try { setAllUsers(await api.getAllUsers()); }
    catch (e: unknown) { showToast((e as { data?: { detail?: string } }).data?.detail || 'Access denied', 'error'); }
    setLoading(false);
  };

  const handleAdminSave = async (id: string, data: Record<string, unknown>) => {
    setLoading(true);
    try {
      await api.updateUserById(id, data);
      showToast('User updated!', 'success');
      await handleGetAllUsers();
      await refreshCurrentUser();
    } catch { showToast('Update failed', 'error'); }
    setLoading(false);
  };

  const handleAdminDelete = async (id: string) => {
    setLoading(true);
    try {
      await api.deleteUserById(id);
      showToast('User deleted', 'success');
      await handleGetAllUsers();
      if (user && user.id === id) { setUser(null); setIsLoggedIn(false); clearCsrfToken(); }
    } catch { showToast('Delete failed', 'error'); }
    setLoading(false);
  };

  const steamProvider = user?.provider?.find((p) => p.provider_type === 'steam');
  const csrfToken = getCsrfToken();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {editingUser && (
        <AdminEditModal user={editingUser} onSave={handleAdminSave} onDelete={handleAdminDelete}
          onClose={() => setEditingUser(null)} loading={loading} />
      )}

      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔐</span>
            <div>
              <h1 className="text-lg font-bold text-white">AlastaAuth Demo</h1>
              <p className="text-xs text-gray-500">Cookie-based Auth</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className={`px-2 py-1 text-xs rounded ${isLoggedIn ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
              {isLoggedIn ? '🔒 Authenticated' : '🔓 Guest'}
            </span>
            {isLoggedIn && user && (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-white">{user.name}</div>
                  <div className="text-xs text-gray-500">{user.email || 'No email'}</div>
                </div>
                <Avatar src={user.avatar || undefined} name={user.name} />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav className="border-b border-gray-800 bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto py-2">
          {(['auth', 'profile', 'admin', 'jwks', 'logs'] as const).map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${activeTab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {{ auth: '🔑 Auth', profile: '👤 Profile', admin: '👑 Admin', jwks: '🔐 JWKS', logs: `📋 Logs (${logs.length})` }[t]}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* ============== AUTH ============== */}
        {activeTab === 'auth' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              {!isLoggedIn ? (
                <>
                  <Card title="📝 Register">
                    <div className="space-y-4">
                      <Input label="Name" value={registerForm.name} onChange={(v) => setRegisterForm((f) => ({ ...f, name: v }))} placeholder="John Doe" />
                      <Input label="Email" type="email" value={registerForm.email} onChange={(v) => setRegisterForm((f) => ({ ...f, email: v }))} placeholder="john@example.com" />
                      <Input label="Password" type="password" value={registerForm.password} onChange={(v) => setRegisterForm((f) => ({ ...f, password: v }))} placeholder="••••••••" />
                      <Button onClick={handleRegister} disabled={loading} className="w-full">Register</Button>
                    </div>
                  </Card>
                  <Card title="🔓 Login">
                    <div className="space-y-4">
                      <Input label="Email" type="email" value={loginForm.email} onChange={(v) => setLoginForm((f) => ({ ...f, email: v }))} placeholder="john@example.com" />
                      <Input label="Password" type="password" value={loginForm.password} onChange={(v) => setLoginForm((f) => ({ ...f, password: v }))} placeholder="••••••••" />
                      <Button onClick={handleLogin} disabled={loading} className="w-full">Login</Button>
                    </div>
                  </Card>
                  <Card title="🎮 Steam OAuth">
                    <p className="text-sm text-gray-400 mb-4">Login or register using your Steam account</p>
                    <Button onClick={handleSteamLogin} variant="steam" className="w-full">Login with Steam</Button>
                  </Card>
                </>
              ) : (
                <>
                  <Card title="✅ Session">
                    <div className="space-y-4">
                      <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                        <p className="text-sm text-green-400">Authenticated as <strong>{user?.name}</strong></p>
                        <p className="text-xs text-gray-500 mt-1">Role: {user?.role} • Status: {user?.status}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={handleRefresh} disabled={loading} variant="secondary">🔄 Refresh</Button>
                        <Button onClick={handleLogout} disabled={loading} variant="danger">🚪 Logout</Button>
                      </div>
                    </div>
                  </Card>
                  <Card title="🔗 Steam Integration">
                    {steamProvider ? (
                      <div className="space-y-4">
                        <ProviderCard provider={steamProvider} />
                        <Button onClick={handleUnlinkSteam} disabled={loading} variant="danger" className="w-full">Unlink Steam</Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-gray-400">No Steam account linked</p>
                        <Button onClick={handleLinkSteam} disabled={loading} variant="steam" className="w-full">Link Steam</Button>
                      </div>
                    )}
                  </Card>
                </>
              )}
            </div>
            <div className="space-y-6">
              <Card title="🍪 Cookie Status">
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center py-2 border-b border-gray-800">
                    <span className="text-gray-400">Auth Cookies</span>
                    <span className={isLoggedIn ? 'text-green-400' : 'text-gray-500'}>{isLoggedIn ? '✓ Set (HttpOnly)' : '✕ Not set'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-800">
                    <span className="text-gray-400">CSRF Token</span>
                    <span className={csrfToken ? 'text-green-400' : 'text-gray-500'}>{csrfToken ? '✓ Available' : '✕ Not set'}</span>
                  </div>
                  {csrfToken && (
                    <div className="mt-2">
                      <div className="text-xs text-gray-500 mb-1">CSRF Token:</div>
                      <code className="text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded break-all">{csrfToken.substring(0, 24)}...</code>
                    </div>
                  )}
                </div>
              </Card>
              <Card title="ℹ️ How It Works">
                <div className="space-y-3 text-sm text-gray-400">
                  <p><strong className="text-white">1.</strong> Login/Register sets HttpOnly cookies</p>
                  <p><strong className="text-white">2.</strong> Browser sends cookies automatically</p>
                  <p><strong className="text-white">3.</strong> POST/PATCH/DELETE require X-CSRF-Token header</p>
                  <p><strong className="text-white">4.</strong> JS cannot read HttpOnly cookies → XSS safe</p>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ============== PROFILE ============== */}
        {activeTab === 'profile' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <Card title="👤 Profile">
                {user ? (
                  <div className="space-y-4">
                    {/* Avatar + Name */}
                    <div className="flex items-center gap-4">
                      <Avatar src={user.avatar || undefined} name={user.name} size="lg" />
                      <div>
                        <h2 className="text-lg font-semibold text-white">{user.name}</h2>
                        <p className="text-sm text-gray-400">{user.email || 'No email'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div><span className="text-gray-500">ID</span><p className="font-mono text-xs text-gray-300 truncate">{user.id}</p></div>
                      <div><span className="text-gray-500">Role</span><p><RoleBadge role={user.role} /></p></div>
                      <div><span className="text-gray-500">Status</span><p><StatusLabel status={user.status} /></p></div>
                      <div><span className="text-gray-500">Created</span><p className="text-gray-300">{new Date(user.created_at).toLocaleString()}</p></div>
                    </div>

                    {/* Providers */}
                    {user.provider && user.provider.length > 0 && (
                      <div>
                        <span className="text-sm text-gray-500">Linked Providers ({user.provider.length})</span>
                        <div className="mt-2 space-y-2">{user.provider.map((p) => <ProviderCard key={p.id} provider={p} />)}</div>
                      </div>
                    )}

                    {/* Sessions */}
                    {user.jwt_token && user.jwt_token.length > 0 && (
                      <div>
                        <span className="text-sm text-gray-500">Active Sessions ({user.jwt_token.length})</span>
                        <div className="mt-2 space-y-1">
                          {user.jwt_token.map((s) => (
                            <div key={s.id} className="flex items-center justify-between p-2 bg-gray-800/50 rounded text-xs">
                              <span className="text-gray-400 font-mono">{s.ip_address}</span>
                              <span className="text-gray-500">{new Date(s.created_at).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : <p className="text-gray-500">Not logged in</p>}
              </Card>
            </div>
            <div className="space-y-6">
              <Card title="✏️ Edit Profile">
                {user ? (
                  <div className="space-y-4">
                    <Input label="Name" value={profileForm.name} onChange={(v) => setProfileForm((f) => ({ ...f, name: v }))} />

                    {/* Avatar upload */}
                    <div className="space-y-2">
                      <label className="text-sm text-gray-400">Avatar</label>
                      <div className="flex items-center gap-4">
                        <Avatar src={user.avatar || undefined} name={user.name} size="lg" />
                        <div className="flex-1">
                          <label className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 border border-gray-700 border-dashed rounded-lg cursor-pointer hover:border-blue-500 hover:bg-gray-800/80 transition-colors">
                            <span className="text-gray-400 text-sm">📷 Choose image...</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setLoading(true);
                                try {
                                  await api.uploadAvatar(file);
                                  await refreshCurrentUser();
                                  showToast('Avatar updated!', 'success');
                                } catch {
                                  showToast('Upload failed', 'error');
                                }
                                setLoading(false);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          <p className="text-xs text-gray-600 mt-1">JPG, PNG, WebP. Max 5MB.</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={handleUpdateProfile} disabled={loading}>Save Name</Button>
                      <Button onClick={handleDeleteAccount} disabled={loading} variant="danger">Delete Account</Button>
                    </div>
                  </div>
                ) : <p className="text-gray-500">Not logged in</p>}
              </Card>
            </div>
          </div>
        )}

        {/* ============== ADMIN ============== */}
        {activeTab === 'admin' && (
          <div className="space-y-6">
            <Card title="👑 Admin Panel">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-400">Manage all users. Click a row to edit.</p>
                  <Button onClick={handleGetAllUsers} disabled={loading}>
                    {allUsers ? '🔄 Refresh' : 'Fetch Users'}
                  </Button>
                </div>

                {allUsers && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-500">
                          <th className="text-left py-2 px-3">Name</th>
                          <th className="text-left py-2 px-3">Email</th>
                          <th className="text-left py-2 px-3">Role</th>
                          <th className="text-left py-2 px-3">Status</th>
                          <th className="text-left py-2 px-3">Providers</th>
                          <th className="text-left py-2 px-3">Sessions</th>
                          <th className="text-left py-2 px-3">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allUsers.map((u) => (
                          <tr key={u.id} onClick={() => setEditingUser(u)}
                            className="border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/40 transition-colors">
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <Avatar src={u.avatar || undefined} name={u.name} size="sm" />
                                <span className="font-medium">{u.name}</span>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-gray-400">{u.email || '—'}</td>
                            <td className="py-2 px-3"><RoleBadge role={u.role} /></td>
                            <td className="py-2 px-3"><StatusLabel status={u.status} /></td>
                            <td className="py-2 px-3">
                              <div className="flex gap-1">
                                {u.provider && u.provider.length > 0
                                  ? u.provider.map((p) => (
                                    <span key={p.id} className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded capitalize">{p.provider_type}</span>
                                  ))
                                  : <span className="text-gray-600">—</span>}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-gray-400">{u.jwt_token?.length ?? 0}</td>
                            <td className="py-2 px-3 text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-gray-600 mt-2">{allUsers.length} users total</p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* ============== JWKS ============== */}
        {activeTab === 'jwks' && (
          <Card title="🔐 JSON Web Key Set">
            <div className="space-y-4">
              <p className="text-sm text-gray-400">Public keys for verifying JWT signatures</p>
              <Button onClick={async () => { setLoading(true); try { setJwks((await api.getJWKS()).keys); } catch { showToast('Failed', 'error'); } setLoading(false); }} disabled={loading}>
                Fetch JWKS
              </Button>
              {jwks && <pre className="p-4 bg-gray-800 rounded-lg text-sm text-gray-300 overflow-auto max-h-96">{JSON.stringify({ keys: jwks }, null, 2)}</pre>}
            </div>
          </Card>
        )}

        {/* ============== LOGS ============== */}
        {activeTab === 'logs' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <Card title="📋 Request Log">
              <div className="space-y-2 max-h-[600px] overflow-auto">
                {logs.length === 0 ? <p className="text-gray-500 text-sm">No requests yet</p> : logs.map((l) => (
                  <button key={l.id} onClick={() => setSelectedLog(l)}
                    className={`w-full text-left p-2 rounded-lg border transition-colors ${selectedLog?.id === l.id ? 'border-blue-500 bg-blue-500/10' : 'border-gray-800 hover:border-gray-700'}`}>
                    <div className="flex items-center gap-2">
                      <MethodBadge method={l.method} />
                      <span className="text-sm text-gray-300 truncate flex-1">{l.url}</span>
                      <StatusBadge status={l.status} />
                      <span className="text-xs text-gray-500">{l.time}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
            <Card title="📄 Details">
              {selectedLog ? (
                <div className="space-y-4">
                  <div><div className="text-xs text-gray-500 mb-1">Request</div><pre className="p-2 bg-gray-800 rounded text-xs text-gray-300 overflow-auto max-h-40">{selectedLog.request || '(no body)'}</pre></div>
                  <div><div className="text-xs text-gray-500 mb-1">Response</div><pre className="p-2 bg-gray-800 rounded text-xs text-gray-300 overflow-auto max-h-80">{selectedLog.response || '(no body)'}</pre></div>
                </div>
              ) : <p className="text-gray-500 text-sm">Select a request</p>}
            </Card>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-800 mt-8">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">AlastaAuth Demo</div>
      </footer>
    </div>
  );
}