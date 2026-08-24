const detector = new PitchDetector();
let scalesData      = {};
let practiceNotes   = [];
let currentIndex    = 0;
let isPracticing    = false;
let currentProfileId = null;

// テンポモード用
let tempoInterval  = null;
let countTimer     = null;
let notesCorrect   = 0;
let detectedFreqNow = null;

// ===== 音階データ読み込み =====
// カテゴリーを追加する場合はここに1行足す（例: 第3ポジション）
const CATEGORY_FILES = [
  { key: 'first_position', file: '/static/data/scales/first_position.json' },
  { key: 'two_octave',     file: '/static/data/scales/two_octave.json' },
];

async function loadScales() {
  const [notesRes, ...categoryResults] = await Promise.all([
    fetch('/static/data/notes.json'),
    ...CATEGORY_FILES.map(c => fetch(c.file)),
  ]);

  const notes      = await notesRes.json();
  const categories = {};
  for (let i = 0; i < CATEGORY_FILES.length; i++) {
    categories[CATEGORY_FILES[i].key] = await categoryResults[i].json();
  }

  scalesData = { notes, categories };
  populateScaleSelect();
  renderFingerboardLandmarks();
}

// ===== カテゴリー・調セレクト =====
function getCurrentCategoryKey() {
  return document.getElementById('categorySelect').value;
}

function getCurrentScales() {
  return scalesData.categories?.[getCurrentCategoryKey()]?.scales || {};
}

function populateScaleSelect() {
  const scales     = getCurrentScales();
  const scaleSelect = document.getElementById('scaleSelect');
  const keys        = Object.keys(scales);

  scaleSelect.innerHTML = '<option value="">-- 選択してください --</option>' +
    keys.map(key => `<option value="${key}">${scales[key].name}</option>`).join('');

  document.getElementById('startBtn').disabled = true;
}

// 音階の音リストを 上行/下行/上下 に分割する。
// notes 配列内の1音に "turn": true を付けると、そこが折り返し地点（頂点）として
// 上行と下行の境目に使われ、上下モードでも頂点の音が1回しか出てこなくなる。
// turn がない場合は notes を上行として扱い、下行はその逆順（頂点の重複は自動で除去）とする。
function splitScaleNotes(scale) {
  const notes   = scale.notes;
  const turnIdx = notes.findIndex(n => n.turn);

  if (turnIdx === -1) {
    const down = [...notes].reverse();
    return { up: notes, down, updown: [...notes, ...down.slice(1)] };
  }

  return {
    up:     notes.slice(0, turnIdx + 1),
    down:   notes.slice(turnIdx),
    updown: notes
  };
}

// ===== 練習開始 =====
function startPractice() {
  const scaleKey  = document.getElementById('scaleSelect').value;
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const mode      = document.querySelector('input[name="mode"]:checked').value;
  const scale     = getCurrentScales()[scaleKey];

  // 音リストを組み立て
  const { up, down, updown } = splitScaleNotes(scale);

  if      (direction === 'up')      practiceNotes = up;
  else if (direction === 'down')    practiceNotes = down;
  else if (direction === 'updown')  practiceNotes = updown;
  else if (direction === 'arpeggio')practiceNotes = [...scale.arpeggio];

  currentIndex = 0;
  notesCorrect = 0;

  document.getElementById('setupCard').style.display    = 'none';
  document.getElementById('practiceCard').style.display = 'block';
  document.getElementById('completeCard').style.display = 'none';

  const badge = document.getElementById('modeBadge');
  badge.textContent = mode === 'step' ? '🎯 1音ずつモード' : `🥁 テンポモード ${document.getElementById('bpmRange').value} BPM`;

  renderNoteTrack();

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
  const noteData = scalesData.notes[practiceNotes[currentIndex].note];
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

  // 指板・音符トラックに最初の音をすぐ反映する（前回の練習の表示が
  // カウントダウン中に一瞬見えてしまうのを防ぐ）
  showCurrentNote();

  const countdownEl = document.getElementById('countdown');
  countdownEl.textContent = countdown; // 前回のカウントダウンの残り表示が一瞬見えるのを防ぐ
  countdownEl.style.display = 'block';

  // マイク起動（常時聴いておく）
  detector.start((freq) => {
    detectedFreqNow = freq;
    document.getElementById('resultFreq').textContent = `周波数: ${freq.toFixed(1)} Hz`;
  });

  // カウントダウン
  countTimer = setInterval(() => {
    if (countdown > 0) {
      countdownEl.textContent = countdown;
      playClick(true); // 強拍
      countdown--;
    } else {
      clearInterval(countTimer);
      countTimer = null;
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

        // evaluateBeat()が出した直前の音の判定(✅/❌)は消さずに残す
        showCurrentNote(false);
        playClick(beat % 4 === 0);
      }, interval);
    }
  }, interval);
}

