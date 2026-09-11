// マイクの音を拾って周波数（Hz）を判定してくれるオブジェクト（pitch.js で定義）
const detector = new PitchDetector();

// デモモード用：マイクの代わりに、指定した条件で自動的に「弾いた音」をシミュレートするオブジェクト。
// PitchDetectorと同じ start(onPitchDetected) / stop() インターフェースを持たせることで、
// テンポモード側のコードを一切変えずに、本物のdetectorと差し替えて使えるようにしている。
class DemoPitchSource {
  constructor({ offsetCents = 0, jitterCents = 0, silenceChance = 0 } = {}) {
    this.offsetCents   = offsetCents;
    this.jitterCents   = Math.max(0, jitterCents);
    this.silenceChance = Math.min(100, Math.max(0, silenceChance));
    this.timerId       = null;
  }

  start(onPitchDetected) {
    // 実機のPitchDetectorが requestAnimationFrame で継続的に値を出すのに合わせ、
    // 50ms間隔（秒間20回ほど）でシミュレートした周波数を通知する
    this.timerId = setInterval(() => {
      if (currentIndex >= practiceNotes.length) return;

      // 無音（弾いていない／マイクが拾えなかった）をシミュレート。この回は何も通知しない
      if (Math.random() * 100 < this.silenceChance) return;

      const entry    = practiceNotes[currentIndex];
      const noteData = scalesData.notes[entry.note];
      const jitter   = this.jitterCents > 0 ? (Math.random() * 2 - 1) * this.jitterCents : 0;
      const cents    = this.offsetCents + jitter;
      const freq     = noteData.freq * Math.pow(2, cents / 1200);
      onPitchDetected(freq);
    }, 50);
  }

  stop() {
    clearInterval(this.timerId);
    this.timerId = null;
  }
}

let activeSource = detector; // 実際に使うピッチ検出ソース（通常はdetector、デモモード時はDemoPitchSourceに差し替える）
let scalesData      = {}; // notes.json / 各音階ファイルを読み込んだ結果をまとめて保持する
let practiceNotes   = []; // 今回の練習で弾く音の並び（startPractice()で組み立てる）
let currentIndex    = 0;  // practiceNotes のうち、今どの音を練習中か
let isPracticing    = false; // 今マイクの判定結果を受け付けてよいか（判定中の二重反応を防ぐ）
let currentProfileId = null; // 選択中のプロフィール（ユーザー）のID
let noteDisplayMode = 'chips'; // 練習中の音符表示：'chips'=従来の丸チップ／'staff'=五線譜（管理者が設定を切り替える）
let resultDisplayMode = 'accuracy'; // 結果画面の表示：'accuracy'=正答率／'score'=カラオケ風の点数／'both'=両方（管理者が設定を切り替える）

// テンポモード用
let tempoInterval  = null; // メトロノームのsetInterval ID（stopPractice等で止めるために保持）
let countTimer     = null; // 開始前カウントダウンのsetInterval ID
let notesCorrect   = 0;    // 今回の練習で正解した音の数（正答率の計算に使う）
let detectedFreqNow = null; // テンポモードで「直近に検出できた周波数」を一時保存しておく変数
let practiceResults = []; // 結果画面の詳細表示用：今回の練習で音ごとに何が起きたかの記録
let currentNoteMissed = false; // 1音ずつモードで、今の音を一発で取れず「惜しい/ズレ大」を経由したか
let showCurrentGlow = true; // 音符トラックの「今弾く音」の光り方を出すかどうか（テンポモードのカウントダウン中はfalseにする）

// ===== 音階データ読み込み =====
// カテゴリーを追加する場合はここに1行足す（例: 第3ポジション）
const CATEGORY_FILES = [
  { key: 'first_position', file: '/static/data/scales/first_position.json' },
  { key: 'two_octave',     file: '/static/data/scales/two_octave.json' },
];

// ページ読み込み時に音階データ一式（音名→周波数の対応表 notes.json と、
// 各カテゴリーの音階定義ファイル）をまとめて取得し、scalesData に格納する。
// 完了したらセレクトボックスと指板の目印を描画する。
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
  populateDemoToneNoteSelect();
}

// デモモードの「セント調整で音を鳴らす」用に、音名セレクトの中身を作る
function populateDemoToneNoteSelect() {
  const select = document.getElementById('demoToneNote');
  if (!select) return;
  const keys = Object.keys(scalesData.notes);
  select.innerHTML = keys.map(key =>
    `<option value="${key}">${scalesData.notes[key].label}（${key}）</option>`
  ).join('');
  const defaultKey = keys.includes('A4') ? 'A4' : keys[0];
  if (defaultKey) select.value = defaultKey;
}

// ===== カテゴリー・調セレクト =====
// 「カテゴリー」セレクトボックス（第1ポジションなど）で今選ばれているキーを返す
function getCurrentCategoryKey() {
  return document.getElementById('categorySelect').value;
}

// 現在選択中のカテゴリーに属する音階一覧（{キー: 音階データ} の形）を返す
function getCurrentScales() {
  return scalesData.categories?.[getCurrentCategoryKey()]?.scales || {};
}

// 「調」セレクトボックスの中身を、現在のカテゴリーの音階一覧で作り直す
// （カテゴリーを切り替えたときに呼ばれる）
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
// 「開始」ボタンで呼ばれる。フォームの選択内容（音階・方向・モード）を読み取り、
// 練習する音の並び(practiceNotes)を組み立ててから、モードに応じて
// startStepMode() か startTempoMode() を開始する。
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
  practiceResults = [];
  currentNoteMissed = false;
  showCurrentGlow = true; // 1音ずつモードは最初から光らせる。テンポモードはstartTempoMode()内で制御する

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
// （正しい音程が取れるまで待ち、正解したら次の音へ進むモード）
// ===========================
// マイクを起動し、判定コールバックを登録して1音ずつモードを開始する
function startStepMode() {
  isPracticing = true;
  showCurrentNote();
  activeSource = detector; // デモモードは今のところテンポモードのみ対応。念のため実マイクに戻しておく

  // detector から継続的に周波数(freq)が渡ってくるので、都度判定する
  activeSource.start((freq) => {
    if (!isPracticing) return; // 正解直後など、次の音に進む間は判定を無視する
    onPitchDetectedStep(freq);
  });
}

