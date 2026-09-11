async function login(name, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'ログインに失敗しました');
  return data; // { needs_setup: true, name } または { id, name, role }
}

async function setPassword(name, password) {
  const res = await fetch('/api/set-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'パスワードの設定に失敗しました');
  return data;
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
}

async function getMe() {
  const res = await fetch('/api/me');
  if (!res.ok) return null;
  return await res.json();
}

async function changePassword(currentPassword, newPassword) {
  const res = await fetch('/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'パスワードの変更に失敗しました');
  return data;
}

// ログイン必須のAPIで401（セッション切れ）が返ってきたら、ログイン画面まで丸ごと再読み込みする
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    location.reload();
    throw new Error('セッションが切れました');
  }
  return res;
}

async function getProfiles() {
  const res = await apiFetch('/api/profiles');
  return await res.json();
}

async function createProfile(name, password) {
  const res = await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'アカウントの作成に失敗しました');
  return data;
}

async function deleteProfile(profileId) {
  const res = await apiFetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'プロフィールの削除に失敗しました');
  return data;
}

async function getHistory(profileId) {
  const res = await apiFetch(`/api/history?profile_id=${profileId}`);
  return await res.json();
}

async function saveHistory(data) {
  const res = await apiFetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function clearHistory(profileId) {
  await apiFetch(`/api/history?profile_id=${profileId}`, { method: 'DELETE' });
}

async function getStats(profileId) {
  const res = await apiFetch(`/api/stats?profile_id=${profileId}`);
  return await res.json();
}

async function getNoteStats(profileId) {
  const res = await apiFetch(`/api/stats/notes?profile_id=${profileId}`);
  return await res.json();
}

// 全アカウントの比較統計（管理者のみ）
async function getCompareStats() {
  const res = await apiFetch('/api/stats/compare');
  return await res.json();
}

// 練習中の音符表示・結果画面の表示形式など、アプリ全体の設定。
// ログイン不要（ゲストの練習画面にも必要なため）
async function getSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) return { note_display_mode: 'chips', result_display_mode: 'accuracy' };
  return await res.json();
}

// 設定の変更は管理者のみ。変えたい項目だけ渡す（例: { note_display_mode: 'staff' }）
async function updateSettings(partialSettings) {
  const res = await apiFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partialSettings)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '設定の変更に失敗しました');
  return data;
}