function evaluateBeat() {
  if (currentIndex >= practiceNotes.length) return;
  const noteData = scalesData.notes[practiceNotes[currentIndex].note];
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
  currentIndex++;
  if (currentIndex >= practiceNotes.length) {
    completePractice();
  } else {
    showCurrentNote();
    isPracticing = true;
  }
}

function showCurrentNote(clearStatus = true) {
  if (currentIndex >= practiceNotes.length) return;
  const entry = practiceNotes[currentIndex];
  if (clearStatus) {
    document.getElementById('resultStatus').textContent = '';
    document.getElementById('resultStatus').className   = 'result-status';
  }
  document.getElementById('fingeringInfo').textContent = `${entry.string} · ${entry.position}`;
  document.getElementById('resultFreq').textContent    = '周波数: -- Hz';

  updateNoteTrackView();
  updateFingerboard(entry);
}

// ===========================
// 指板ビュー
// ===========================
// 指の縦位置は「開放弦から何半音離れているか」で決める。
// ミ→ファ、シ→ドのような半音の隣り合いは間隔が狭く、全音の隣り合いは
// 間隔が広くなる（実際のバイオリンの指の間隔と同じ）。
const FB_STRING_X    = { 'G弦': 45, 'D弦': 95, 'A弦': 145, 'E弦': 195 };
const FB_STRING_OPEN = { 'G弦': 'G3', 'D弦': 'D4', 'A弦': 'A4', 'E弦': 'E5' };
const FB_NUT_Y            = 30;  // 開放弦（0半音）の位置
const FB_PX_PER_SEMITONE  = 18;  // 半音1つあたりの縦幅
const FB_MAX_Y             = 225; // 指板の下端

function fingerboardY(entry) {
  const openFreq = scalesData.notes[FB_STRING_OPEN[entry.string]].freq;
  const noteFreq = scalesData.notes[entry.note].freq;
  const semitones = 12 * Math.log2(noteFreq / openFreq);
  return Math.min(FB_NUT_Y + semitones * FB_PX_PER_SEMITONE, FB_MAX_Y);
}

function renderFingerboardTicks() {
  const g = document.getElementById('fbTicks');
  if (!g || g.childNodes.length > 0) return;
  const svgNS = 'http://www.w3.org/2000/svg';
  const maxSemitone = Math.floor((FB_MAX_Y - FB_NUT_Y) / FB_PX_PER_SEMITONE);
  for (let s = 1; s <= maxSemitone; s++) {
    const line = document.createElementNS(svgNS, 'line');
    const y = FB_NUT_Y + s * FB_PX_PER_SEMITONE;
    line.setAttribute('x1', 30); line.setAttribute('x2', 210);
    line.setAttribute('y1', y);  line.setAttribute('y2', y);
    line.setAttribute('class', 'fb-position-guide');
    g.appendChild(line);
  }
}

// G3〜D6 の間にある♯♭なしの音（幹音）を、各弦ごとに実際に届く高さへ配置する。
// 同じ音名でも弦によって開放弦からの半音数が違うので、縦位置は弦ごとに変わる
// （実際の指板で各音の位置が弦ごとに違うのと同じ）。
const FB_NATURAL_NOTES = ['G3','A3','H3','C4','D4','E4','F4','G4','A4','H4','C5','D5','E5','F5','G5','A5','H5','C6','D6'];
const FB_LETTER        = { G: 'G', A: 'A', H: 'H', C: 'C', D: 'D', E: 'E', F: 'F' };
const FB_NATURAL_RE    = /^[A-H]\d$/; // 例: "C4" は幹音、"Cs4"/"Df4" はシャープ/フラット

// "Fs4" → "F♯"、"Df4" → "D♭" のように表示用ラベルへ変換する
function noteDisplayLabel(noteKey) {
  const m = noteKey.match(/^([A-H])(s|f)?\d$/);
  if (!m) return noteKey;
  const accidental = m[2] === 's' ? '♯' : m[2] === 'f' ? '♭' : '';
  return FB_LETTER[m[1]] + accidental;
}