// 検出された周波数を「今弾くべき音」の正しい周波数と比較し、結果を画面に表示する。
// 音程のズレは半音を100分割した単位「セント」で評価する
// （±15セント以内なら正解、±35セント以内なら惜しい、それ以上はズレ大）。
function onPitchDetectedStep(freq) {
  const entry    = practiceNotes[currentIndex];
  const noteData = scalesData.notes[entry.note];
  document.getElementById('resultFreq').textContent = `周波数: ${freq.toFixed(1)} Hz`;

  const cents    = 1200 * Math.log2(freq / noteData.freq); // 正の値=高すぎ、負の値=低すぎ
  const absCents = Math.abs(cents);
  const statusEl = document.getElementById('resultStatus');

  if (absCents <= 15) {
    statusEl.textContent = '✅ 正解！';
    statusEl.className   = 'result-status correct';
    notesCorrect++;
    practiceResults.push({ note: entry.note, string: entry.string, outcome: currentNoteMissed ? 'retry' : 'correct', cents });
    isPracticing = false; // 次の音に切り替わるまで、それ以上の判定を止める
    setTimeout(nextNote, 800); // 正解表示を一瞬見せてから次の音へ
  } else if (absCents <= 35) {
    statusEl.textContent = cents > 0 ? '▲ 少し高い' : '▼ 少し低い';
    statusEl.className   = 'result-status close';
    currentNoteMissed = true;
  } else {
    statusEl.textContent = cents > 0 ? '高すぎ ▲' : '低すぎ ▼';
    statusEl.className   = 'result-status wrong';
    currentNoteMissed = true;
  }
}

// ===========================
// テンポモード
// （メトロノームに合わせて、一定のテンポで次々と音を弾いていくモード。
//  正解を待たずに拍ごとに強制的に次の音へ進む）
// ===========================
// BPM（1分間の拍数）からメトロノームの間隔を計算し、
// カウントダウン→本番のメトロノーム開始、という流れを組み立てる
function startTempoMode() {
  const bpm      = parseInt(document.getElementById('bpmRange').value);
  const interval = (60 / bpm) * 1000;
  let beat       = 0;
  let countdown  = 3;
  let pendulumLeft = true; // ビートライトの振り子：次の拍は左端か右端か

  // 指板・音符トラックに最初の音をすぐ反映する（前回の練習の表示が
  // カウントダウン中に一瞬見えてしまうのを防ぐ）。ただし「今弾く音」の光り方は
  // カウントダウン中は消しておき、演奏が始まる瞬間に光るようにする
  showCurrentGlow = false;
  showCurrentNote();

  const countdownEl = document.getElementById('countdown');
  countdownEl.style.display = 'block';

  // 電子メトロノームのようにテンポを目で見て分かりやすくするビートライトを表示する
  document.getElementById('metronomeBar').style.display = 'flex';

  // 管理者がデモモードを有効にしていれば、マイクの代わりにシミュレートしたピッチ源を使う
  const demoEnabled = currentUser?.role === 'admin' && document.getElementById('demoModeEnabled').checked;
  activeSource = demoEnabled ? new DemoPitchSource({
    offsetCents:   parseFloat(document.getElementById('demoOffsetCents').value) || 0,
    jitterCents:   parseFloat(document.getElementById('demoJitterCents').value) || 0,
    silenceChance: parseFloat(document.getElementById('demoSilenceChance').value) || 0,
  }) : detector;

  // マイク（またはデモモードのシミュレート音）を起動し、常時聴いておく
  activeSource.start((freq) => {
    detectedFreqNow = freq;
    document.getElementById('resultFreq').textContent = `周波数: ${freq.toFixed(1)} Hz`;
  });

  // カウントダウン（3・2・1と数えて4拍目で開始する）。
  // 数字の表示とクリック音を必ず同時に出す。以前は数字を表示してから
  // 1拍分後にクリック音を鳴らしていたため、表示と音が1拍分ずれて聞こえていた。
  countdownEl.textContent = countdown;
  playClick(true); // 「3」の合図
  flashMetronome(null); // カウントダウン中は5つ全部を光らせる

  countTimer = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      countdownEl.textContent = countdown;
      playClick(true); // 強拍
      flashMetronome(null);
    } else {
      clearInterval(countTimer);
      countTimer = null;
      countdownEl.style.display = 'none';
      isPracticing = true;
      showCurrentGlow = true; // ここで初めて「今弾く音」を光らせる
      showCurrentNote();
      playClick(true); // 4拍目 = スタートの合図
      flashMetronome(pendulumLeft, true); // 1拍目（強拍）は左端から
      scheduleMetronomeSweep(pendulumLeft, interval); // 次の拍まで、真ん中3つを通り道として光が通過していく

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
        const isAccent = beat % 4 === 0;
        playClick(isAccent);
        pendulumLeft = !pendulumLeft; // 振り子のように毎拍、左端⇔右端を切り替える
        flashMetronome(pendulumLeft, isAccent);
        scheduleMetronomeSweep(pendulumLeft, interval);
      }, interval);
    }
  }, interval);
}

// 電子メトロノームのビートライトを1拍分光らせる。
// 振り子のように、拍のたびに左端(true)か右端(false)の丸だけが光る（真ん中3つは軌道の目印で光らない）。
// leftOrNull=nullはカウントダウン中で、5つ全部を光らせる。
function flashMetronome(leftOrNull, accent = false) {
  const dots = document.querySelectorAll('.metronome-dot');
  if (dots.length === 0) return;

  const targets = leftOrNull == null ? Array.from(dots) : [leftOrNull ? dots[0] : dots[dots.length - 1]];
  targets.forEach(dot => {
    dot.classList.add('active');
    dot.classList.toggle('accent', !!accent);
    clearTimeout(dot._metronomeTimer);
    dot._metronomeTimer = setTimeout(() => dot.classList.remove('active', 'accent'), 150);
  });
}

// ビートライトの真ん中3つを「通り道」として、拍から次の拍までの間に
// 光がそこを通過していくように、durationMs（拍の間隔）を4等分したタイミングで
// 順番に短く光らせる（左端から光ったなら次は右へ、右端からなら次は左へ）。
let sweepTimers = []; // 予約したタイマーIDをまとめて持っておき、中断時に解除できるようにする

function scheduleMetronomeSweep(startedFromLeft, durationMs) {
  const dots = document.querySelectorAll('.metronome-dot');
  if (dots.length < 5) return;

  const order = startedFromLeft ? [1, 2, 3] : [3, 2, 1];
  order.forEach((dotIndex, i) => {
    const delay = durationMs * (i + 1) / 4;
    const timerId = setTimeout(() => {
      const dot = dots[dotIndex];
      dot.classList.add('active');
      clearTimeout(dot._metronomeTimer);
      dot._metronomeTimer = setTimeout(() => dot.classList.remove('active'), Math.min(120, durationMs / 4));
    }, delay);
    sweepTimers.push(timerId);
  });
}

// ビートライトの点灯・予約中の通過演出をすべて止めて消灯する（練習の中断・完了時に呼ぶ）
function clearMetronomeVisual() {
  sweepTimers.forEach(id => clearTimeout(id));
  sweepTimers = [];
  document.querySelectorAll('.metronome-dot').forEach(dot => {
    clearTimeout(dot._metronomeTimer);
    dot.classList.remove('active', 'accent');
  });
}

