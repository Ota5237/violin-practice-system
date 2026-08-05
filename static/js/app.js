const detector = new PitchDetector();
let scalesData    = {};
let practiceNotes = [];
let currentIndex  = 0;
let isPracticing  = false;

// テンポモード用
let tempoInterval  = null;
let notesCorrect   = 0;
let detectedFreqNow = null;

// ===== 音階データ読み込み =====
async function loadScales() {
  const res = await fetch('/static/data/scales.json');
  scalesData = await res.json();
}

// ===== 練習開始 =====
function startPractice() {
  const scaleKey  = document.getElementById('scaleSelect').value;
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const mode      = document.querySelector('input[name="mode"]:checked').value;
  const scale     = scalesData.scales[scaleKey];

  // 音リストを組み立て
  if      (direction === 'up')      practiceNotes = [...scale.notes];
  else if (direction === 'down')    practiceNotes = [...scale.notes].reverse();
  else if (direction === 'updown')  practiceNotes = [...scale.notes, ...[...scale.notes].reverse()];
  else if (direction === 'arpeggio')practiceNotes = [...scale.arpeggio];

  currentIndex = 0;
  notesCorrect = 0;

  document.getElementById('setupCard').style.display    = 'none';
  document.getElementById('practiceCard').style.display = 'block';
  document.getElementById('completeCard').style.display = 'none';

  const badge = document.getElementById('modeBadge');
  badge.textContent = mode === 'step' ? '🎯 1音ずつモード' : `🥁 テンポモード ${document.getElementById('bpmRange').value} BPM`;

  renderProgress();

  if (mode === 'step') {
    startStepMode();
  } else {
    startTempoMode();
  }
}

// ===========================
// 1音ずつモード
// ===========================
function startStepMode() {
  isPracticing = true;
  showCurrentNote();

  detector.start((freq) => {
    if (!isPracticing) return;
    onPitchDetectedStep(freq);
  });
}

function onPitchDetectedStep(freq) {
  const noteData = scalesData.notes[practiceNotes[currentIndex]];
  document.getElementById('resultFreq').textContent = `周波数: ${freq.toFixed(1)} Hz`;

  const cents    = 1200 * Math.log2(freq / noteData.freq);
  const absCents = Math.abs(cents);
  const statusEl = document.getElementById('resultStatus');

  if (absCents <= 15) {
    statusEl.textContent = '✅ 正解！';
    statusEl.className   = 'result-status correct';
    notesCorrect++;
    isPracticing = false;
    setTimeout(nextNote, 800);
  } else if (absCents <= 35) {
    statusEl.textContent = cents > 0 ? '▲ 少し高い' : '▼ 少し低い';
    statusEl.className   = 'result-status close';
  } else {
    statusEl.textContent = cents > 0 ? '高すぎ ▲' : '低すぎ ▼';
    statusEl.className   = 'result-status wrong';
  }
}

// ===========================
// テンポモード
// ===========================
function startTempoMode() {
  const bpm      = parseInt(document.getElementById('bpmRange').value);
  const interval = (60 / bpm) * 1000;
  let beat       = 0;
  let countdown  = 3;

  const countdownEl = document.getElementById('countdown');
  countdownEl.style.display = 'block';

  // マイク起動（常時聴いておく）
  detector.start((freq) => {
    detectedFreqNow = freq;
    document.getElementById('resultFreq').textContent = `周波数: ${freq.toFixed(1)} Hz`;
  });

  // カウントダウン
  const countTimer = setInterval(() => {
    if (countdown > 0) {
      countdownEl.textContent = countdown;
      playClick(true); // 強拍
      countdown--;
    } else {
      clearInterval(countTimer);
      countdownEl.style.display = 'none';
      isPracticing = true;
      showCurrentNote();
      playClick(true);

      // メトロノーム開始
      tempoInterval = setInterval(() => {
        // 直前に弾いた音を評価
        evaluateBeat();
        beat++;

        if (currentIndex >= practiceNotes.length) {
          clearInterval(tempoInterval);
          completePractice();
          return;
        }

        showCurrentNote();
        playClick(beat % 4 === 0);
      }, interval);
    }
  }, interval);
}