function renderFingerboardLandmarks() {
  const g = document.getElementById('fbLandmarks');
  if (!g || g.childNodes.length > 0) return;
  const svgNS = 'http://www.w3.org/2000/svg';
  const maxSemitone = Math.floor((FB_MAX_Y - FB_NUT_Y) / FB_PX_PER_SEMITONE);

  Object.keys(FB_STRING_OPEN).forEach(str => {
    const openFreq = scalesData.notes[FB_STRING_OPEN[str]].freq;
    const x = FB_STRING_X[str];

    FB_NATURAL_NOTES.forEach(noteKey => {
      const semitones = 12 * Math.log2(scalesData.notes[noteKey].freq / openFreq);
      if (semitones < -0.01 || semitones > maxSemitone + 0.01) return; // 開放弦より低い/指板の外は除く
      const y = FB_NUT_Y + semitones * FB_PX_PER_SEMITONE;

      const chip = document.createElementNS(svgNS, 'g');
      chip.setAttribute('class', 'fb-landmark');
      chip.dataset.string = str;
      chip.dataset.note   = noteKey;

      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', 8);
      circle.setAttribute('class', 'fb-landmark-circle');
      chip.appendChild(circle);

      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', x); label.setAttribute('y', y + 3);
      label.setAttribute('class', 'fb-landmark-label');
      label.textContent = FB_LETTER[noteKey[0]];
      chip.appendChild(label);

      g.appendChild(chip);
    });
  });
}

function updateFingerboard(entry) {
  const cx        = FB_STRING_X[entry.string] ?? 120;
  const cy        = fingerboardY(entry);
  const isNatural = FB_NATURAL_RE.test(entry.note);

  // 幹音（♯♭なし）ならその音名の丸自体を明るく表示し、
  // ♯♭の音は指板上に丸がないので、これまでどおり浮動マーカーで示す。
  document.querySelectorAll('.fb-landmark').forEach(chip => {
    const isCurrent = isNatural && chip.dataset.string === entry.string && chip.dataset.note === entry.note;
    chip.classList.toggle('current', isCurrent);
    if (isCurrent) chip.parentNode.appendChild(chip); // 他の丸より手前に描画する
  });

  // 丸と音名テキストは1つの<g>にまとめてtransformで一緒に動かす。
  // 別々にcx/cyとx/yを遷移させると、丸は移動中でも文字だけ先に
  // 次の音名に切り替わってしまい、丸と文字がずれて見えることがあったため。
  const markerGroup = document.getElementById('fingerMarkerGroup');
  const markerLabel = document.getElementById('fingerMarkerLabel');
  markerGroup.style.transform = `translate(${cx}px, ${cy}px)`;
  markerLabel.textContent     = isNatural ? '' : noteDisplayLabel(entry.note);
  markerGroup.style.display   = isNatural ? 'none' : '';

  document.querySelectorAll('.fb-string').forEach(line => {
    line.classList.toggle('active', line.dataset.string === entry.string);
  });
}

// 音符が右から流れてくる譜面風トラックを描画する。
// 常に5個表示し、中央が今弾く音、左側が弾き終えた音、右側がこれから弾く音。
// 上行・下行どちらでも縦位置は揃え、横一列に流れるようにする。
// オクターブは音名の下の小さな数字で区別する。
// スマホなど #noteStaff の実際の横幅が460pxより狭い場合、CSSのmax-width:100%で
// 見た目は縮むが、子要素はpx固定のままだとズレる。そのため実際の表示幅から
// 毎回スロット幅を計算し直す。
const NOTE_VISIBLE = 5;  // 常に表示する音符の数
const NOTE_TOP      = 60; // すべての音符の縦位置（固定）

function noteTrackMetrics() {
  const width = document.getElementById('noteStaff').clientWidth || NOTE_VISIBLE * 92;
  const slot  = width / NOTE_VISIBLE;
  return { slot, focus: width / 2 };
}

function renderNoteTrack() {
  const track = document.getElementById('noteTrack');
  const { slot } = noteTrackMetrics();

  track.innerHTML = practiceNotes.map((entry, i) => {
    const noteData = scalesData.notes[entry.note];
    const octave   = entry.note.match(/\d+$/)?.[0] || '';
    return `<div class="note-chip" style="left:${i * slot}px; top:${NOTE_TOP}px;">
      <span class="note-chip-label">${noteData.label}</span>
      <span class="note-chip-octave">${octave}</span>
    </div>`;
  }).join('');

  updateNoteTrackView();
}

function updateNoteTrackView() {
  const track = document.getElementById('noteTrack');
  const { slot, focus } = noteTrackMetrics();
  track.style.transform = `translateX(${focus - currentIndex * slot}px)`;

  document.querySelectorAll('.note-chip').forEach((chip, i) => {
    chip.classList.toggle('done', i < currentIndex);
    chip.classList.toggle('current', i === currentIndex);
  });
}