// テンポモードで、直前の拍の間にマイクが拾えていた周波数(detectedFreqNow)を
// 「弾くべきだった音」と比較し、✅/❌を表示してから次の音へインデックスを進める。
// （1音ずつモードと違って正解を待たず、必ず1拍ごとに進む）
function evaluateBeat() {
  if (currentIndex >= practiceNotes.length) return;
  const entry    = practiceNotes[currentIndex];
  const noteData = scalesData.notes[entry.note];
  const statusEl = document.getElementById('resultStatus');

  if (detectedFreqNow && detectedFreqNow > 0) {
    const cents = 1200 * Math.log2(detectedFreqNow / noteData.freq);
    if (Math.abs(cents) <= 20) {
      statusEl.textContent = '✅';
      statusEl.className   = 'result-status correct';
      notesCorrect++;
      practiceResults.push({ note: entry.note, string: entry.string, outcome: 'correct', cents });
    } else {
      statusEl.textContent = '❌';
      statusEl.className   = 'result-status wrong';
      practiceResults.push({ note: entry.note, string: entry.string, outcome: 'wrong', cents });
    }
  } else {
    statusEl.textContent = '❌ 音なし';
    statusEl.className   = 'result-status wrong';
    practiceResults.push({ note: entry.note, string: entry.string, outcome: 'wrong', cents: null });
  }

  currentIndex++;
  detectedFreqNow = null;
}

