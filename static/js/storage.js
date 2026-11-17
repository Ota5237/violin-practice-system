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

// roadmapOptions（{direction, bpm, account_type}）を渡す。
// account_type='researcher' のときは研究者アカウント、省略時は被験者アカウントとして作成する
async function createProfile(name, password, roadmapOptions) {
  const res = await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password, ...(roadmapOptions || {}) })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'アカウントの作成に失敗しました');
  return data;
}

// 被験者アカウントに割り当てられた練習ロードマップ（{steps, current_step}）を取得する
async function getSubjectAssignment(profileId) {
  const url = profileId ? `/api/subject-assignment?profile_id=${profileId}` : '/api/subject-assignment';
  const res = await apiFetch(url);
  const data = await res.json();
  if (!res.ok) return null; // 割り当てが無い（一般アカウント）場合はnull
  return data;
}

// 被験者ロードマップを1ステップ進める（現在の音階に合格したときに呼ぶ）
async function advanceSubjectProgress() {
  const res = await apiFetch('/api/subject-progress/advance', { method: 'POST' });
  return await res.json();
}

// 被験者（または検証モード）の、今のステージ内でのフェーズを変更する
// phaseは 'baseline'（事前演奏）｜'practice'（自由練習）｜'test'（テスト演奏）のいずれか
async function setSubjectStagePhase(phase) {
  const res = await apiFetch('/api/subject-progress/phase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase })
  });
  return await res.json();
}

// 被験者チュートリアルを既読にする（本人のみ）
async function markSubjectTutorialSeen() {
  const res = await apiFetch('/api/subject-tutorial/seen', { method: 'POST' });
  return await res.json();
}

// 被験者の練習ロードマップ（音階6つ・方向・テンポ）を管理者が変更する。
// steps は [{category_key, scale_id}, ...]（6個）、direction/bpmは6つ共通
async function updateSubjectAssignment(profileId, steps, direction, bpm) {
  const res = await apiFetch(`/api/subject-assignment/${profileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps, direction, bpm })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'ロードマップの更新に失敗しました');
  return data;
}

// 検証モード（管理者の体験）で使う音階ロードマップ（{steps}。未設定ならsteps:[]）を取得する
async function getVerifyModeScales() {
  const res = await apiFetch('/api/verify-mode-scales');
  const data = await res.json();
  if (!res.ok) return { steps: [] };
  return data;
}

// 検証モードの音階ロードマップを設定する。stepsは[{category_key, scale_id}, ...]（6個）
async function updateVerifyModeScales(steps) {
  const res = await apiFetch('/api/verify-mode-scales', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '音階の更新に失敗しました');
  return data;
}

// 検証モードの音階ロードマップを未設定（自動選択）に戻す
async function resetVerifyModeScales() {
  const res = await apiFetch('/api/verify-mode-scales', { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'リセットに失敗しました');
  return data;
}

// 新しい音階（調）を登録する（管理者のみ）。notesは音符データの配列、arpeggioは任意
async function createScale(categoryKey, name, notes, arpeggio, keySig) {
  const res = await apiFetch('/api/scales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_key: categoryKey, name, notes, arpeggio: arpeggio || null, key_sig: keySig || {} })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '音階の登録に失敗しました');
  return data;
}

// 既存の音階（調）を修正する（管理者のみ）
async function updateScale(scaleId, categoryKey, name, notes, arpeggio, keySig) {
  const res = await apiFetch(`/api/scales/${scaleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_key: categoryKey, name, notes, arpeggio: arpeggio || null, key_sig: keySig || {} })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '音階の修正に失敗しました');
  return data;
}

// 音階（調）を削除する（管理者のみ）
async function deleteScale(scaleId) {
  const res = await apiFetch(`/api/scales/${scaleId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '音階の削除に失敗しました');
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

async function getAllHistory(profileId, limit = 500, offset = 0) {
  const params = new URLSearchParams({ limit, offset });
  if (profileId) params.set('profile_id', profileId);
  const res = await apiFetch(`/api/all-history?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '記録の取得に失敗しました');
  return data;
}

async function createHistoryForProfile(fields) {
  const res = await apiFetch('/api/all-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '記録の作成に失敗しました');
  return data;
}

async function updateHistoryRecord(historyId, fields) {
  const res = await apiFetch(`/api/history/${historyId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '記録の更新に失敗しました');
  return data;
}

async function deleteHistoryRecord(historyId) {
  const res = await apiFetch(`/api/history/${historyId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '記録の削除に失敗しました');
  return data;
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

// 結果画面の表示形式など、アプリ全体の設定。
// ログイン不要（ゲストの練習画面にも必要なため）
async function getSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) return { result_display_mode: 'accuracy' };
  return await res.json();
}

// 設定の変更は管理者のみ。変えたい項目だけ渡す（例: { result_display_mode: 'score' }）
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