window.addEventListener('resize', () => {
  // 画面の向きが変わるなどして #noteStaff の幅が変わったら、スロット幅を再計算して並べ直す
  if (document.getElementById('practiceCard').style.display !== 'none') renderNoteTrack();
});

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
    bpm, notes_correct: notesCorrect, notes_total: practiceNotes.length,
    profile_id: currentProfileId
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
  if (countTimer)    { clearInterval(countTimer);    countTimer = null; }
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
  const history = await getHistory(currentProfileId);
  const list = document.getElementById('historyList');
  if (history.length === 0) {
    list.innerHTML = '<li class="history-empty">まだ履歴がありません</li>';
    return;
  }
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
  const data   = await getStats(currentProfileId);
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
        borderColor: '#e8c468',
        backgroundColor: 'rgba(232,196,104,0.15)',
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
        backgroundColor: 'rgba(127,166,104,0.75)',
        borderRadius: 6
      }]
    },
    options: chartOptions('回数', undefined, undefined, true)
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
        backgroundColor: 'rgba(179,80,90,0.75)',
        borderRadius: 6
      }]
    },
    options: chartOptions('正答率 (%)', 0, 100)
  });
}

function chartOptions(yLabel, min, max, integer = false) {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: '#f5e8d8' } } },
    scales: {
      x: { ticks: { color: '#c2a78c' }, grid: { color: 'rgba(212,162,78,0.12)' } },
      y: {
        ticks: { color: '#c2a78c', precision: integer ? 0 : undefined },
        grid: { color: 'rgba(212,162,78,0.12)' },
        title: { display: true, text: yLabel, color: '#c2a78c' },
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
document.getElementById('categorySelect').addEventListener('change', populateScaleSelect);

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

document.querySelectorAll('.view-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('noteStaff').style.display   = view === 'notes'       ? 'block' : 'none';
    document.getElementById('fingerboard').style.display = view === 'fingerboard' ? 'block' : 'none';
  });
});

document.getElementById('retryBtn').addEventListener('click', () => {
  statsLoaded = false;
  document.getElementById('setupCard').style.display   = 'block';
  document.getElementById('completeCard').style.display = 'none';
});

async function clearAllHistory() {
  if (!confirm('履歴を全件削除しますか？')) return;
  await clearHistory(currentProfileId);
  document.getElementById('historyList').innerHTML =
    '<li class="history-empty">まだ履歴がありません</li>';
  if (statsLoaded) renderStats();
}

document.getElementById('clearStatsBtn').addEventListener('click', clearAllHistory);

// ===========================
// プロフィール管理
// ===========================
const PROFILE_STORAGE_KEY = 'violinapp_profile_id';

function renderProfileSelect(profiles) {
  const select = document.getElementById('profileSelect');
  select.innerHTML = profiles.map(p =>
    `<option value="${p.id}" ${p.id === currentProfileId ? 'selected' : ''}>${p.name}</option>`
  ).join('');
}

async function initProfiles() {
  const profiles = await getProfiles();
  const saved = parseInt(localStorage.getItem(PROFILE_STORAGE_KEY), 10);
  const match = profiles.find(p => p.id === saved);
  currentProfileId = match ? match.id : profiles[0].id;
  renderProfileSelect(profiles);
  await renderHistory();
}

document.getElementById('profileSelect').addEventListener('change', async (e) => {
  currentProfileId = parseInt(e.target.value, 10);
  localStorage.setItem(PROFILE_STORAGE_KEY, currentProfileId);
  await renderHistory();
  if (statsLoaded) await renderStats();
});

document.getElementById('addProfileBtn').addEventListener('click', async () => {
  const name = prompt('新しいプロフィール名を入力してください');
  if (!name || !name.trim()) return;
  try {
    const profile = await createProfile(name.trim());
    currentProfileId = profile.id;
    localStorage.setItem(PROFILE_STORAGE_KEY, currentProfileId);
    renderProfileSelect(await getProfiles());
    await renderHistory();
    if (statsLoaded) await renderStats();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('deleteProfileBtn').addEventListener('click', async () => {
  const profiles = await getProfiles();
  if (profiles.length <= 1) {
    alert('最後のプロフィールは削除できません');
    return;
  }
  const current = profiles.find(p => p.id === currentProfileId);
  if (!confirm(`プロフィール「${current?.name}」と、その練習履歴を削除しますか？`)) return;
  try {
    await deleteProfile(currentProfileId);
    const remaining = await getProfiles();
    currentProfileId = remaining[0].id;
    localStorage.setItem(PROFILE_STORAGE_KEY, currentProfileId);
    renderProfileSelect(remaining);
    await renderHistory();
    if (statsLoaded) await renderStats();
  } catch (err) {
    alert(err.message);
  }
});

// ===========================
// 初期化
// ===========================
loadScales();
initProfiles();
renderFingerboardTicks();


//442hz