// クリック音（Web Audio API）
// メトロノームの「カチッ」という音を鳴らす。accent=true のときは1拍目として
// 少し高く・大きい音にする（発音は毎回ゼロから作って0.08秒で鳴らして止める）
//
// AudioContextは毎回作り直すと（1) 生成自体に時間がかかりクリック音のタイミングが
// ずれる、(2) ブラウザ上限（Chromeは同時に持てるAudioContext数に上限がある）に達すると
// 生成が失敗し、以降クリック音が鳴らなくなる、という2つの不具合の原因になる。
// そのためAudioContextは1つだけ使い回し、鳴らす音（oscillator/gain）だけ毎回作る。
let clickAudioCtx = null;
function getClickAudioCtx() {
  if (!clickAudioCtx) {
    clickAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (clickAudioCtx.state === 'suspended') {
    clickAudioCtx.resume();
  }
  return clickAudioCtx;
}

function playClick(accent = false) {
  try {
    const ctx  = getClickAudioCtx();
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

// デモモード（管理者用）：選んだ音を指定セントだけズラして実際に鳴らす。
// 「セントのズレが実際どのくらいの音の違いなのか」を説明する際のデモ用。
function playDemoTone() {
  try {
    const noteKey  = document.getElementById('demoToneNote').value;
    const noteData = scalesData.notes[noteKey];
    if (!noteData) return;
    const cents = parseFloat(document.getElementById('demoToneCents').value) || 0;
    const freq  = noteData.freq * Math.pow(2, cents / 1200);

    const ctx  = getClickAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;

    const duration = 1.5;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.05);
    gain.gain.setValueAtTime(0.3, now + duration - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  } catch(e) {}
}

document.getElementById('playDemoToneBtn')?.addEventListener('click', playDemoTone);

// ===========================
// 共通（1音ずつモード・テンポモード両方から使われる）
// ===========================
// 次の音へ進む。最後まで終わっていれば練習完了処理を呼ぶ（1音ずつモード用）
function nextNote() {
  currentIndex++;
  if (currentIndex >= practiceNotes.length) {
    completePractice();
  } else {
    showCurrentNote();
    isPracticing = true;
  }
}

// 現在の音(currentIndex)の情報を画面に反映する。
// 判定結果の表示クリア・運指情報・音符トラック・指板の表示をまとめて更新する。
// clearStatus=false のときは直前の判定結果（✅/❌）を消さずに残す（テンポモードで使用）
function showCurrentNote(clearStatus = true) {
  if (currentIndex >= practiceNotes.length) return;
  const entry = practiceNotes[currentIndex];
  currentNoteMissed = false;
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

// entry（弦名＋音名）の指の位置を、指板SVG上の縦座標(y)として計算する。
// 開放弦の周波数との比から半音数を逆算し、半音ごとのpx幅を掛けて位置を出す。
function fingerboardY(entry) {
  const openFreq = scalesData.notes[FB_STRING_OPEN[entry.string]].freq;
  const noteFreq = scalesData.notes[entry.note].freq;
  const semitones = 12 * Math.log2(noteFreq / openFreq);
  return Math.min(FB_NUT_Y + semitones * FB_PX_PER_SEMITONE, FB_MAX_Y);
}

// 指板の背景に、半音ごとの目安線（ガイドライン）を描画する（初回のみ・以後は再利用）
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

// 4本の弦それぞれについて、幹音（♯♭なしの音）の位置に丸印とラベルを描画する。
// これが指板上に常時表示される「目印（ランドマーク）」になり、
// updateFingerboard() が現在の音に該当する丸をハイライトする（初回のみ描画）。
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

// 今弾くべき音(entry)に合わせて、指板の表示を更新する。
// 幹音なら該当するランドマークの丸を光らせ、♯♭が付く音なら
// 浮動マーカー（fingerMarkerGroup）をその位置に移動して音名を表示する。
// あわせて、対象の弦を光らせる。
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
// スマホなど #noteStaff の実際の横幅が460pxより狭い場合、CSSのmax-width:100%で
// 見た目は縮むが、子要素はpx固定のままだとズレる。そのため実際の表示幅から
// 毎回スロット幅を計算し直す。
const NOTE_VISIBLE  = 5;   // 常に表示する音符の数
const STAFF_HEIGHT  = 140; // 五線譜エリアの高さ（CSSの.note-staffの高さと合わせる）
const STAFF_STEP_PX = 6;   // 五線譜のダイアトニック1段（線と間1つ分の半分）あたりの縦px
const STAFF_BOTTOM_Y = 95; // 五線の一番下の線（ミ4=E4）のy座標

// このアプリの音名表記（ドイツ音名。C,D,E,F,G,A,H＋♯はs,♭はfの接尾辞）を、
// 五線譜上の段数（ダイアトニック段。1段＝五線の線と間を合わせて7音分で1オクターブ）に変換する。
// H＝シ（幹音）、Bf＝シ♭という表記のため、譜面上の位置としてはどちらも「シ」の段に置き、
// 臨時記号（♯/♭）は別に描く。
const STAFF_LETTER_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
function parseNoteForStaff(noteKey) {
  const [, letter, accidentalChar, octaveStr] = noteKey.match(/^([A-Za-z])([sf]?)(\d+)$/);
  const octave = parseInt(octaveStr, 10);
  if (letter === 'H') return { staffLetter: 'B', accidental: null, octave }; // シ
  if (letter === 'B') return { staffLetter: 'B', accidental: 'f',  octave }; // シ♭
  return { staffLetter: letter, accidental: accidentalChar || null, octave };
}

// 五線の一番下の線（E4）を基準0としたダイアトニック段数を返す（1段上がる＝五線上で半段分上）
function staffOffset(noteKey) {
  const { staffLetter, octave } = parseNoteForStaff(noteKey);
  const E4_STEP = 4 * 7 + STAFF_LETTER_STEP.E;
  return (octave * 7 + STAFF_LETTER_STEP[staffLetter]) - E4_STEP;
}

function staffY(offset) {
  return STAFF_BOTTOM_Y - offset * STAFF_STEP_PX;
}

// 五線からはみ出す音に必要な加線の段数一覧を返す
// （音自体が線上に来る場合はその段まで、間に来る場合はその手前の線までを描く）
function ledgerOffsets(offset) {
  const offs = [];
  if (offset > 8)      for (let o = 10; o <= offset; o += 2) offs.push(o);
  else if (offset < 0)  for (let o = -2; o >= offset; o -= 2) offs.push(o);
  return offs;
}

// 音符トラックの実際の表示幅から、音符1個あたりの横幅(slot)と
// 中央（今弾く音を置く位置）の座標(focus)を計算する
function noteTrackMetrics() {
  const width = document.getElementById('noteStaff').clientWidth || NOTE_VISIBLE * 92;
  const slot  = width / NOTE_VISIBLE;
  return { slot, focus: width / 2, width };
}

// 五線譜（固定の5本線）を、現在の表示幅いっぱいに描画する
function renderStaffLines(width) {
  document.getElementById('staffLines').innerHTML = [0, 2, 4, 6, 8].map(o =>
    `<line class="staff-line" x1="0" y1="${staffY(o)}" x2="${width}" y2="${staffY(o)}"/>`
  ).join('');
}

// #noteStaff の中身を、表示モードに合わせた入れ物（五線譜のSVG or 従来の丸チップ用div）に
// 作り直す。管理者が設定を切り替えても、次に練習を始めたときに正しい方が使われる。
function renderNoteStaffContainer() {
  const container = document.getElementById('noteStaff');
  if (noteDisplayMode === 'staff') {
    container.innerHTML = `
      <svg class="staff-svg" id="staffSvg" viewBox="0 0 460 140" preserveAspectRatio="none">
        <g id="staffLines"></g>
        <text class="staff-clef" x="6" y="98">𝄞</text>
        <g class="note-track" id="noteTrack"></g>
      </svg>
      <div class="note-playhead"></div>`;
  } else {
    container.innerHTML = `
      <div class="note-playhead"></div>
      <div class="note-track" id="noteTrack"></div>`;
  }
}

// practiceNotes 全体分の音符を横一列に並べて描画する（曲が始まるとき・画面サイズが変わったときに呼ばれる）。
// 表示モード（noteDisplayMode）に応じて、五線譜表示と従来の丸チップ表示を切り替える。
function renderNoteTrack() {
  renderNoteStaffContainer();
  if (noteDisplayMode === 'staff') {
    renderNoteTrackStaff();
  } else {
    renderNoteTrackChips();
  }
}

// 【五線譜表示】音符を、五線譜上の正しい高さに配置する
function renderNoteTrackStaff() {
  const track = document.getElementById('noteTrack');
  const { slot, width } = noteTrackMetrics();

  document.getElementById('staffSvg').setAttribute('viewBox', `0 0 ${width} ${STAFF_HEIGHT}`);
  renderStaffLines(width);

  track.innerHTML = practiceNotes.map((entry, i) => {
    const x = i * slot; // 各音符の中心x（トラック全体はtranslateXで動かす）
    const offset = staffOffset(entry.note);
    const y = staffY(offset);
    const { accidental } = parseNoteForStaff(entry.note);
    const noteData = scalesData.notes[entry.note];

    const ledgers = ledgerOffsets(offset).map(o => {
      const ly = staffY(o);
      return `<line class="note-ledger" x1="${x - 12}" y1="${ly}" x2="${x + 12}" y2="${ly}"/>`;
    }).join('');

    const accidentalGlyph = accidental === 's' ? '♯' : accidental === 'f' ? '♭' : '';
    const accidentalSvg = accidentalGlyph
      ? `<text class="note-accidental" x="${x - 13}" y="${y + 4}">${accidentalGlyph}</text>`
      : '';

    const labelY = y > STAFF_HEIGHT / 2 ? y - 12 : y + 18;

    return `<g class="staff-note" style="transform-origin:${x}px ${y}px">
      <circle class="note-highlight" cx="${x}" cy="${y}" r="15"/>
      ${ledgers}
      ${accidentalSvg}
      <ellipse class="note-head" cx="${x}" cy="${y}" rx="7" ry="5.5"/>
      <text class="note-solfege" x="${x}" y="${labelY}">${noteData.label}</text>
    </g>`;
  }).join('');

  updateNoteTrackView();
}

// 【従来の丸チップ表示】音名の読み仮名＋オクターブ数字を丸の中に表示する
const NOTE_TOP = 60; // すべての音符の縦位置（固定）
function renderNoteTrackChips() {
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

// currentIndex に合わせて音符トラック全体を横スクロールさせ（translateX）、
// 弾き終えた音には done、今弾く音には current のクラスを付け替える
// （表示モードにより .note-chip（丸チップ）か .staff-note（五線譜）のどちらかが対象になる）
function updateNoteTrackView() {
  const track = document.getElementById('noteTrack');
  const { slot, focus } = noteTrackMetrics();
  track.style.transform = `translateX(${focus - currentIndex * slot}px)`;

  document.querySelectorAll('.note-chip, .staff-note').forEach((chip, i) => {
    chip.classList.toggle('done', i < currentIndex);
    chip.classList.toggle('current', showCurrentGlow && i === currentIndex);
  });
}

window.addEventListener('resize', () => {
  // 画面の向きが変わるなどして #noteStaff の幅が変わったら、スロット幅を再計算して並べ直す
  if (document.getElementById('practiceCard').style.display !== 'none') renderNoteTrack();
});

// 練習（音階1周分）が最後まで終わったときに呼ばれる。
// マイク・タイマーを止め、正答率を計算してサーバーに履歴として保存し、
// 完了カード（結果画面）を表示する
async function completePractice() {
  activeSource.stop();
  isPracticing = false;
  if (tempoInterval) { clearInterval(tempoInterval); tempoInterval = null; }
  clearMetronomeVisual();
  document.getElementById('metronomeBar').style.display = 'none';

  const scaleKey  = document.getElementById('scaleSelect').value;
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const mode      = document.querySelector('input[name="mode"]:checked').value;
  const bpm       = mode === 'tempo' ? parseInt(document.getElementById('bpmRange').value) : null;

  const dirLabels = { up: '上行', down: '下行', updown: '上下', arpeggio: 'アルペジオ' };
  const dirLabel  = dirLabels[direction] || direction;

  const accuracy = practiceNotes.length > 0
    ? Math.round(notesCorrect / practiceNotes.length * 100) : 0;
  const karaokeScore = computeKaraokeScore(practiceResults);

  // ゲストモードでは記録を一切保存しない（ログインしていないので保存先のアカウントが無い）
  if (!isGuest) {
    // profile_idは送らない。誰の記録として保存するかはサーバー側で
    // ログイン中の本人アカウントに固定しているため（他人になりすまして記録できないように）
    const entry = await saveHistory({
      scale: scaleKey, direction: dirLabel, mode,
      bpm, notes_correct: notesCorrect, notes_total: practiceNotes.length,
      note_results: practiceResults
    });
    addHistoryItem(entry);
  }

  document.getElementById('practiceCard').style.display  = 'none';
  document.getElementById('completeCard').style.display  = 'block';
  document.getElementById('completeMsg').textContent =
    `${scaleKey}（${dirLabel}）完了！`;

  // テンポモードのみ結果を表示（管理者の設定で「正答率」か「点数（カラオケ風）」を切り替え）
  const scoreDetailToggle = document.getElementById('scoreDetailToggle');
  const scoreDetailList   = document.getElementById('scoreDetailList');
  if (mode === 'tempo') {
    document.getElementById('accuracyDisplay').style.display = 'block';
    renderAccuracyOrScore(accuracy, karaokeScore);

    // 音ごとの点数の内訳は、ボタンを押すまでは畳んでおく（結果画面がごちゃつかないように）
    renderScoreDetail(practiceResults);
    scoreDetailToggle.textContent   = '📊 点数の内訳を見る';
    scoreDetailToggle.style.display = 'block';
    scoreDetailList.style.display   = 'none';
  } else {
    document.getElementById('accuracyDisplay').style.display = 'none';
    scoreDetailToggle.style.display = 'none';
    scoreDetailList.style.display   = 'none';
  }

  renderResultDetail(mode);
}

// 音ごとの点数の内訳（音名・ズレ幅・点数）を一覧にして描画する。
// 表示のON/OFF自体はscoreDetailToggleのクリックハンドラ側で行う
function renderScoreDetail(results) {
  const listEl = document.getElementById('scoreDetailList');
  listEl.innerHTML = results.map(r => {
    const noteData = scalesData.notes[r.note];
    const octave    = r.note.match(/\d+$/)?.[0] || '';
    const centsText = r.cents == null ? '音なし' : `${r.cents > 0 ? '+' : ''}${Math.round(r.cents)}セント`;
    const points    = computeNoteScore(r);
    const symbol    = noteScoreSymbol(points);
    return `<div class="score-detail-row">
      <span class="score-detail-note">${noteData.label}${octave}</span>
      <span class="score-detail-cents">${centsText}</span>
      <span class="score-detail-points">${symbol} ${points}点</span>
    </div>`;
  }).join('');
}

// 「点数の内訳を見る」ボタンで開閉する
document.getElementById('scoreDetailToggle').addEventListener('click', () => {
  const listEl = document.getElementById('scoreDetailList');
  const toggle = document.getElementById('scoreDetailToggle');
  const showing = listEl.style.display !== 'none';
  listEl.style.display   = showing ? 'none' : 'block';
  toggle.textContent     = showing ? '📊 点数の内訳を見る' : '📊 点数の内訳を閉じる';
});

// 音程のズレ幅（cents）から1音ぶんの判定を決めるための2つの境目
// （1音ずつモードの「正解／惜しい／ズレ大」と同じ基準を採用している）
const SCORE_GOOD_CENTS  = 15; // これ以内なら○（2点）
const SCORE_CLOSE_CENTS = 35; // これ以内なら△（1点）。これを超えたら×（0点）

// 1音ぶんの判定を2/1/0点で返す。
// ・音が検出できなかった（cents無し）場合は×（0点）
// ・|cents| が15セント以内なら○（2点）
// ・35セント以内なら△（1点）
// ・それを超えたら×（0点）
function computeNoteScore(result) {
  if (result.cents == null) return 0;

  const absCents = Math.abs(result.cents);
  if (absCents <= SCORE_GOOD_CENTS)  return 2; // ○
  if (absCents <= SCORE_CLOSE_CENTS) return 1; // △
  return 0; // ×
}

// 2/1/0点を○/△/×の記号に変換する（内訳表示用）
function noteScoreSymbol(points) {
  if (points === 2) return '○';
  if (points === 1) return '△';
  return '×';
}

// 練習1回ぶんのカラオケ風スコアを { total: 合計得点, max: 満点（弾いた音符数×2点） } で返す。
// 100点満点への換算はせず、「合計得点／満点」をそのまま使う
function computeKaraokeScore(results) {
  const totalPoints = results.reduce((sum, r) => sum + computeNoteScore(r), 0);
  const maxPoints    = results.length * 2;
  return { total: totalPoints, max: maxPoints };
}

// 正答率（accuracy、0〜100）とカラオケ風の点数（karaokeScore = {total, max}）を、
// 設定に応じて「正答率」「点数（カラオケ風）」「両方」のいずれかで描画する。
// 正答率は「正解した音の数÷全体」の単純な割合、点数は音ごとのズレ幅も加味した別の指標で、
// 意図的に別の数値になる（正解でも完全一致でなければ点数は正答率よりズレて出ることがある）。
function renderAccuracyOrScore(accuracy, karaokeScore) {
  const numEl   = document.getElementById('accuracyNum');
  const labelEl = document.getElementById('accuracyLabel');
  const subEl   = document.getElementById('accuracySub');

  const scoreText  = `${karaokeScore.total}/${karaokeScore.max}点`;
  const showsScore = resultDisplayMode === 'score' || resultDisplayMode === 'both';

  if (showsScore) {
    numEl.textContent   = scoreText;
    labelEl.textContent = 'スコア';
  } else {
    numEl.textContent   = `${accuracy}%`;
    labelEl.textContent = '正答率';
  }

  // 「両方」のときは、メインで出していない方（正答率）をサブ行に添える
  if (resultDisplayMode === 'both') {
    subEl.textContent   = `（正答率 ${accuracy}%）`;
    subEl.style.display = 'block';
  } else {
    subEl.style.display = 'none';
  }
}

// 完了画面に「どの音が合っていて、どの音がズレていたか」を音符ごとに一覧表示する。
// テンポモード：✅/❌とセント（音程のズレ幅）を表示
// 1音ずつモード：最終的には全問正解になるので、一発で取れたか・やり直しがあったかを表示
function renderResultDetail(mode) {
  const detailEl = document.getElementById('resultDetail');

  if (practiceResults.length === 0) {
    detailEl.innerHTML = '';
    return;
  }

  const chips = practiceResults.map(r => {
    const noteData = scalesData.notes[r.note];
    const octave   = r.note.match(/\d+$/)?.[0] || '';
    const centsStr = r.cents == null ? '' : `${r.cents > 0 ? '+' : ''}${Math.round(r.cents)}`;
    const subText  = r.outcome === 'retry' ? 'やり直し' : (r.cents == null ? '音なし' : centsStr);

    return `<div class="result-chip ${r.outcome}" title="${r.string}">
      <span class="result-chip-label">${noteData.label}${octave}</span>
      <span class="result-chip-sub">${subText}</span>
    </div>`;
  }).join('');

  const legend = mode === 'tempo'
    ? `<div class="result-legend">
         <span><i class="dot correct"></i>正解 ${practiceResults.filter(r => r.outcome === 'correct').length}</span>
         <span><i class="dot wrong"></i>不正解 ${practiceResults.filter(r => r.outcome === 'wrong').length}</span>
       </div>`
    : `<div class="result-legend">
         <span><i class="dot correct"></i>一発OK ${practiceResults.filter(r => r.outcome === 'correct').length}</span>
         <span><i class="dot retry"></i>やり直しあり ${practiceResults.filter(r => r.outcome === 'retry').length}</span>
       </div>`;

  detailEl.innerHTML = legend + `<div class="result-chip-grid">${chips}</div>` +
    `<p class="chart-note">※数字は音程のズレ幅（セント）</p>`;
}

// 「中断」ボタンなどで練習を途中でやめるときの処理。
// マイク・メトロノーム・カウントダウンをすべて止め、設定画面に戻る
// （completePractice()と違い、履歴には保存しない）
function stopPractice() {
  activeSource.stop();
  isPracticing = false;
  if (tempoInterval) { clearInterval(tempoInterval); tempoInterval = null; }
  if (countTimer)    { clearInterval(countTimer);    countTimer = null; }
  clearMetronomeVisual();
  document.getElementById('setupCard').style.display    = 'block';
  document.getElementById('practiceCard').style.display = 'none';
  document.getElementById('completeCard').style.display = 'none';
  document.getElementById('countdown').style.display    = 'none';
  document.getElementById('metronomeBar').style.display = 'none';
}

// サーバーから返ってきた履歴1件を、画面下の履歴リストの先頭に追加する
// （練習完了直後、リスト全体を再取得しなくても即座に反映するため）
function addHistoryItem(entry) {
  const list  = document.getElementById('historyList');
  const empty = list.querySelector('.history-empty');
  if (empty) empty.remove();
  const li = document.createElement('li');
  const acc = entry.mode === 'tempo' ? `　正答率: ${entry.accuracy}%` : '';
  li.textContent = `${entry.time}　${entry.scale}（${entry.direction}）${acc}`;
  list.prepend(li);
}

// 選択中のプロフィールの練習履歴をサーバーから取得し、履歴リスト全体を描画し直す
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
// グラフ描画（統計タブ、Chart.js を使用）
// ===========================
const charts = { accuracy: null, daily: null, scale: null, notes: null, strings: null, compare: null }; // 描画済みのChartインスタンスを保持（再描画時に破棄するため）

// 【管理者用】全アカウントの練習回数・平均正答率・最終練習日を一覧表にし、
// 正答率をグラフでも比較できるようにする
async function renderCompareStats() {
  document.getElementById('compareCard').style.display = 'block';

  const rows = await getCompareStats();

  document.getElementById('compareTableBody').innerHTML = rows.map(r => `
    <tr>
      <td>${r.name}${r.role === 'admin' ? '<span class="compare-role-badge">管理者</span>' : ''}</td>
      <td>${r.count}</td>
      <td>${r.avg_accuracy != null ? r.avg_accuracy + '%' : '−'}</td>
      <td>${r.last_practiced_at || '−'}</td>
    </tr>
  `).join('');

  // 平均正答率が出せるのはテンポモードの記録があるアカウントだけなので、それだけを棒グラフにする
  const withAccuracy = rows.filter(r => r.avg_accuracy != null);
  document.getElementById('chartCompare').style.display      = withAccuracy.length > 0 ? 'block' : 'none';
  document.getElementById('chartCompareEmpty').style.display = withAccuracy.length > 0 ? 'none'  : 'block';

  charts.compare?.destroy();
  if (withAccuracy.length > 0) {
    const compareCtx = document.getElementById('chartCompare').getContext('2d');
    charts.compare = new Chart(compareCtx, {
      type: 'bar',
      data: {
        labels: withAccuracy.map(r => r.name),
        datasets: [{
          label: '平均正答率 (%)',
          data: withAccuracy.map(r => r.avg_accuracy),
          backgroundColor: 'rgba(232,196,104,0.75)',
          borderRadius: 6
        }]
      },
      options: chartOptions('正答率 (%)', 0, 100)
    });
  }
}

// 統計データをサーバーから取得し、「正答率の推移」「日別練習回数」「調ごとの正答率」
// 「苦手な音」「弦ごとの正答率」の5つのグラフを描画する（統計タブを開いたときに1回だけ呼ばれる）。
// 管理者の場合は、あわせて全アカウントの比較セクションも描画する
async function renderStats() {
  if (currentUser?.role === 'admin') await renderCompareStats();

  const data     = await getStats(currentProfileId);
  const noteData = await getNoteStats(currentProfileId);
  const daily    = [...data.daily].reverse();
  const scales   = data.by_scale;

  charts.accuracy?.destroy();
  charts.daily?.destroy();
  charts.scale?.destroy();
  charts.notes?.destroy();
  charts.strings?.destroy();

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

  // 調ごとの正答率（テンポモードのみ。理由はサーバー側のコメント参照）
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
  document.getElementById('chartScaleNote').style.display = scales.length > 0 ? 'block' : 'none';

  // 苦手な音（正答率が低い順。データが少ない音は対象外）
  const notes = noteData.by_note;
  document.getElementById('chartNotes').style.display      = notes.length > 0 ? 'block' : 'none';
  document.getElementById('chartNotesEmpty').style.display = notes.length > 0 ? 'none'  : 'block';
  if (notes.length > 0) {
    const notesCtx = document.getElementById('chartNotes').getContext('2d');
    charts.notes = new Chart(notesCtx, {
      type: 'bar',
      data: {
        labels: notes.map(n => n.note),
        datasets: [{
          label: '正答率 (%)',
          data: notes.map(n => n.accuracy),
          backgroundColor: 'rgba(214,137,16,0.75)',
          borderRadius: 6
        }]
      },
      options: chartOptions('正答率 (%)', 0, 100)
    });
  }

  // 弦ごとの正答率
  const strings = noteData.by_string;
  document.getElementById('chartStrings').style.display      = strings.length > 0 ? 'block' : 'none';
  document.getElementById('chartStringsEmpty').style.display = strings.length > 0 ? 'none'  : 'block';
  if (strings.length > 0) {
    const stringsCtx = document.getElementById('chartStrings').getContext('2d');
    charts.strings = new Chart(stringsCtx, {
      type: 'bar',
      data: {
        labels: strings.map(s => s.string),
        datasets: [{
          label: '正答率 (%)',
          data: strings.map(s => s.accuracy),
          backgroundColor: 'rgba(127,166,104,0.75)',
          borderRadius: 6
        }]
      },
      options: chartOptions('正答率 (%)', 0, 100)
    });
  }
}

// 3つのグラフ共通の見た目設定（色・軸ラベル・最小最大値など）をまとめて生成する
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
// タブ切り替え（「練習」タブと「統計」タブ）
// ===========================
let statsLoaded = false; // 統計タブを一度でも開いたか（毎回グラフを再取得しないようにするフラグ）
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
// イベント（設定画面のUI部品にリスナーを登録する）
// ===========================
// カテゴリーを変更したら、調セレクトの中身を作り直す
document.getElementById('categorySelect').addEventListener('change', populateScaleSelect);

// 調を選んだら「開始」ボタンを押せるようにする（未選択なら押せない）
document.getElementById('scaleSelect').addEventListener('change', (e) => {
  document.getElementById('startBtn').disabled = e.target.value === '';
});

// 「1音ずつ」/「テンポ」モードの切り替えで、BPM設定欄の表示・非表示を切り替える
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    document.getElementById('bpmGroup').style.display =
      e.target.value === 'tempo' ? 'block' : 'none';
  });
});

// BPMスライダーを動かしたら、隣に表示している数値も更新する
document.getElementById('bpmRange').addEventListener('input', (e) => {
  document.getElementById('bpmValue').textContent = e.target.value;
});

// デモモードの「ズレ幅」スライダーを動かしたら、隣に表示している数値も更新する
document.getElementById('demoOffsetCents').addEventListener('input', (e) => {
  document.getElementById('demoOffsetCentsValue').textContent = e.target.value;
});
document.getElementById('demoToneCents').addEventListener('input', (e) => {
  document.getElementById('demoToneCentsValue').textContent = e.target.value;
});

document.getElementById('startBtn').addEventListener('click', startPractice);
document.getElementById('stopBtn').addEventListener('click', stopPractice);

// 練習中の表示を「音符トラック」「指板」で切り替えるボタン
document.querySelectorAll('.view-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('noteStaff').style.display   = view === 'notes'       ? 'block' : 'none';
    document.getElementById('fingerboard').style.display = view === 'fingerboard' ? 'block' : 'none';
  });
});