function evaluateBeat() {
  if (currentIndex >= practiceNotes.length) return;
  const noteData = scalesData.notes[practiceNotes[currentIndex]];
  const statusEl = document.getElementById('resultStatus');

  if (detectedFreqNow && detectedFreqNow > 0) {
    const cents = 1200 * Math.log2(detectedFreqNow / noteData.freq);
    if (Math.abs(cents) <= 20) {
      statusEl.textContent = '✅';
      statusEl.className   = 'result-status correct';
      notesCorrect++;
    } else {
      statusEl.textContent = '❌';
      statusEl.className   = 'result-status wrong';
    }
  } else {
    statusEl.textContent = '❌ 音なし';
    statusEl.className   = 'result-status wrong';
  }

  // ドットを更新
  document.querySelectorAll('.progress-dot')[currentIndex]?.classList.replace('current', 'done');
  currentIndex++;
  detectedFreqNow = null;
}

// クリック音（Web Audio API）
function playClick(accent = false) {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = accent ? 1000 : 800;
    gain.gain.setValueAtTime(accent ? 0.4 : 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
  } catch(e) {}
}

// ===========================
// 共通
// ===========================
function nextNote() {
  document.querySelectorAll('.progress-dot')[currentIndex]?.classList.replace('current', 'done');
  currentIndex++;
  if (currentIndex >= practiceNotes.length) {
    completePractice();
  } else {
    showCurrentNote();
    isPracticing = true;
  }
}

function showCurrentNote() {
  if (currentIndex >= practiceNotes.length) return;
  const noteData = scalesData.notes[practiceNotes[currentIndex]];
  document.getElementById('resultNote').textContent    = noteData.label;
  document.getElementById('resultLabel').textContent   = practiceNotes[currentIndex];
  document.getElementById('resultStatus').textContent  = '';
  document.getElementById('resultStatus').className    = 'result-status';
  document.getElementById('fingeringInfo').textContent = `${noteData.string} · ${noteData.position}`;
  document.getElementById('resultFreq').textContent    = '周波数: -- Hz';

  document.querySelectorAll('.progress-dot').forEach((d, i) => {
    d.classList.toggle('current', i === currentIndex);
  });
}

function renderProgress() {
  document.getElementById('scaleProgress').innerHTML = practiceNotes.map((note) => {
    const label = scalesData.notes[note]?.label || note;
    return `<div class="progress-dot">${label}</div>`;
  }).join('');
}

async function completePractice() {
  detector.stop();
  isPracticing = false;
  if (tempoInterval) { clearInterval(tempoInterval); tempoInterval = null; }

  const scaleKey  = document.getElementById('scaleSelect').value;
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const mode      = document.querySelector('input[name="mode"]:checked').value;
  const bpm       = mode === 'tempo' ? parseInt(document.getElementById('bpmRange').value) : null;

  const dirLabels = { up: '上行', down: '下行', updown: '上下', arpeggio: 'アルペジオ' };
  const dirLabel  = dirLabels[direction] || direction;

  const accuracy = practiceNotes.length > 0
    ? Math.round(notesCorrect / practiceNotes.length * 100) : 0;

  const entry = await saveHistory({
    scale: scaleKey, direction: dirLabel, mode,
    bpm, notes_correct: notesCorrect, notes_total: practiceNotes.length
  });
  addHistoryItem(entry);

  document.getElementById('practiceCard').style.display  = 'none';
  document.getElementById('completeCard').style.display  = 'block';
  document.getElementById('completeMsg').textContent =
    `${scaleKey}（${dirLabel}）完了！`;

  // テンポモードのみ正答率を表示
  if (mode === 'tempo') {
    document.getElementById('accuracyDisplay').style.display = 'block';
    document.getElementById('accuracyNum').textContent = `${accuracy}%`;
  } else {
    document.getElementById('accuracyDisplay').style.display = 'none';
  }
}

function stopPractice() {
  detector.stop();
  isPracticing = false;
  if (tempoInterval) { clearInterval(tempoInterval); tempoInterval = null; }
  document.getElementById('setupCard').style.display    = 'block';
  document.getElementById('practiceCard').style.display = 'none';
  document.getElementById('completeCard').style.display = 'none';
  document.getElementById('countdown').style.display    = 'none';
}

function addHistoryItem(entry) {
  const list  = document.getElementById('historyList');
  const empty = list.querySelector('.history-empty');
  if (empty) empty.remove();
  const li = document.createElement('li');
  const acc = entry.mode === 'tempo' ? `　正答率: ${entry.accuracy}%` : '';
  li.textContent = `${entry.time}　${entry.scale}（${entry.direction}）${acc}`;
  list.prepend(li);
}

