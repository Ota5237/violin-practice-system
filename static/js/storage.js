async function getProfiles() {
  const res = await fetch('/api/profiles');
  return await res.json();
}

async function createProfile(name) {
  const res = await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'プロフィールの作成に失敗しました');
  return data;
}

async function deleteProfile(profileId) {
  const res = await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'プロフィールの削除に失敗しました');
  return data;
}

async function getHistory(profileId) {
  const res = await fetch(`/api/history?profile_id=${profileId}`);
  return await res.json();
}

async function saveHistory(data) {
  const res = await fetch('/api/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return await res.json();
}

async function clearHistory(profileId) {
  await fetch(`/api/history?profile_id=${profileId}`, { method: 'DELETE' });
}

async function getStats(profileId) {
  const res = await fetch(`/api/stats?profile_id=${profileId}`);
  return await res.json();
}

async function getNoteStats(profileId) {
  const res = await fetch(`/api/stats/notes?profile_id=${profileId}`);
  return await res.json();
}