// 完了画面の「もう一度」ボタンで設定画面に戻る
document.getElementById('retryBtn').addEventListener('click', () => {
  statsLoaded = false;
  document.getElementById('setupCard').style.display   = 'block';
  document.getElementById('completeCard').style.display = 'none';
});

// 完了画面の「もう一回練習」ボタンで、設定画面に戻らず同じ設定のまま練習をやり直す
document.getElementById('retryPracticeBtn').addEventListener('click', startPractice);

// 確認ダイアログを出したうえで、現在のプロフィールの履歴を全件削除する
async function clearAllHistory() {
  if (!confirm('履歴を全件削除しますか？')) return;
  await clearHistory(currentProfileId);
  document.getElementById('historyList').innerHTML =
    '<li class="history-empty">まだ履歴がありません</li>';
  if (statsLoaded) renderStats();
}

document.getElementById('clearStatsBtn').addEventListener('click', clearAllHistory);

// ===========================
// 認証（ログイン・新規登録・ログアウト）
// ===========================
let currentUser = null; // { id, name, role } ログイン中のアカウント
let isGuest     = false; // アカウントを作らず「ゲスト」として練習しているか（記録は一切保存しない）

function showLoginScreen() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appRoot').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
}

function showLoginError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.style.display = 'block';
}
function hideLoginErrors() {
  ['loginError', 'signupError', 'setupPasswordError', 'changePasswordError'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
}

// ログインフォーム／新規登録フォーム／初回パスワード設定フォームの切り替え
function showLoginSubForm(which) {
  hideLoginErrors();
  document.getElementById('loginForm').style.display         = which === 'login'  ? 'block' : 'none';
  document.getElementById('signupForm').style.display        = which === 'signup' ? 'block' : 'none';
  document.getElementById('setupPasswordForm').style.display = which === 'setup'  ? 'block' : 'none';
}

document.getElementById('showSignupBtn').addEventListener('click', () => showLoginSubForm('signup'));
document.getElementById('backToLoginBtn').addEventListener('click', () => showLoginSubForm('login'));
document.getElementById('setupPasswordBackBtn').addEventListener('click', () => showLoginSubForm('login'));

document.getElementById('loginBtn').addEventListener('click', async () => {
  hideLoginErrors();
  const name     = document.getElementById('loginName').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!name || !password) { showLoginError('loginError', '名前とパスワードを入力してください'); return; }
  try {
    const result = await login(name, password);
    if (result.needs_setup) {
      document.getElementById('setupPasswordName').textContent = result.name;
      document.getElementById('setupPassword').value = '';
      showLoginSubForm('setup');
      return;
    }
    currentUser = result;
    await onLoggedIn();
  } catch (err) {
    showLoginError('loginError', err.message);
  }
});

