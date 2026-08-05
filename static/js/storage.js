async function getHistory() {
  const res = await fetch('/api/history');
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

async function clearHistory() {
  await fetch('/api/history', { method: 'DELETE' });
}

async function getStats() {
  const res = await fetch('/api/stats');
  return await res.json();
}