async function renderHistory() {
  const history = await getHistory();
  const list = document.getElementById('historyList');
  if (history.length === 0) return;
  list.innerHTML = history.map(e => {
    const acc = e.mode === 'tempo' ? `　正答率: ${e.accuracy}%` : '';
    return `<li>${e.practiced_at}　${e.scale}（${e.direction}）${acc}</li>`;
  }).join('');
}

// ===========================
// グラフ描画
// ===========================
const charts = { accuracy: null, daily: null, scale: null };

async function renderStats() {
  const data   = await getStats();
  const daily  = [...data.daily].reverse();
  const scales = data.by_scale;

  charts.accuracy?.destroy();
  charts.daily?.destroy();
  charts.scale?.destroy();

  // 正答率の推移
  const accCtx = document.getElementById('chartAccuracy').getContext('2d');
  charts.accuracy = new Chart(accCtx, {
    type: 'line',
    data: {
      labels: daily.map(d => d.date),
      datasets: [{
        label: '平均正答率 (%)',
        data: daily.map(d => d.avg_accuracy),
        borderColor: '#e8c97a',
        backgroundColor: 'rgba(232,201,122,0.15)',
        tension: 0.3, fill: true
      }]
    },
    options: chartOptions('正答率 (%)', 0, 100)
  });

  // 日別練習回数
  const dailyCtx = document.getElementById('chartDaily').getContext('2d');
  charts.daily = new Chart(dailyCtx, {
    type: 'bar',
    data: {
      labels: daily.map(d => d.date),
      datasets: [{
        label: '練習回数',
        data: daily.map(d => d.count),
        backgroundColor: 'rgba(46,204,113,0.7)',
        borderRadius: 6
      }]
    },
    options: chartOptions('回数')
  });

  // 調ごとの正答率
  const scaleCtx = document.getElementById('chartScale').getContext('2d');
  charts.scale = new Chart(scaleCtx, {
    type: 'bar',
    data: {
      labels: scales.map(s => s.scale),
      datasets: [{
        label: '平均正答率 (%)',
        data: scales.map(s => s.avg_accuracy),
        backgroundColor: 'rgba(52,152,219,0.7)',
        borderRadius: 6
      }]
    },
    options: chartOptions('正答率 (%)', 0, 100)
  });
}

function chartOptions(yLabel, min, max) {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: '#eee' } } },
    scales: {
      x: { ticks: { color: '#aaa' }, grid: { color: '#2a2a4a' } },
      y: {
        ticks: { color: '#aaa' }, grid: { color: '#2a2a4a' },
        title: { display: true, text: yLabel, color: '#aaa' },
        min, max
      }
    }
  };
}

// ===========================
// タブ切り替え
// ===========================
let statsLoaded = false;
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    document.getElementById('tab-practice').style.display = tab === 'practice' ? 'block' : 'none';
    document.getElementById('tab-stats').style.display    = tab === 'stats'    ? 'block' : 'none';

    if (tab === 'stats' && !statsLoaded) {
      renderStats();
      statsLoaded = true;
    }
  });
});

// ===========================
// イベント
// ===========================
document.getElementById('scaleSelect').addEventListener('change', (e) => {
  document.getElementById('startBtn').disabled = e.target.value === '';
});

document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    document.getElementById('bpmGroup').style.display =
      e.target.value === 'tempo' ? 'block' : 'none';
  });
});

document.getElementById('bpmRange').addEventListener('input', (e) => {
  document.getElementById('bpmValue').textContent = e.target.value;
});

document.getElementById('startBtn').addEventListener('click', startPractice);
document.getElementById('stopBtn').addEventListener('click', stopPractice);

document.getElementById('retryBtn').addEventListener('click', () => {
  statsLoaded = false;
  document.getElementById('setupCard').style.display   = 'block';
  document.getElementById('completeCard').style.display = 'none';
});

async function clearAllHistory() {
  if (!confirm('履歴を全件削除しますか？')) return;
  await clearHistory();
  document.getElementById('historyList').innerHTML =
    '<li class="history-empty">まだ履歴がありません</li>';
  if (statsLoaded) renderStats();
}

document.getElementById('clearStatsBtn').addEventListener('click', clearAllHistory);

// ===========================
// 初期化
// ===========================
loadScales();
renderHistory();