document.getElementById('setupPasswordBtn').addEventListener('click', async () => {
  hideLoginErrors();
  const name     = document.getElementById('setupPasswordName').textContent;
  const password = document.getElementById('setupPassword').value;
  try {
    currentUser = await setPassword(name, password);
    await onLoggedIn();
  } catch (err) {
    showLoginError('setupPasswordError', err.message);
  }
});

document.getElementById('signupBtn').addEventListener('click', async () => {
  hideLoginErrors();
  const name     = document.getElementById('signupName').value.trim();
  const password = document.getElementById('signupPassword').value;
  if (!name) { showLoginError('signupError', '名前を入力してください'); return; }
  try {
    currentUser = await createProfile(name, password);
    await onLoggedIn();
  } catch (err) {
    showLoginError('signupError', err.message);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (!isGuest) await logout(); // ゲストはサーバー側にセッションが無いのでログアウトAPIは呼ばない
  currentUser = null;
  currentProfileId = null;
  isGuest = false;
  document.getElementById('loginName').value = '';
  document.getElementById('loginPassword').value = '';
  showLoginSubForm('login');
  showLoginScreen();
});

// アプリ全体の設定（練習中の音符表示モード・結果画面の表示形式）をサーバーから読み込み、
// noteDisplayMode / resultDisplayMode に反映する。
// ゲストの画面にも反映する必要があるため、ログイン有無に関わらず呼ぶ
async function loadAppSettings() {
  const settings = await getSettings();
  noteDisplayMode = settings.note_display_mode === 'staff' ? 'staff' : 'chips';
  resultDisplayMode = ['score', 'both'].includes(settings.result_display_mode)
    ? settings.result_display_mode : 'accuracy';
}

// 管理者にだけ「練習画面の設定」カードを表示し、現在の設定をラジオボタンに反映する
function initNoteDisplaySetting() {
  const card = document.getElementById('noteDisplaySettingCard');
  if (!currentUser || currentUser.role !== 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.querySelectorAll('input[name="noteDisplaySetting"]').forEach(radio => {
    radio.checked = radio.value === noteDisplayMode;
  });
  document.querySelectorAll('input[name="resultDisplaySetting"]').forEach(radio => {
    radio.checked = radio.value === resultDisplayMode;
  });
}

// 管理者にだけ「デモモード」カードを表示する（練習設定画面）。
// デモモードの値はサーバーには保存せず、他のユーザーには一切影響しない、その場限りの設定
function initDemoModeUI() {
  document.getElementById('demoModeCard').style.display =
    (currentUser && currentUser.role === 'admin') ? 'block' : 'none';
}

// 管理者が音符の表示モードを切り替えたら、サーバーに保存する（反映は次回の練習開始時から）
document.querySelectorAll('input[name="noteDisplaySetting"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const errorEl = document.getElementById('noteDisplaySettingError');
    errorEl.style.display = 'none';
    try {
      await updateSettings({ note_display_mode: e.target.value });
      noteDisplayMode = e.target.value;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      initNoteDisplaySetting(); // 失敗したら選択状態を元に戻す
    }
  });
});

// 管理者が結果画面の表示形式を切り替えたら、サーバーに保存する（反映は次回の結果画面から）
document.querySelectorAll('input[name="resultDisplaySetting"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const errorEl = document.getElementById('resultDisplaySettingError');
    errorEl.style.display = 'none';
    try {
      await updateSettings({ result_display_mode: e.target.value });
      resultDisplayMode = e.target.value;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      initNoteDisplaySetting(); // 失敗したら選択状態を元に戻す
    }
  });
});

// ログイン成功直後の共通処理：アプリ本体を表示し、必要なデータを読み込む
async function onLoggedIn() {
  isGuest = false;
  resetGuestUI();
  currentProfileId = currentUser.id;
  showApp();
  renderAccountBar();
  await loadScales();
  await loadAppSettings();
  initNoteDisplaySetting();
  initDemoModeUI();
  await initProfileViewer();
  await renderHistory();
  statsLoaded = false;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'practice'));
  document.getElementById('tab-practice').style.display = 'block';
  document.getElementById('tab-stats').style.display    = 'none';
  renderFingerboardTicks();
}

// ヘッダーに、ログイン中の名前・管理者バッジを表示する
function renderAccountBar() {
  document.getElementById('profileName').textContent = currentUser.name;
  document.getElementById('roleBadge').textContent    = '管理者';
  document.getElementById('roleBadge').style.display  = currentUser.role === 'admin' ? 'inline-block' : 'none';
}

// ===========================
// ゲストモード（アカウントを作らずに練習だけ行う。記録は一切保存しない）
// ===========================
document.getElementById('guestBtn').addEventListener('click', async () => {
  isGuest = true;
  currentUser = null;
  currentProfileId = null;

  showApp();
  document.getElementById('profileName').textContent = '';
  document.getElementById('roleBadge').textContent   = 'ゲスト';
  document.getElementById('roleBadge').style.display = 'inline-block';
  document.getElementById('adminViewSelect').style.display = 'none';
  document.getElementById('logoutBtn').textContent = '🚪 ログイン画面に戻る';
  document.getElementById('logoutBtn').title = 'ログイン画面に戻る';
  document.getElementById('statsTabBtn').style.display  = 'none';
  document.getElementById('historySection').style.display = 'none';
  document.getElementById('guestNote').style.display = 'block';

  await loadScales();
  await loadAppSettings();
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'practice'));
  document.getElementById('tab-practice').style.display = 'block';
  document.getElementById('tab-stats').style.display    = 'none';
  renderFingerboardTicks();
});

// ゲストモード用に変えていたヘッダー・タブの表示を、通常ログイン用に戻す
function resetGuestUI() {
  document.getElementById('roleBadge').textContent = '管理者';
  document.getElementById('logoutBtn').textContent = '🚪 ログアウト';
  document.getElementById('logoutBtn').title = 'ログアウト';
  document.getElementById('statsTabBtn').style.display   = '';
  document.getElementById('historySection').style.display = '';
  document.getElementById('guestNote').style.display = 'none';
}

// ===========================
// プロフィール閲覧（管理者は他のアカウントのデータも選んで見られる）
// ===========================
// 管理者用：全アカウント分のセレクトボックスを用意する（一般ユーザーには表示しない）
async function initProfileViewer() {
  const select = document.getElementById('adminViewSelect');
  if (currentUser.role !== 'admin') {
    select.style.display = 'none';
    return;
  }
  const profiles = await getProfiles();
  select.innerHTML = profiles.map(p =>
    `<option value="${p.id}" ${p.id === currentProfileId ? 'selected' : ''}>${p.name}${p.role === 'admin' ? '（管理者）' : ''}</option>`
  ).join('');
  select.style.display = 'inline-block';
}

// 管理者が閲覧先のアカウントを切り替えたら、履歴・統計を読み込み直す
// （自分の練習記録は常に自分のアカウントに保存されるため、これは「閲覧」だけに影響する）
document.getElementById('adminViewSelect').addEventListener('change', async (e) => {
  currentProfileId = parseInt(e.target.value, 10);
  await renderHistory();
  if (statsLoaded) await renderStats();
});

// ===========================
// アカウント設定（パスワード変更・アカウント削除）
// ===========================
document.getElementById('showChangePasswordBtn').addEventListener('click', () => {
  document.getElementById('changePasswordForm').style.display = 'block';
});

document.getElementById('submitChangePasswordBtn').addEventListener('click', async () => {
  hideLoginErrors();
  const current = document.getElementById('currentPasswordInput').value;
  const next    = document.getElementById('newPasswordInput').value;
  try {
    await changePassword(current, next);
    document.getElementById('currentPasswordInput').value = '';
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('changePasswordForm').style.display = 'none';
    alert('パスワードを変更しました');
  } catch (err) {
    showLoginError('changePasswordError', err.message);
  }
});

// 自分のアカウントを（練習履歴ごと）削除してログアウトする
document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
  if (!confirm(`アカウント「${currentUser.name}」と、その練習履歴をすべて削除しますか？この操作は取り消せません。`)) return;
  try {
    await deleteProfile(currentUser.id);
    currentUser = null;
    currentProfileId = null;
    showLoginSubForm('login');
    showLoginScreen();
  } catch (err) {
    alert(err.message);
  }
});

// ===========================
// 初期化（ファイル読み込み時に実行される）
// ===========================
(async function bootstrap() {
  const me = await getMe();
  if (me) {
    currentUser = me;
    await onLoggedIn();
  } else {
    showLoginScreen();
  }
})();


//442hz