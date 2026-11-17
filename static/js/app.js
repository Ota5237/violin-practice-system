// マイクの音を拾って周波数（Hz）を判定してくれるオブジェクト（pitch.js で定義）
const detector = new PitchDetector();

// デモモード用：マイクの代わりに、指定した条件で自動的に「弾いた音」をシミュレートするオブジェクト。
// PitchDetectorと同じ start(onPitchDetected) / stop() インターフェースを持たせることで、
// テンポモード側のコードを一切変えずに、本物のdetectorと差し替えて使えるようにしている。
class DemoPitchSource {
  constructor({ offsetCents = 0, jitterCents = 0, silenceChance = 0, accuracyRate = 100 } = {}) {
    this.offsetCents   = offsetCents;
    this.jitterCents   = Math.max(0, jitterCents);
    this.silenceChance = Math.min(100, Math.max(0, silenceChance));
    this.accuracyRate  = Math.min(100, Math.max(0, accuracyRate));
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

      // 正答率：この割合だけ「ズレ幅・ばらつき」どおりの音にし、残りは「惜しい」の許容誤差
      // （closeCents）を確実に超える大きなズレにして、不正解（×）になるようにする
      let cents;
      if (Math.random() * 100 < this.accuracyRate) {
        const jitter = this.jitterCents > 0 ? (Math.random() * 2 - 1) * this.jitterCents : 0;
        cents = this.offsetCents + jitter;
      } else {
        const missSign = Math.random() < 0.5 ? -1 : 1;
        cents = missSign * (closeCents + 50 + Math.random() * 50);
      }

      const freq = noteData.freq * Math.pow(2, cents / 1200);
      onPitchDetected(freq);
    }, 50);
  }

  stop() {
    clearInterval(this.timerId);
    this.timerId = null;
  }
}

// 検証モードの「デモで体験する」用に、現在「デモ」タブで設定されているズレ幅・ばらつき・
// 無音確率・正答率を使ったDemoPitchSourceを組み立てる（設定自体は「デモ」タブのスライダーと共通）
function createVerifyModeDemoSource() {
  return new DemoPitchSource({
    offsetCents:   parseFloat(document.getElementById('demoOffsetCents').value) || 0,
    jitterCents:   parseFloat(document.getElementById('demoJitterCents').value) || 0,
    silenceChance: parseFloat(document.getElementById('demoSilenceChance').value) || 0,
    accuracyRate:  getDemoAccuracyRateValue(),
  });
}

// 「正答率」スライダーの現在値を取得する（0は有効な値なので || は使わない）
function getDemoAccuracyRateValue() {
  const value = parseFloat(document.getElementById('demoAccuracyRate').value);
  return Number.isFinite(value) ? value : 100;
}

let activeSource = detector; // 実際に使うピッチ検出ソース（通常はdetector、デモモード時はDemoPitchSourceに差し替える）
let scalesData      = {}; // notes.json / 各音階ファイルを読み込んだ結果をまとめて保持する
let practiceNotes   = []; // 今回の練習で弾く音の並び（startPractice()で組み立てる）
let currentIndex    = 0;  // practiceNotes のうち、今どの音を練習中か
let isPracticing    = false; // 今マイクの判定結果を受け付けてよいか（判定中の二重反応を防ぐ）
let currentProfileId = null; // 選択中のプロフィール（ユーザー）のID
let resultDisplayMode = 'accuracy'; // 結果画面の表示：'accuracy'=正答率／'score'=カラオケ風の点数／'both'=両方（管理者が設定を切り替える）
let isDemoRun = false; // 今進行中の練習が「デモ開始」から始まったものかどうか（記録の保存要否・もう一回の挙動を分けるのに使う）
let signupEnabled = 'yes'; // ログイン画面から新規アカウント作成を許可するか：'yes'/'no'（管理者が設定を切り替える）
let stepHoldGeneral = 'no'; // 管理者以外のアカウントにも1音ずつモードの「保持判定」を適用するか：'yes'/'no'（管理者が設定を切り替える）
let passThreshold = 80; // 被験者アカウントのテンポ練習の合格基準（100点満点中の点数。管理者が設定を切り替える）
let correctCents = 15; // 「正解」と判定する音程のズレ幅（セント以内）。1音ずつ・テンポ・点数計算すべてで使う（管理者が設定を切り替える）
let closeCents   = 35; // 「惜しい」と判定する音程のズレ幅（セント以内）。これを超えたら「ズレ大」（管理者が設定を切り替える）
let verifyModeDirection = 'up'; // 検証モード（管理者が自分で被験者フローを体験するとき）の練習タイプ。設定タブで変更する
let verifyModeBpm       = 60;   // 検証モードのテンポ。設定タブで変更する
let verifyModeStepHold     = 'instant'; // 検証モードで1音ずつ練習になったときの正解判定方式。設定タブで変更する
let verifyModeSaveHistory  = 'yes';     // 検証モードの結果を記録に残すか。設定タブで変更する
let verifyModeScaleSteps   = [];        // 検証モードで使う音階（[]なら未設定＝自動選択）。設定タブで変更する
let verifyModeDemoMode     = false;     // 検証モードを「デモで体験する」から始めた場合true。マイクの代わりにDemoPitchSourceを使う
let verifyModeContinueAction = null; // 検証モードの結果画面で「確認して次へ」を押したときに実行する処理
let verifyModeClearedStages = new Set(); // 検証モードで今回合格済みのステージ番号（0始まり）。保存はせず、その場限り

// 被験者アカウント用の「決まった練習」プロトコル
// （音階ごとに 事前演奏（baseline）→自由練習（practice）→テスト演奏（test） を、
//  テストに合格するまで practice⇔test を繰り返し、合格したら次の音階のbaselineへ進む）
let subjectProtocolActive = false; // 今ログイン中のアカウントがこのプロトコルの対象か
let adminExperiencing     = false; // 管理者が「自分で体験する」でこのプロトコルを一時的に試している最中か
let subjectAutoAdvanceTimer = null; // プロトコルの自動進行（次のフェーズへのsetTimeout）ID。中断時に解除するため保持
const SUBJECT_ROADMAP_LENGTH = 16; // 被験者ステップ数（4音階・2ペア×4日×2音階。サーバー側のSUBJECT_ROADMAP_LENGTHと合わせる）
let subjectRoadmapSteps = []; // ロードマップの各ステップ { step_order, category_key, scale_id, direction, bpm }
let subjectRoadmapIndex = 0;  // 現在挑戦中のステップ（0始まり）
let subjectStagePhase   = 'baseline'; // 今のステップ内のフェーズ：'baseline'（事前演奏）｜'practice'（自由練習）｜'test'（テスト演奏）
let subjectLastWrongEntries = []; // 直前のテスト演奏で×・△だった音（「苦手な音を練習する」用。ページ遷移やログインのたびにリセットされる）

// テンポモード用
let tempoInterval  = null; // メトロノームのsetInterval ID（stopPractice等で止めるために保持）
let countTimer     = null; // 開始前カウントダウンのsetInterval ID
let notesCorrect   = 0;    // 今回の練習で正解した音の数（正答率の計算に使う）
let detectedFreqNow = null; // テンポモードで「直近に検出できた周波数」を一時保存しておく変数
let practiceResults = []; // 結果画面の詳細表示用：今回の練習で音ごとに何が起きたかの記録
let currentNoteMissed = false; // 1音ずつモードで、今の音を一発で取れず「惜しい/ズレ大」を経由したか
let showCurrentGlow = true; // 音符トラックの「今弾く音」の光り方を出すかどうか（テンポモードのカウントダウン中はfalseにする）

// 1音ずつモード「保持判定」（管理者用の追加機能）
// 一瞬正解範囲に入っただけで次に進むのではなく、STEP_HOLD_REQUIRED_MS分だけ
// 正解範囲を保持できたら正解とする。ただしマイク入力は一瞬途切れる/ノイズが乗ることがあるため、
// STEP_HOLD_GRACE_MS以内の短い途切れ（無音でコールバック自体が来ない間）は積算を止めずに許容する。
// はっきり音程を外した判定が来た場合はその場で積算をリセットする。
const STEP_HOLD_REQUIRED_MS = 1000;
const STEP_HOLD_GRACE_MS    = 250;
let stepHoldModeOn   = false; // 今回の練習で保持判定モードが有効か（startStepMode()で確定する）
let stepHoldMs       = 0;     // 正解範囲に入っていた時間の積算(ms)
let stepHoldLastTime = null;  // 直近に判定コールバックを処理した時刻(performance.now())

// ===== 音階データ読み込み =====
// ページ読み込み時に音階データ一式（音名→周波数の対応表 notes.json と、
// DBに登録済みの音階一覧 /api/scales）をまとめて取得し、scalesData に格納する。
// 完了したらセレクトボックスと指板の目印を描画する。
async function loadScales() {
  const [notesRes, scalesRes] = await Promise.all([
    fetch('/static/data/notes.json'),
    fetch('/api/scales'),
  ]);

  const notes = await notesRes.json();
  const { categories } = await scalesRes.json();

  scalesData = { notes, categories };
  populateScaleSelect();
  populateDemoScaleSelect();
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
// 指定したカテゴリーキーに属する音階一覧（{キー: 音階データ} の形）を返す
function getScalesForCategory(categoryKey) {
  return scalesData.categories?.[categoryKey]?.scales || {};
}

// 「カテゴリー」セレクトボックス（第1ポジションなど）で今選ばれているキーを返す（練習タブ用）
function getCurrentCategoryKey() {
  return document.getElementById('categorySelect').value;
}

// 練習タブで現在選択中のカテゴリーに属する音階一覧を返す
function getCurrentScales() {
  return getScalesForCategory(getCurrentCategoryKey());
}

// 「調」セレクトボックスの中身を、現在のカテゴリーの音階一覧で作り直す
// （カテゴリーを切り替えたときに呼ばれる。練習タブ用）
function populateScaleSelect() {
  const scales     = getCurrentScales();
  const scaleSelect = document.getElementById('scaleSelect');
  const keys        = Object.keys(scales);

  scaleSelect.innerHTML = '<option value="">-- 選択してください --</option>' +
    keys.map(key => `<option value="${key}">${scales[key].name}</option>`).join('');

  document.getElementById('startBtn').disabled = true;
}

// デモタブの「調」セレクトボックスの中身を、デモタブの「カテゴリー」で選ばれている音階一覧で作り直す。
// 練習タブとは別の入り口として独立させてあるため、専用のセレクトを持つ
function populateDemoScaleSelect() {
  const categoryKey = document.getElementById('demoCategorySelect').value;
  const scales      = getScalesForCategory(categoryKey);
  const scaleSelect = document.getElementById('demoScaleSelect');
  const keys        = Object.keys(scales);

  scaleSelect.innerHTML = '<option value="">-- 選択してください --</option>' +
    keys.map(key => `<option value="${key}">${scales[key].name}</option>`).join('');

  document.getElementById('startDemoBtn').disabled = true;
}

// 音階の音リストを 上行/下行/上下 に分割する。
// notes 配列内の1音に "turn": true を付けると、そこが折り返し地点（頂点）として
// 上行と下行の境目に使われ、上下モードでも頂点の音が1回しか出てこなくなる。
// 頂点の音を2つ以上続けて入力している（同じ最高音を2回弾く等）場合は、そのすべてに
// turn を付けてよい：最初のtrueまでを上行、最後のtrueからを下行とすることで、
// 上行・下行それぞれでは頂点が1回だけになる（上下＝そのまま全部が頂点の重複を含む）。
// turn がどこにも無い場合は notes を上行として扱い、下行はその逆順（頂点の重複は自動で除去）とする。
function splitScaleNotes(scale) {
  const notes = scale.notes;
  const turnIndices = notes.reduce((acc, n, i) => { if (n.turn) acc.push(i); return acc; }, []);

  if (turnIndices.length === 0) {
    const down = [...notes].reverse();
    return { up: notes, down, updown: [...notes, ...down.slice(1)] };
  }

  const firstTurn = turnIndices[0];
  const lastTurn  = turnIndices[turnIndices.length - 1];

  return {
    up:     notes.slice(0, firstTurn + 1),
    down:   notes.slice(lastTurn),
    updown: notes
  };
}

// 被験者練習画面の五線譜トグル状態
let _staffShowFingers = false;
let _staffShowAccidentals = false;

function renderSubjectStaff() {
  const el = document.getElementById('subjectStaffInner');
  if (!el || !window._currentStaffNotes) return;
  el.innerHTML = buildStaffSVG(
    window._currentStaffNotes,
    window._currentStaffColor,
    window._currentStaffKeySig,
    { showFingers: _staffShowFingers, showAllAccidentals: _staffShowAccidentals }
  );
}

document.addEventListener('DOMContentLoaded', () => {
  const fingerBtn = document.getElementById('staffFingerToggle');
  const accBtn    = document.getElementById('staffAccToggle');
  if (fingerBtn) fingerBtn.addEventListener('click', () => {
    _staffShowFingers = !_staffShowFingers;
    fingerBtn.classList.toggle('active', _staffShowFingers);
    renderSubjectStaff();
  });
  if (accBtn) accBtn.addEventListener('click', () => {
    _staffShowAccidentals = !_staffShowAccidentals;
    accBtn.classList.toggle('active', _staffShowAccidentals);
    renderSubjectStaff();
  });

  // 練習中の楽譜トグル（同じグローバル変数を使って練習中五線譜にも反映）
  const pracFingerBtn = document.getElementById('practiceFingerToggle');
  const pracAccBtn    = document.getElementById('practiceAccToggle');
  if (pracFingerBtn) pracFingerBtn.addEventListener('click', () => {
    _staffShowFingers = !_staffShowFingers;
    pracFingerBtn.classList.toggle('active', _staffShowFingers);
    renderNoteTrackStaff();
  });
  if (pracAccBtn) pracAccBtn.addEventListener('click', () => {
    _staffShowAccidentals = !_staffShowAccidentals;
    pracAccBtn.classList.toggle('active', _staffShowAccidentals);
    renderNoteTrackStaff();
  });
});

// カテゴリー・調・練習タイプ（direction）から、今回弾く音の並びを組み立てる。
// 通常の練習開始（startPractice）とデモ開始（startDemo）の両方から使う共通処理
function buildPracticeNotes(categoryKey, scaleKey, direction) {
  const scale = getScalesForCategory(categoryKey)[scaleKey];
  const { up, down, updown } = splitScaleNotes(scale);
  if (direction === 'up')       return up;
  if (direction === 'down')     return down;
  if (direction === 'updown')   return updown;
  if (direction === 'arpeggio') return [...scale.arpeggio];
}

// ===== 練習開始（マイクを使った通常の練習） =====
// 「開始」ボタンで呼ばれる。フォームの選択内容（音階・方向・モード）を読み取り、
// 練習する音の並び(practiceNotes)を組み立ててから、モードに応じて
// startStepMode() か startTempoMode() を開始する。
function startPractice() {
  const scaleKey  = document.getElementById('scaleSelect').value;
  const direction = document.querySelector('input[name="direction"]:checked').value;
  const mode      = document.querySelector('input[name="mode"]:checked').value;

  practiceNotes = buildPracticeNotes(getCurrentCategoryKey(), scaleKey, direction);

  currentIndex = 0;
  notesCorrect = 0;
  practiceResults = [];
  currentNoteMissed = false;
  showCurrentGlow = true; // 1音ずつモードは最初から光らせる。テンポモードはstartTempoMode()内で制御する
  // 通常は常に実マイクを使う。検証モードを「デモで体験する」から始めた場合だけ、
  // マイクの代わりにDemoPitchSource（デモタブと同じシミュレート音）を使う
  activeSource = (adminExperiencing && verifyModeDemoMode) ? createVerifyModeDemoSource() : detector;
  isDemoRun = false;

  document.getElementById('setupCard').style.display    = 'none';
  document.getElementById('practiceCard').style.display = 'block';
  document.getElementById('completeCard').style.display = 'none';
  updateSubjectSkipControls(); // 検証モードなら、練習中の画面にもスキップ操作を出す

  // アプリ練習ありのときだけ練習中の楽譜トグルを表示し、プロトコル画面と同期
  const pracOptsRow = document.getElementById('practiceStaffOptsRow');
  if (pracOptsRow) {
    pracOptsRow.style.display = window._currentStaffWithPrac ? '' : 'none';
    if (window._currentStaffWithPrac) {
      const pf = document.getElementById('practiceFingerToggle');
      const pa = document.getElementById('practiceAccToggle');
      if (pf) pf.classList.toggle('active', _staffShowFingers);
      if (pa) pa.classList.toggle('active', _staffShowAccidentals);
    }
  }

  const bpmText = document.getElementById('bpmRange').value;
  const badge   = document.getElementById('modeBadge');
  badge.textContent = subjectProtocolBadgePrefix() + (
    mode === 'step'      ? '🎯 1音ずつモード' :
    mode === 'listening' ? `🎧 リスニングモード ${bpmText} BPM` :
    `🥁 テンポモード ${bpmText} BPM`
  );

  renderNoteTrack();

  if (mode === 'step') {
    startStepMode();
  } else {
    // テンポ・リスニングモードは、練習画面を表示した時点ではまだカウントダウンを始めない。
    // 「▶ 開始する」ボタンを押してもらい、さらに一拍ほど間を置いてからカウントダウンを始める
    // （ボタンを押した瞬間にいきなりカウントダウンが始まらないようにするため）
    showCurrentGlow = false; // カウントダウン前は「今弾く音」を光らせない
    showCurrentNote();
    showBeginCountdownBtn(mode === 'listening' ? startListeningMode : startTempoMode);
  }
}

// 「▶ 開始する」ボタンを表示し、押されたときに実行する処理（カウントダウンを始める関数）を覚えておく
let beginCountdownAction     = null; // 「開始する」ボタンを押したときに呼ぶ関数
let beginCountdownDelayTimer = null; // 「開始する」を押してから一拍待つ間のsetTimeout ID（中断時に解除するため保持）

function showBeginCountdownBtn(action) {
  beginCountdownAction = action;
  document.getElementById('beginCountdownBtn').style.display = 'block';
}

document.getElementById('beginCountdownBtn').addEventListener('click', () => {
  document.getElementById('beginCountdownBtn').style.display = 'none';
  const action = beginCountdownAction;
  beginCountdownAction = null;
  if (!action) return;

  // ボタンを押してすぐにカウントダウンを始めるのではなく、一拍ぶん（今のテンポの1拍分）だけ間を置く
  const bpm    = parseInt(document.getElementById('bpmRange').value);
  const beatMs = (60 / bpm) * 1000;
  beginCountdownDelayTimer = setTimeout(() => {
    beginCountdownDelayTimer = null;
    action();
  }, beatMs);
});

// ===== デモ開始（管理者用。マイクの代わりにシミュレートしたピッチ源でテンポモードを実行する） =====
// 「デモ開始」ボタンで呼ばれる。カテゴリー・調・練習タイプはデモタブ自身のセレクトを使う
// （練習タブとは別の入り口として独立させてあるため）
function startDemo() {
  const categoryKey = document.getElementById('demoCategorySelect').value;
  const scaleKey     = document.getElementById('demoScaleSelect').value;
  const direction    = document.querySelector('input[name="demoDirection"]:checked').value;

  practiceNotes = buildPracticeNotes(categoryKey, scaleKey, direction);

  currentIndex = 0;
  notesCorrect = 0;
  practiceResults = [];
  currentNoteMissed = false;
  activeSource = new DemoPitchSource({
    offsetCents:   parseFloat(document.getElementById('demoOffsetCents').value) || 0,
    jitterCents:   parseFloat(document.getElementById('demoJitterCents').value) || 0,
    silenceChance: parseFloat(document.getElementById('demoSilenceChance').value) || 0,
    accuracyRate:  getDemoAccuracyRateValue(),
  });
  isDemoRun = true;

  switchTab('practice'); // 練習画面(#practiceCard)は「練習」タブの中にあるため、デモタブから開始したらそちらに戻る
  document.getElementById('setupCard').style.display    = 'none';
  document.getElementById('practiceCard').style.display = 'block';
  document.getElementById('completeCard').style.display = 'none';

  const demoBpm = document.getElementById('demoBpmRange').value;
  document.getElementById('modeBadge').textContent = `🎬 デモ・テンポモード ${demoBpm} BPM`;

  renderNoteTrack();
  startTempoMode(parseInt(demoBpm));
}

// ===========================
// 1音ずつモード
// （正しい音程が取れるまで待ち、正解したら次の音へ進むモード）
// ===========================
// マイクを起動し、判定コールバックを登録して1音ずつモードを開始する
function startStepMode() {
  isPracticing = true;
  // 検証モード中は、設定タブの検証モード設定（verifyModeStepHold）に従う。
  // 管理者が自分で練習している場合は、自分のラジオボタンでその場限りに判定方式を切り替えられる。
  // 管理者以外（一般ユーザー・ゲスト）は、管理者が設定タブで選んだ
  // 「1音ずつモードの正解判定」（stepHoldGeneral）の設定に従う
  const isAdminPracticing = currentUser && currentUser.role === 'admin';
  stepHoldModeOn = adminExperiencing
    ? verifyModeStepHold === 'hold'
    : isAdminPracticing
      ? document.querySelector('input[name="stepHoldMode"]:checked')?.value === 'hold'
      : stepHoldGeneral === 'yes';
  showCurrentNote();
  activeSource = detector; // デモモードは今のところテンポモードのみ対応。念のため実マイクに戻しておく

  // detector から継続的に周波数(freq)が渡ってくるので、都度判定する
  activeSource.start((freq) => {
    if (!isPracticing) return; // 正解直後など、次の音に進む間は判定を無視する
    onPitchDetectedStep(freq);
  });
}

// 正解が確定したときの共通処理（瞬間判定・保持判定のどちらからも呼ばれる）
function markStepNoteCorrect(entry, cents) {
  const statusEl = document.getElementById('resultStatus');
  statusEl.textContent = '✅ 正解！';
  statusEl.className   = 'result-status correct';
  notesCorrect++;
  practiceResults.push({ note: entry.note, string: entry.string, outcome: currentNoteMissed ? 'retry' : 'correct', cents });
  isPracticing = false; // 次の音に切り替わるまで、それ以上の判定を止める
  hideStepHoldMeter();
  setTimeout(nextNote, 800); // 正解表示を一瞬見せてから次の音へ
}

// 検出された周波数を「今弾くべき音」の正しい周波数と比較し、結果を画面に表示する。
// 音程のズレは半音を100分割した単位「セント」で評価する
// （±correctCentsセント以内なら正解、±closeCentsセント以内なら惜しい、それ以上はズレ大。
//  いずれも管理者が設定タブで変更できる）。
function onPitchDetectedStep(freq) {
  const entry    = practiceNotes[currentIndex];
  const noteData = scalesData.notes[entry.note];
  document.getElementById('resultFreq').textContent = `周波数: ${freq.toFixed(1)} Hz`;

  const cents    = 1200 * Math.log2(freq / noteData.freq); // 正の値=高すぎ、負の値=低すぎ
  const absCents = Math.abs(cents);
  const statusEl = document.getElementById('resultStatus');

  if (absCents <= correctCents) {
    if (!stepHoldModeOn) {
      markStepNoteCorrect(entry, cents);
      return;
    }
    // 保持判定：正解範囲に入っていた時間を積算する。マイクの一瞬の途切れ（無音でコールバックが
    // 来ない間）はSTEP_HOLD_GRACE_MS以内ならリセットせず、途切れなく弾き続けたものとして扱う
    const now   = performance.now();
    const delta = (stepHoldLastTime !== null && now - stepHoldLastTime < STEP_HOLD_GRACE_MS)
      ? now - stepHoldLastTime : 0;
    stepHoldMs += delta;
    stepHoldLastTime = now;

    const progress = Math.min(1, stepHoldMs / STEP_HOLD_REQUIRED_MS);
    statusEl.textContent = `🎯 保持中…${Math.round(progress * 100)}%`;
    statusEl.className   = 'result-status holding';
    updateStepHoldMeter(progress);

    if (stepHoldMs >= STEP_HOLD_REQUIRED_MS) {
      markStepNoteCorrect(entry, cents);
    }
  } else if (absCents <= closeCents) {
    stepHoldMs = 0; stepHoldLastTime = null;
    hideStepHoldMeter();
    statusEl.textContent = cents > 0 ? '▲ 少し高い' : '▼ 少し低い';
    statusEl.className   = 'result-status close';
    currentNoteMissed = true;
  } else {
    stepHoldMs = 0; stepHoldLastTime = null;
    hideStepHoldMeter();
    statusEl.textContent = cents > 0 ? '高すぎ ▲' : '低すぎ ▼';
    statusEl.className   = 'result-status wrong';
    currentNoteMissed = true;
  }
}

// 保持判定モードの進捗バーを表示・更新する（progressは0〜1）
function updateStepHoldMeter(progress) {
  const meter = document.getElementById('stepHoldMeter');
  const fill  = document.getElementById('stepHoldMeterFill');
  if (!meter || !fill) return;
  meter.style.display = 'block';
  fill.style.width = `${Math.round(progress * 100)}%`;
}

function hideStepHoldMeter() {
  const meter = document.getElementById('stepHoldMeter');
  const fill  = document.getElementById('stepHoldMeterFill');
  if (!meter || !fill) return;
  meter.style.display = 'none';
  fill.style.width = '0%';
}

// ===========================
// テンポモード
// （メトロノームに合わせて、一定のテンポで次々と音を弾いていくモード。
//  正解を待たずに拍ごとに強制的に次の音へ進む）
// ===========================
// BPM（1分間の拍数）からメトロノームの間隔を計算し、
// カウントダウン→本番のメトロノーム開始、という流れを組み立てる。
// bpmOverride が渡された場合はそちらを使う（デモ開始時、デモ側のBPM設定を使うため）
function startTempoMode(bpmOverride) {
  const bpm      = bpmOverride ?? parseInt(document.getElementById('bpmRange').value);
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

  // activeSource は呼び出し元（startPractice / startDemo）が事前に設定済み
  // （実マイクかデモのシミュレート音か、ここでは判断しない）

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

// ===========================
// リスニングモード
// （マイクは使わず、選んだ音階の正しい音を、テンポに合わせて順番に鳴らして聴くだけのモード。
//  判定は行わないため、練習記録にも保存しない）
// ===========================
let listeningTimer = null; // 次の音を鳴らすsetTimeout ID（stopPractice等で止めるために保持）

// リスニングモード中だけ、楽譜（音符トラック）を横にドラッグ／スワイプして自由に音を選び、
// 「🔊 音を出す」ボタンでその音だけを自分のタイミングで鳴らせるようにする機能。
// テンポに合わせた自動再生とは別の、確認用の手動操作なので、ドラッグを始めたら自動再生は止める
let listeningManualCheckActive = false; // リスニングモードの最中（開始〜終了・中断まで）true
let listeningDragState = null; // ドラッグ中だけ{ startX, startIndex }を持つ。ドラッグしていなければnull

function startListeningMode() {
  const bpm      = parseInt(document.getElementById('bpmRange').value);
  const interval = (60 / bpm) * 1000;
  let countdown  = 3;

  isPracticing = false; // マイクを使わないので、判定（正解/不正解）は行わない
  currentIndex = 0;
  showCurrentGlow = false; // カウントダウン中は「今弾く音」を光らせない。再生が始まる瞬間に光るようにする
  showCurrentNote();

  listeningManualCheckActive = true;
  document.getElementById('listeningManualHint').style.display  = 'block';
  document.getElementById('listeningPlayNoteBtn').style.display  = 'block';

  const playNext = () => {
    if (currentIndex >= practiceNotes.length) {
      completePractice();
      return;
    }
    showCurrentNote();
    const noteData = scalesData.notes[practiceNotes[currentIndex].note];
    playListeningTone(noteData.freq, (interval / 1000) * 0.85); // 次の音と少し間が空くよう、拍の長さより短めに鳴らす

    listeningTimer = setTimeout(() => {
      currentIndex++;
      playNext();
    }, interval);
  };

  // カウントダウン（3・2・1と数えて、本番の再生を始める。テンポモードと同じ仕組み）
  const countdownEl = document.getElementById('countdown');
  countdownEl.style.display = 'block';
  countdownEl.textContent = countdown;
  playClick(true); // 「3」の合図

  countTimer = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      countdownEl.textContent = countdown;
      playClick(true);
    } else {
      clearInterval(countTimer);
      countTimer = null;
      countdownEl.style.display = 'none';
      showCurrentGlow = true; // ここで初めて「今弾く音」を光らせる
      playNext();
    }
  }, interval);
}

// リスニングモード用：指定した周波数の音を、指定した長さ(秒)だけ鳴らす（音源はセント調整デモと同じ正弦波）
function playListeningTone(freq, durationSec) {
  try {
    const ctx  = getClickAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;

    const now      = ctx.currentTime;
    const fadeOutAt = Math.max(now + 0.03, now + durationSec - 0.05);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.03);
    gain.gain.setValueAtTime(0.3, fadeOutAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.start(now);
    osc.stop(now + durationSec);
  } catch (e) {}
}

// リスニングモードの楽譜（#noteStaff）を横にドラッグ／スワイプしたときの処理。
// 自動再生中にドラッグを始めたら、自動再生（テンポに合わせた順番再生）は止めて手動操作に切り替える。
// スロット幅ぶん動かすごとに1音分currentIndexを進め／戻し、プレイヘッドに合う音を切り替える
function listeningDragPointerDown(e) {
  if (!listeningManualCheckActive || practiceNotes.length === 0) return;
  if (listeningTimer) { clearTimeout(listeningTimer); listeningTimer = null; }
  if (countTimer) {
    clearInterval(countTimer);
    countTimer = null;
    document.getElementById('countdown').style.display = 'none';
  }
  showCurrentGlow = true;
  listeningDragState = { startX: e.clientX, startIndex: currentIndex };
  const noteStaffEl = document.getElementById('noteStaff');
  if (noteStaffEl.setPointerCapture) {
    try { noteStaffEl.setPointerCapture(e.pointerId); } catch (err) {}
  }
}

function listeningDragPointerMove(e) {
  if (!listeningDragState) return;
  const { slot } = noteTrackMetrics();
  const deltaX = e.clientX - listeningDragState.startX;
  const indexDelta = Math.round(-deltaX / slot);
  const newIndex = Math.max(0, Math.min(practiceNotes.length - 1, listeningDragState.startIndex + indexDelta));
  if (newIndex !== currentIndex) {
    currentIndex = newIndex;
    showCurrentNote(false);
  }
}

function listeningDragPointerUp() {
  listeningDragState = null;
}

document.getElementById('noteStaff').addEventListener('pointerdown', listeningDragPointerDown);
document.getElementById('noteStaff').addEventListener('pointermove', listeningDragPointerMove);
document.getElementById('noteStaff').addEventListener('pointerup', listeningDragPointerUp);
document.getElementById('noteStaff').addEventListener('pointercancel', listeningDragPointerUp);

// 「🔊 音を出す」ボタン：今プレイヘッドに合っている音（currentIndex）だけを鳴らして確認する
document.getElementById('listeningPlayNoteBtn').addEventListener('click', () => {
  if (!listeningManualCheckActive || currentIndex >= practiceNotes.length) return;
  const noteData = scalesData.notes[practiceNotes[currentIndex].note];
  playListeningTone(noteData.freq, 1.0);
});

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
    if (Math.abs(cents) <= correctCents) {
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
  stepHoldMs = 0;
  stepHoldLastTime = null;
  hideStepHoldMeter();
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
      circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', 8.5);
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

// #noteStaff の中身を、五線譜のSVGに作り直す
function renderNoteStaffContainer() {
  const container = document.getElementById('noteStaff');
  container.innerHTML = `
    <svg class="staff-svg" id="staffSvg" viewBox="0 0 460 140" preserveAspectRatio="none">
      <g id="staffLines"></g>
      <text class="staff-clef" x="6" y="98">𝄞</text>
      <g class="note-track" id="noteTrack"></g>
    </svg>
    <div class="note-playhead"></div>`;
}

// practiceNotes 全体分の音符を横一列に並べて描画する（曲が始まるとき・画面サイズが変わったときに呼ばれる）。
function renderNoteTrack() {
  renderNoteStaffContainer();
  renderNoteTrackStaff();
}

// 【五線譜表示】音符を、五線譜上の正しい高さに配置する
function renderNoteTrackStaff() {
  const track = document.getElementById('noteTrack');
  const { slot, width } = noteTrackMetrics();

  document.getElementById('staffSvg').setAttribute('viewBox', `0 0 ${width} ${STAFF_HEIGHT}`);
  renderStaffLines(width);

  // 指番号用：全音符の最高ステップから固定 y を計算
  const maxOff = practiceNotes.reduce((m, n) => Math.max(m, staffOffset(n.note)), 0);
  const PRAC_FINGER_Y = Math.max(5, staffY(maxOff) - 12);

  const keySig = window._currentStaffKeySig || {};
  const colorByString = !!(window._currentStaffWithPrac);

  track.innerHTML = practiceNotes.map((entry, i) => {
    const x = i * slot;
    const offset = staffOffset(entry.note);
    const y = staffY(offset);
    const { staffLetter, accidental } = parseNoteForStaff(entry.note);
    const noteData = scalesData.notes[entry.note];
    const col = colorByString ? getStringColor(offset) : null;

    const ledgers = ledgerOffsets(offset).map(o => {
      const ly = staffY(o);
      return `<line class="note-ledger" x1="${x - 12}" y1="${ly}" x2="${x + 12}" y2="${ly}"/>`;
    }).join('');

    // 調号に含まれる臨時記号は _staffShowAccidentals が ON のときだけ表示
    const inKeySig = !_staffShowAccidentals && accidental && keySig[staffLetter] === accidental;
    const accidentalGlyph = (!inKeySig && accidental === 's') ? '♯'
                          : (!inKeySig && accidental === 'f') ? '♭' : '';
    const accidentalSvg = accidentalGlyph
      ? `<text class="note-accidental" x="${x - 13}" y="${y + 4}"${col ? ` fill="${col}"` : ''}>${accidentalGlyph}</text>`
      : '';

    const labelY = y > STAFF_HEIGHT / 2 ? y - 12 : y + 18;

    // 指番号（五線譜の上に固定行）
    const fingerSvg = _staffShowFingers ? (() => {
      const posStr = entry.position || '';
      const fNum = posStr.includes('開放') ? '0' : (posStr.match(/(\d)/) || [])[1] || '';
      return fNum ? `<text class="staff-finger-num" x="${x}" y="${PRAC_FINGER_Y}" text-anchor="middle" dominant-baseline="auto">${fNum}</text>` : '';
    })() : '';

    const headStyle = col ? ` style="fill:${col};stroke:${col};"` : '';

    return `<g class="staff-note" style="transform-origin:${x}px ${y}px">
      <circle class="note-highlight" cx="${x}" cy="${y}" r="15"/>
      ${ledgers}
      ${accidentalSvg}
      <ellipse class="note-head" cx="${x}" cy="${y}" rx="7" ry="5.5"${headStyle}/>
      <text class="note-solfege" x="${x}" y="${labelY}"${col ? ` fill="${col}"` : ''}>${noteData.label}</text>
      ${fingerSvg}
    </g>`;
  }).join('');

  updateNoteTrackView();
}

// currentIndex に合わせて音符トラック全体を横スクロールさせ（translateX）、
// 弾き終えた音には done、今弾く音には current のクラスを付け替える
function updateNoteTrackView() {
  const track = document.getElementById('noteTrack');
  const { slot, focus } = noteTrackMetrics();
  track.style.transform = `translateX(${focus - currentIndex * slot}px)`;

  document.querySelectorAll('.staff-note').forEach((chip, i) => {
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

  listeningManualCheckActive = false;
  listeningDragState = null;
  document.getElementById('listeningManualHint').style.display  = 'none';
  document.getElementById('listeningPlayNoteBtn').style.display = 'none';
  document.getElementById('beginCountdownBtn').style.display    = 'none';

  // 管理者ライブ記録モード: 完了時に結果をモーダルに返す
  if (adminLiveRecordMode) {
    adminLiveRecordMode  = false;
    adminLiveNoteResults = [...practiceResults];
    document.getElementById('practiceCard').style.display = 'none';
    document.getElementById('setupCard').style.display    = 'block';
    // 音符グリッドを実演結果で初期化（自動展開・編集可能）
    initNoteResultsGrid(practiceNotes, adminLiveNoteResults);
    const acc = practiceNotes.length > 0 ? Math.round(notesCorrect / practiceNotes.length * 100) : 0;
    document.getElementById('researchEditSuccess').textContent   = `実演完了 ✓  ${notesCorrect} / ${practiceNotes.length} 正解（${acc}%）　音符ごとの結果を確認・編集してから保存してください`;
    document.getElementById('researchEditSuccess').style.display = 'block';
    document.getElementById('researchEditError').style.display   = 'none';
    document.getElementById('researchEditOverlay').style.display = 'flex';
    return;
  }

  const categoryKey = document.getElementById(isDemoRun ? 'demoCategorySelect' : 'categorySelect').value;
  const scaleKey    = document.getElementById(isDemoRun ? 'demoScaleSelect' : 'scaleSelect').value;
  const scaleName   = getScalesForCategory(categoryKey)[scaleKey]?.name || scaleKey;
  const direction   = document.querySelector(`input[name="${isDemoRun ? 'demoDirection' : 'direction'}"]:checked`).value;
  // デモ実行は練習設定の「練習モード」ラジオに関係なく常にテンポモード扱い
  const mode      = isDemoRun ? 'tempo' : document.querySelector('input[name="mode"]:checked').value;
  const bpm       = mode === 'tempo'
    ? parseInt(document.getElementById(isDemoRun ? 'demoBpmRange' : 'bpmRange').value)
    : null;

  const dirLabels = { up: '上行', down: '下行', updown: '上下', arpeggio: 'アルペジオ' };
  const dirLabel  = dirLabels[direction] || direction;

  const accuracy = practiceNotes.length > 0
    ? Math.round(notesCorrect / practiceNotes.length * 100) : 0;
  const karaokeScore = computeKaraokeScore(practiceResults);

  // ゲストモードでは記録を一切保存しない（ログインしていないので保存先のアカウントが無い）。
  // デモ実行は「この結果を記録に残すか」で「記録する」が選ばれていない限り保存しない
  // （デモはマイク無しのシミュレーションなので、実際の練習記録に混ざらないようにする）。
  // 通常の練習モードにも管理者用に同様のトグルがあり（既定は「記録する」＝従来通り）、
  // 動作確認のたびに記録が増えてしまうのを管理者が避けられるようにしている
  // リスニングモードはそもそも判定を行っていないので、一切保存しない
  const wantsSave = isDemoRun
    ? document.querySelector('input[name="demoSaveHistory"]:checked').value === 'yes'
    : adminExperiencing
      ? verifyModeSaveHistory === 'yes'
      : document.querySelector('input[name="practiceSaveHistory"]:checked').value === 'yes';
  if (!isGuest && wantsSave && mode !== 'listening') {
    // profile_idは送らない。誰の記録として保存するかはサーバー側で
    // ログイン中の本人アカウントに固定しているため（他人になりすまして記録できないように）
    const entry = await saveHistory({
      scale: scaleName, direction: dirLabel, mode,
      bpm, notes_correct: notesCorrect, notes_total: practiceNotes.length,
      note_results: practiceResults,
      phase: subjectProtocolActive ? subjectStagePhase : 'practice'
    });
    addHistoryItem(entry);
  }

  // 結果画面のボタンは既定で表示（被験者プロトコルの不合格時だけ、後段で非表示にする）。
  // 「確認して次へ」「独自練習後の準備完了」は判定処理内でだけ表示するので、ここでは必ず隠しておく
  document.getElementById('retryPracticeBtn').style.display = '';
  document.getElementById('retryBtn').style.display         = '';
  document.getElementById('verifyModeContinueBtn').style.display        = 'none';
  document.getElementById('subjectSelfPracticeReadyBtn').style.display  = 'none';
  // 間違えた音がある場合のみ「間違えた音だけ練習」ボタンを表示（被験者プロトコル中は不要）
  const hasWrongNotes = practiceResults.some(r => r.outcome !== 'correct');
  document.getElementById('weakNoteRetryBtn').style.display =
    (hasWrongNotes && !subjectProtocolActive) ? '' : 'none';

  document.getElementById('practiceCard').style.display  = 'none';
  document.getElementById('completeCard').style.display  = 'block';
  document.getElementById('completeMsg').textContent =
    `${scaleName}（${dirLabel}）完了！`;

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

  // 被験者プロトコル中のテンポ練習が終わったところ。フェーズに応じて処理を分ける：
  // ・事前演奏（baseline）：点数は表示するが判定はせず、自由練習（practice）に進む
  // ・テスト演奏（test）：合格基準で判定する（不合格なら自由練習に戻る、合格なら次の音階へ）
  // ・自由練習（practice）：ここでは何もしない（通常の練習と同じ扱いで、判定も自動進行もしない）
  if (subjectProtocolActive && mode === 'tempo') {
    if (subjectStagePhase === 'baseline') {
      handleSubjectBaselineComplete(scaleName, dirLabel, karaokeScore);
    } else if (subjectStagePhase === 'test') {
      judgeSubjectTempoAttempt(scaleName, dirLabel, karaokeScore);
    }
  }
}

// 被験者アカウントの、事前演奏（baseline）1回ぶんの完了処理。
// 点数は完了画面に表示するが、合否の判定は行わない。必ず自由練習（practice）フェーズへ進む。
// 本物の被験者は数秒後に自動で、検証モード（管理者の体験）は「確認して次へ」を押したタイミングで進む
function handleSubjectBaselineComplete(scaleName, dirLabel, karaokeScore) {
  const scorePoints = karaokeScoreToPercent(karaokeScore);
  const stepLabel    = subjectRoadmapSteps.length > 0
    ? `（音階${subjectRoadmapIndex + 1}/${subjectRoadmapSteps.length}）` : '';
  const step = subjectRoadmapSteps[subjectRoadmapIndex];
  const noPractice = step && step.with_practice === 'no';

  document.getElementById('retryPracticeBtn').style.display = 'none';
  document.getElementById('retryBtn').style.display         = 'none';

  if (noPractice) {
    if (adminExperiencing) {
      document.getElementById('completeMsg').textContent =
        `演奏記録：${scaleName}（${dirLabel}）${stepLabel} — ${scorePoints}点/100点中。次はテスト演奏に進みます`;
      showVerifyModeContinueBtn(async () => {
        subjectStagePhase = 'test';
        applySubjectRoadmapStep();
        returnToSubjectSetupScreen();
      });
      return;
    }

    // 本物の被験者：独自練習してもらってからテスト演奏へ
    document.getElementById('completeMsg').textContent =
      `事前演奏完了：${scaleName}（${dirLabel}）${stepLabel} — ${scorePoints}点/100点中。自分で練習してきてください。`;
    document.getElementById('subjectSelfPracticeReadyBtn').style.display = '';
    return;
  }

  document.getElementById('completeMsg').textContent =
    `演奏記録：${scaleName}（${dirLabel}）${stepLabel} — ${scorePoints}点/100点中。これから自由に練習できます`;

  const proceedToPractice = async () => {
    subjectStagePhase = 'practice';
    if (!adminExperiencing) await setSubjectStagePhase('practice');
    applySubjectRoadmapStep();
    returnToSubjectSetupScreen();
  };

  if (adminExperiencing) {
    showVerifyModeContinueBtn(proceedToPractice);
    return;
  }
  subjectAutoAdvanceTimer = setTimeout(proceedToPractice, 2200);
}

// 被験者アカウントの、テスト演奏（test）1回ぶんの合否判定。
// 不合格なら、間違えた音（×・△）を記録したうえで自由練習（practice）フェーズに戻る
// （間違えた音の1音ずつ練習は強制せず、自由練習画面で選べる任意の練習項目として提示するだけ）。
// 合格なら、ロードマップに次の音階が残っていれば次の音階の事前演奏（baseline）へ進み、
// 今の音階が最後（6つ目）だった場合はロードマップ完了の表示に切り替える。
// 検証モード（管理者の体験）はステージ選択式なので、合格したらそのステージをクリア済みにして
// ステージ選択画面に戻るだけで、次のステージへの自動進行や完了表示は行わない
function judgeSubjectTempoAttempt(scaleName, dirLabel, karaokeScore) {
  const scorePoints = karaokeScoreToPercent(karaokeScore);
  const stepLabel   = subjectRoadmapSteps.length > 0
    ? `（音階${subjectRoadmapIndex + 1}/${subjectRoadmapSteps.length}）` : '';
  const isLastStep  = subjectRoadmapIndex >= subjectRoadmapSteps.length - 1;

  document.getElementById('retryPracticeBtn').style.display = 'none';
  document.getElementById('retryBtn').style.display         = 'none';

  const step      = subjectRoadmapSteps[subjectRoadmapIndex];
  const sessionEnd = step && step.session_end === 'yes';

  subjectLastWrongEntries = [];

  document.getElementById('completeMsg').textContent = isLastStep
    ? `テスト演奏完了 ${scaleName}（${dirLabel}）${stepLabel} — ${scorePoints}点/100点中`
    : `テスト演奏完了 ${scaleName}（${dirLabel}）${stepLabel} — ${scorePoints}点/100点中。次の音階に進みます`;

  if (adminExperiencing) {
    verifyModeClearedStages.add(subjectRoadmapIndex);
    const nextIdx = subjectRoadmapIndex + 1;
    // 偶数ステップ（音階1）が終わったら、同じ日の音階2へ自動で進む
    if (subjectRoadmapIndex % 2 === 0 && nextIdx < subjectRoadmapSteps.length) {
      showVerifyModeContinueBtn(() => startVerifyModeStage(nextIdx));
    } else {
      showVerifyModeContinueBtn(returnToVerifyModeStageSelect);
    }
    return;
  }

  if (isLastStep) {
    subjectRoadmapIndex++;
    advanceSubjectProgress();
    subjectAutoAdvanceTimer = setTimeout(showSubjectRoadmapComplete, 2200);
    return;
  }

  if (sessionEnd) {
    subjectAutoAdvanceTimer = setTimeout(async () => {
      subjectRoadmapIndex++;
      await advanceSubjectProgress();
      showSubjectSessionEndScreen();
    }, 2200);
    return;
  }

  subjectAutoAdvanceTimer = setTimeout(async () => {
    subjectRoadmapIndex++;
    await advanceSubjectProgress();
    subjectStagePhase = 'baseline';
    applySubjectRoadmapStep();
    returnToSubjectSetupScreen();
  }, 2200);
}

// 被験者プロトコル中（本物の被験者／管理者の検証モード）は、通常のモード表示の前に
// 「🧪 被験者モード」「🧪 検証モード」のラベルと今のフェーズ・ロードマップの進捗を付け加える。
// これにより、練習中の画面が通常の練習モードと混同されないようにする
function subjectProtocolBadgePrefix() {
  if (!subjectProtocolActive) return '';
  const label = adminExperiencing ? '🧪 検証モード' : '🧪 被験者モード';
  const phaseLabels = { baseline: '事前演奏', practice: '自由練習', test: 'テスト演奏' };
  const phase = phaseLabels[subjectStagePhase] ? `・${phaseLabels[subjectStagePhase]}` : '';
  const step  = subjectRoadmapSteps.length > 0 ? `（音階${subjectRoadmapIndex + 1}/${subjectRoadmapSteps.length}${phase}）` : '';
  return `${label}${step} - `;
}

// 被験者プロトコル中の完了画面から、練習設定画面（自由練習・次のフェーズの案内）に戻る
function returnToSubjectSetupScreen() {
  document.getElementById('practiceCard').style.display = 'none';
  document.getElementById('completeCard').style.display = 'none';
  document.getElementById('setupCard').style.display    = 'block';
}

// 被験者アカウント用：自由練習フェーズで「苦手な音を練習する」を選んだときに、
// 直前のテスト演奏で間違えた（×・△だった）音だけを対象に1音ずつモードを開始する。
// あくまで自由練習の中の任意の一項目であり、テスト不合格時に強制で始まるものではない
function startSubjectStepRetry(wrongEntries) {
  practiceNotes     = wrongEntries;
  currentIndex      = 0;
  notesCorrect      = 0;
  practiceResults   = [];
  currentNoteMissed = false;
  showCurrentGlow   = true;
  activeSource      = (adminExperiencing && verifyModeDemoMode) ? createVerifyModeDemoSource() : detector;
  isDemoRun         = false;

  document.querySelector('input[name="mode"][value="step"]').checked = true;

  document.getElementById('setupCard').style.display    = 'none';
  document.getElementById('completeCard').style.display = 'none';
  document.getElementById('practiceCard').style.display = 'block';
  document.getElementById('modeBadge').textContent = subjectProtocolBadgePrefix() + '🎯 苦手な音を1音ずつ練習';

  renderNoteTrack();
  startStepMode();
}

// 検証モード（管理者の体験）専用：実際にマイクで演奏せず、ダミーの結果をその場で作って
// すぐに結果画面（事前演奏／合格／不合格）を表示する。各画面・合否パターンを素早く確認するための機能なので、
// 本物の被験者には出さない（ボタン自体もadminExperiencingのときしか表示されない）。
// 記録（履歴）には一切保存しない（実際に演奏したデータではないため）
// outcome: 'baseline'（事前演奏をスキップ）｜'pass'（テストに合格させる）｜'fail'（テストに不合格させる）
function skipSubjectPerformance(outcome) {
  if (!adminExperiencing) return;

  // 練習中の画面（カウントダウン待ち／カウントダウン中／テンポ演奏中など）から呼ばれた場合に備えて、
  // 進行中のタイマー・マイクをすべて止めておく（練習開始前の画面から呼ばれた場合は何もしない）
  if (activeSource) activeSource.stop();
  isPracticing = false;
  if (tempoInterval)  { clearInterval(tempoInterval);  tempoInterval  = null; }
  if (countTimer)     { clearInterval(countTimer);     countTimer     = null; }
  if (listeningTimer) { clearTimeout(listeningTimer);  listeningTimer = null; }
  if (subjectAutoAdvanceTimer)   { clearTimeout(subjectAutoAdvanceTimer);   subjectAutoAdvanceTimer   = null; }
  if (beginCountdownDelayTimer)  { clearTimeout(beginCountdownDelayTimer);  beginCountdownDelayTimer  = null; }
  beginCountdownAction = null;
  clearMetronomeVisual();
  listeningManualCheckActive = false;
  listeningDragState = null;
  document.getElementById('listeningManualHint').style.display  = 'none';
  document.getElementById('listeningPlayNoteBtn').style.display = 'none';
  document.getElementById('beginCountdownBtn').style.display    = 'none';
  document.getElementById('countdown').style.display            = 'none';
  document.getElementById('metronomeBar').style.display          = 'none';

  const step = subjectRoadmapSteps[subjectRoadmapIndex];
  const dirLabels = { up: '上行', down: '下行', updown: '上下', arpeggio: 'アルペジオ' };
  const scaleName = getScalesForCategory(step.category_key)[String(step.scale_id)]?.name || '';
  const dirLabel  = dirLabels[step.direction] || step.direction;

  // ダミーの演奏結果を作る：'fail'は全音×、それ以外（baseline/pass）は全音○にする
  practiceNotes = buildPracticeNotes(step.category_key, String(step.scale_id), step.direction) || [];
  practiceResults = practiceNotes.map(n => ({
    note: n.note, string: n.string,
    outcome: outcome === 'fail' ? 'wrong' : 'correct',
    cents: outcome === 'fail' ? 999 : 0
  }));
  notesCorrect = outcome === 'fail' ? 0 : practiceNotes.length;
  const karaokeScore = computeKaraokeScore(practiceResults);

  document.getElementById('setupCard').style.display       = 'none';
  document.getElementById('practiceCard').style.display    = 'none';
  document.getElementById('completeCard').style.display    = 'block';
  document.getElementById('accuracyDisplay').style.display = 'none';
  document.getElementById('resultDetail').innerHTML        = '';
  document.getElementById('retryPracticeBtn').style.display = 'none';
  document.getElementById('retryBtn').style.display         = 'none';
  document.getElementById('verifyModeContinueBtn').style.display = 'none';

  if (outcome === 'baseline') {
    handleSubjectBaselineComplete(scaleName, dirLabel, karaokeScore);
  } else {
    judgeSubjectTempoAttempt(scaleName, dirLabel, karaokeScore);
  }
}

// 検証モード（管理者の体験）の「実際に演奏せず結果を直接確認する」操作の表示・非表示を、
// 練習設定画面（subjectSkipControls）・練習中の画面（practiceSkipControls）の両方に反映する。
// 本物の被験者にはどちらも絶対に表示しない
function updateSubjectSkipControls() {
  const show = adminExperiencing;
  const showBaseline = show && subjectStagePhase === 'baseline';
  const showTest      = show && subjectStagePhase === 'test';

  document.getElementById('subjectSkipControls').style.display    = show ? '' : 'none';
  document.getElementById('subjectSkipBaselineBtn').style.display = showBaseline ? '' : 'none';
  document.getElementById('subjectSkipPassBtn').style.display     = showTest ? '' : 'none';
  document.getElementById('subjectSkipFailBtn').style.display     = 'none';

  document.getElementById('practiceSkipControls').style.display    = show ? '' : 'none';
  document.getElementById('practiceSkipBaselineBtn').style.display = showBaseline ? '' : 'none';
  document.getElementById('practiceSkipPassBtn').style.display     = showTest ? '' : 'none';
  document.getElementById('practiceSkipFailBtn').style.display     = 'none';
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

// 1音ぶんの判定を2/1/0点で返す。
// ・音が検出できなかった（cents無し）場合は×（0点）
// ・|cents| がcorrectCentsセント以内なら○（2点）
// ・closeCentsセント以内なら△（1点）
// ・それを超えたら×（0点）
// （correctCents/closeCentsは1音ずつ・テンポモードの「正解／惜しい」と同じ基準。管理者が設定タブで変更できる）
function computeNoteScore(result) {
  if (result.cents == null) return 0;

  const absCents = Math.abs(result.cents);
  if (absCents <= correctCents) return 2; // ○
  if (absCents <= closeCents)   return 1; // △
  return 0; // ×
}

// 2/1/0点を○/△/×の記号に変換する（内訳表示用）
function noteScoreSymbol(points) {
  if (points === 2) return '○';
  if (points === 1) return '△';
  return '×';
}

// 練習1回ぶんのカラオケ風スコアを { total: 合計得点, max: 満点（弾いた音符数×2点） } で返す。
// 表示用に100点満点へ換算する場合はkaraokeScoreToPercent()を使う
function computeKaraokeScore(results) {
  const totalPoints = results.reduce((sum, r) => sum + computeNoteScore(r), 0);
  const maxPoints    = results.length * 2;
  return { total: totalPoints, max: maxPoints };
}

// カラオケ風スコア{total, max}を、表示用に100点満点へ換算する（四捨五入）
function karaokeScoreToPercent(karaokeScore) {
  return karaokeScore.max > 0 ? Math.round(karaokeScore.total / karaokeScore.max * 100) : 0;
}

// 正答率（accuracy、0〜100）とカラオケ風の点数（karaokeScore = {total, max}）を、
// 設定に応じて「正答率」「点数（カラオケ風）」「両方」のいずれかで描画する。
// 正答率は「正解した音の数÷全体」の単純な割合、点数は音ごとのズレ幅も加味した別の指標で、
// 意図的に別の数値になる（正解でも完全一致でなければ点数は正答率よりズレて出ることがある）。
function renderAccuracyOrScore(accuracy, karaokeScore) {
  const numEl   = document.getElementById('accuracyNum');
  const labelEl = document.getElementById('accuracyLabel');
  const subEl   = document.getElementById('accuracySub');

  const scoreText  = `${karaokeScoreToPercent(karaokeScore)}点`;
  const showsScore = resultDisplayMode === 'score' || resultDisplayMode === 'both';

  if (showsScore) {
    numEl.textContent   = scoreText;
    labelEl.textContent = 'スコア（100点満点）';
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
  if (tempoInterval)  { clearInterval(tempoInterval); tempoInterval = null; }
  if (countTimer)     { clearInterval(countTimer);    countTimer = null; }
  if (listeningTimer) { clearTimeout(listeningTimer); listeningTimer = null; }
  if (subjectAutoAdvanceTimer) { clearTimeout(subjectAutoAdvanceTimer); subjectAutoAdvanceTimer = null; }
  if (beginCountdownDelayTimer) { clearTimeout(beginCountdownDelayTimer); beginCountdownDelayTimer = null; }
  beginCountdownAction = null;
  clearMetronomeVisual();
  listeningManualCheckActive = false;
  listeningDragState = null;
  document.getElementById('listeningManualHint').style.display  = 'none';
  document.getElementById('listeningPlayNoteBtn').style.display = 'none';
  document.getElementById('beginCountdownBtn').style.display    = 'none';
  document.getElementById('setupCard').style.display    = 'block';
  document.getElementById('practiceCard').style.display = 'none';
  document.getElementById('completeCard').style.display = 'none';
  document.getElementById('countdown').style.display    = 'none';
  document.getElementById('metronomeBar').style.display = 'none';
  initDemoModeUI(); // 管理者なら「デモ」タブも念のため再表示しておく

  // 検証モード（管理者の体験）中にステージを中断した場合も、本物の被験者と同じく
  // その音階の練習設定画面（subjectProtocolInfoはsetupCardの中にあるのでそのまま出る）に戻るだけで、
  // ステージ選択画面には戻らない。検証モード自体の終了・他のステージの選択は
  // 「🔙 ステージ選択に戻る」ボタン（練習設定画面内）からのみ行う
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
    const btn = e.has_note_results
      ? `<button class="btn-focus-practice" onclick="startFocusPracticeFromHistory(${e.id})">🎯 不正確な音を練習</button>`
      : '';
    return `<li class="history-item">${e.practiced_at}　${e.scale}（${e.direction}）${acc}${btn}</li>`;
  }).join('');
}

// 過去の記録から不正確（△・×）だった音だけを抽出して1音ずつモードを開始する
async function startFocusPracticeFromHistory(historyId) {
  let noteResults;
  try {
    const resp = await fetch(`/api/history/${historyId}/notes`);
    if (!resp.ok) throw new Error();
    noteResults = await resp.json();
  } catch {
    alert('記録の読み込みに失敗しました');
    return;
  }
  const wrongNotes = noteResults.filter(r => r.outcome !== 'correct');
  if (wrongNotes.length === 0) {
    alert('この記録には不正確な音符がありません。すべて正解です！');
    return;
  }
  practiceNotes     = wrongNotes;
  currentIndex      = 0;
  notesCorrect      = 0;
  practiceResults   = [];
  currentNoteMissed = false;
  showCurrentGlow   = true;
  activeSource      = detector;
  isDemoRun         = false;

  document.querySelector('input[name="mode"][value="step"]').checked = true;
  document.getElementById('setupCard').style.display    = 'none';
  document.getElementById('completeCard').style.display = 'none';
  document.getElementById('practiceCard').style.display = 'block';
  document.getElementById('modeBadge').textContent = '🎯 不正確な音を集中練習';

  renderNoteTrack();
  startStepMode();
}

// ===========================
// グラフ描画（統計タブ、Chart.js を使用）
// ===========================
const charts = { accuracy: null, daily: null, scale: null, notes: null, strings: null }; // 描画済みのChartインスタンスを保持（再描画時に破棄するため）

// 文字列をHTMLとして安全に埋め込めるようにエスケープする（アカウント名はユーザー入力のため）
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 【管理者用】全アカウントの一覧（ID・名前・権限・作成日）を「アカウント」タブに表示する。
// 行をクリックすると、そのアカウントが選択され、「記録」タブで履歴・統計を確認できるようになる。
// 管理者以外の行には削除ボタンを出し、被験者アカウント（自分では削除できない）も
// ここから管理者が削除できるようにする。被験者アカウントの行には、練習する音階
// （ロードマップ）を変更する「音階を編集」ボタンもあわせて出す
async function renderAccountList() {
  document.getElementById('accountListCard').style.display = 'block';

  const profiles = await getProfiles();

  const makeRow = p => `
    <tr class="account-row${p.id === currentProfileId ? ' selected' : ''}" data-profile-id="${p.id}">
      <td>${p.id}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.role === 'admin' ? '<span class="compare-role-badge">管理者</span>' : (p.is_subject === 'yes' ? '被験者' : '一般')}</td>
      <td>${p.created_at}</td>
      <td>
        ${p.is_subject === 'yes' ? '<button type="button" class="btn-secondary btn-sm admin-edit-roadmap-btn">音階を編集</button>' : ''}
        ${p.role === 'admin' ? '' : '<button type="button" class="btn-danger btn-sm admin-delete-account-btn">削除</button>'}
      </td>
    </tr>`;

  const withPractice    = profiles.filter(p => p.is_subject === 'yes' && p.with_practice === 'yes');
  const withoutPractice = profiles.filter(p => p.is_subject === 'yes' && p.with_practice !== 'yes');
  const others          = profiles.filter(p => p.is_subject !== 'yes');

  const makeSectionHeader = label => `
    <tr class="account-list-section-header">
      <td colspan="5">${label}</td>
    </tr>`;

  const rows = [
    ...(withPractice.length    ? [makeSectionHeader('アプリ練習あり'), ...withPractice.map(makeRow)]    : []),
    ...(withoutPractice.length ? [makeSectionHeader('アプリ練習なし'), ...withoutPractice.map(makeRow)] : []),
    ...(others.length          ? [makeSectionHeader('その他'), ...others.map(makeRow)]                  : []),
  ];

  document.getElementById('accountListTableBody').innerHTML = rows.join('');

  document.querySelectorAll('#accountListTableBody .account-row').forEach(row => {
    row.addEventListener('click', async () => {
      currentProfileId = parseInt(row.dataset.profileId, 10);
      document.querySelectorAll('#accountListTableBody .account-row').forEach(r =>
        r.classList.toggle('selected', r === row)
      );
      await renderHistory();
      await renderStatsForCurrentProfile();
    });
  });

  document.querySelectorAll('#accountListTableBody .admin-delete-account-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // 行クリック（アカウント選択）が同時に発火しないようにする
      const profileId = parseInt(btn.closest('tr').dataset.profileId, 10);
      const profile    = profiles.find(p => p.id === profileId);
      if (!confirm(`アカウント「${profile.name}」と、その練習履歴をすべて削除しますか？この操作は取り消せません。`)) return;
      try {
        await deleteProfile(profileId);
        if (currentProfileId === profileId) currentProfileId = currentUser.id; // 見ていたアカウントを削除したら自分に戻す
        await renderAccountList();
        await renderHistory();
        await renderStatsForCurrentProfile();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  document.querySelectorAll('#accountListTableBody .admin-edit-roadmap-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const profileId = parseInt(btn.closest('tr').dataset.profileId, 10);
      const profile    = profiles.find(p => p.id === profileId);
      openSubjectRoadmapEditor(profileId, profile.name);
    });
  });
}

// ===========================
// 被験者の音階ロードマップ編集（管理者用）
// ===========================
let roadmapEditProfileId = null; // 今編集中の被験者のプロフィールID

// 「音階を編集」ボタンから呼ばれる。フェーズ1・2の各2音階と共通の方向・テンポを編集フォームに反映する
async function openSubjectRoadmapEditor(profileId, profileName) {
  const errorEl   = document.getElementById('roadmapEditError');
  const successEl = document.getElementById('roadmapEditSuccess');
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';

  const data = await getSubjectAssignment(profileId);
  if (!data || !data.steps || data.steps.length === 0) {
    alert('この被験者には練習内容が割り当てられていません');
    return;
  }

  roadmapEditProfileId = profileId;
  document.getElementById('roadmapEditAccountName').textContent = profileName;

  const firstStep = data.steps[0];
  document.querySelector(`input[name="roadmapEditDirection"][value="${firstStep.direction}"]`).checked = true;
  document.getElementById('roadmapEditBpmRange').value       = firstStep.bpm;
  document.getElementById('roadmapEditBpmValue').textContent = firstStep.bpm;

  // with_practice ラジオ
  const wpRadio = document.querySelector(`input[name="roadmapEditWithPractice"][value="${firstStep.with_practice || 'no'}"]`);
  if (wpRadio) wpRadio.checked = true;

  // ペア1: step[0]=音階1, step[1]=音階2 / ペア2: step[8]=音階3, step[9]=音階4
  const selConf = [
    { catId: 'roadmapEditS1Cat', scaleId: 'roadmapEditS1Scale', stepIdx: 0 },
    { catId: 'roadmapEditS2Cat', scaleId: 'roadmapEditS2Scale', stepIdx: 1 },
    { catId: 'roadmapEditS3Cat', scaleId: 'roadmapEditS3Scale', stepIdx: 8 },
    { catId: 'roadmapEditS4Cat', scaleId: 'roadmapEditS4Scale', stepIdx: 9 },
  ];
  selConf.forEach(({ catId, scaleId, stepIdx }) => {
    const step = data.steps[stepIdx] || data.steps[0];
    const catSel   = document.getElementById(catId);
    const scaleSel = document.getElementById(scaleId);
    catSel.value = step.category_key;
    populateRoadmapEditScaleSelect(scaleSel, step.category_key);
    scaleSel.value = String(step.scale_id);
    catSel.addEventListener('change', () => populateRoadmapEditScaleSelect(scaleSel, catSel.value));
  });

  document.getElementById('subjectRoadmapEditCard').style.display = 'block';
  document.getElementById('subjectRoadmapEditCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 編集フォームの「調」セレクトの中身を、選んだカテゴリーの音階一覧で作り直す
function populateRoadmapEditScaleSelect(scaleSelect, categoryKey) {
  const scales = getScalesForCategory(categoryKey);
  scaleSelect.innerHTML = Object.keys(scales)
    .map(key => `<option value="${key}">${scales[key].name}</option>`).join('');
}

document.getElementById('roadmapEditBpmRange').addEventListener('input', (e) => {
  document.getElementById('roadmapEditBpmValue').textContent = e.target.value;
});

document.getElementById('roadmapEditCancelBtn').addEventListener('click', () => {
  document.getElementById('subjectRoadmapEditCard').style.display = 'none';
  roadmapEditProfileId = null;
});

document.getElementById('roadmapEditSaveBtn').addEventListener('click', async () => {
  const errorEl   = document.getElementById('roadmapEditError');
  const successEl = document.getElementById('roadmapEditSuccess');
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';

  const direction = document.querySelector('input[name="roadmapEditDirection"]:checked').value;
  const bpm       = parseInt(document.getElementById('roadmapEditBpmRange').value, 10);

  // 4音階セレクタから16ステップを生成する
  const wp = document.querySelector('input[name="roadmapEditWithPractice"]:checked').value;
  const fourScales = [
    { category_key: document.getElementById('roadmapEditS1Cat').value,  scale_id: parseInt(document.getElementById('roadmapEditS1Scale').value,  10) },
    { category_key: document.getElementById('roadmapEditS2Cat').value,  scale_id: parseInt(document.getElementById('roadmapEditS2Scale').value,  10) },
    { category_key: document.getElementById('roadmapEditS3Cat').value,  scale_id: parseInt(document.getElementById('roadmapEditS3Scale').value,  10) },
    { category_key: document.getElementById('roadmapEditS4Cat').value,  scale_id: parseInt(document.getElementById('roadmapEditS4Scale').value,  10) },
  ];

  const steps = [];
  for (let pair = 0; pair < 2; pair++) {
    const s1 = fourScales[pair * 2], s2 = fourScales[pair * 2 + 1];
    for (let day = 0; day < 4; day++) {
      const isLast = pair === 1 && day === 3;
      steps.push({ category_key: s1.category_key, scale_id: s1.scale_id, with_practice: wp, session_end: 'no' });
      steps.push({ category_key: s2.category_key, scale_id: s2.scale_id, with_practice: wp, session_end: isLast ? 'no' : 'yes' });
    }
  }

  try {
    await updateSubjectAssignment(roadmapEditProfileId, steps, direction, bpm);
    successEl.textContent   = '保存しました（この被験者の進捗はリセットされます）';
    successEl.style.display = 'block';
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
});

// 統計データをサーバーから取得し、「正答率の推移」「日別練習回数」「調ごとの正答率」
// ===========================
// 練習カレンダー（記録タブ：その日に練習したかどうかを月単位で表示する）
// ===========================
let calendarViewDate   = new Date(); // カレンダーに表示中の月（日は使わず年・月だけ見る）
let practicedDatesSet  = new Set();  // 'YYYY/MM/DD'形式の文字列の集合（選択中のアカウントの練習日）

// 'YYYY/MM/DD'形式（サーバー側のpracticed_atの日付部分と同じ形式）に整形する
function formatCalendarDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

// calendarViewDateの月を描画し、practicedDatesSetに含まれる日に✓を付ける
function renderCalendar() {
  const year  = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth(); // 0〜11
  document.getElementById('calendarMonthLabel').textContent = `${year}年${month + 1}月`;

  const firstWeekday = new Date(year, month, 1).getDay(); // 0=日曜
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const todayStr     = formatCalendarDate(new Date());

  let html = ['日', '月', '火', '水', '木', '金', '土']
    .map(w => `<div class="calendar-weekday">${w}</div>`).join('');

  for (let i = 0; i < firstWeekday; i++) {
    html += '<div class="calendar-day empty"></div>';
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr   = formatCalendarDate(new Date(year, month, d));
    const practiced = practicedDatesSet.has(dateStr);
    const isToday   = dateStr === todayStr;
    html += `<div class="calendar-day${practiced ? ' practiced' : ''}${isToday ? ' today' : ''}">`
          + `${d}${practiced ? '<span class="calendar-check">✓</span>' : ''}</div>`;
  }

  document.getElementById('calendarGrid').innerHTML = html;
}

document.getElementById('calendarPrevBtn').addEventListener('click', () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById('calendarNextBtn').addEventListener('click', () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
  renderCalendar();
});

// 「苦手な音」「弦ごとの正答率」の5つのグラフを描画する（記録タブを開いたときに1回だけ呼ばれる）。
// 管理者がどのアカウント分を見るかは「アカウント」タブの一覧から選ぶ
// （アカウント同士の比較表示は廃止し、選んだ1アカウント分だけを表示する方式にした）
async function renderStats() {
  await renderStatsForCurrentProfile();
  await loadStatsResearchData();
}

// currentProfileId のアカウント分だけ、5つのグラフ・練習カレンダーを描画し直す。
// アカウント一覧の行をクリックして閲覧先を切り替えたときは、これだけを呼べば十分
// （アカウント一覧・比較セクションまで作り直す必要は無いため）
async function renderStatsForCurrentProfile() {
  const data     = await getStats(currentProfileId);
  const noteData = await getNoteStats(currentProfileId);
  const daily    = [...data.daily].reverse();
  const scales   = data.by_scale;

  practicedDatesSet = new Set(data.practiced_dates || []);
  calendarViewDate   = new Date(); // アカウントを切り替えたら、表示中の月を今月に戻す
  renderCalendar();

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
// タブ切り替え（「練習」「デモ」「記録」「設定」タブ）
// ===========================
let statsLoaded = false; // 統計タブを一度でも開いたか（毎回グラフを再取得しないようにするフラグ）

// 指定したタブを表示し、他のタブ（と対応するナビボタンのactive状態）を切り替える。
// ナビのクリックだけでなく、デモ開始のようにコード側から別タブへ切り替えたい場合にも使う
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // 表示する側は空文字にして、CSSの.tab-content（display:flex）に任せる
  // （'block'を指定するとインラインstyleがCSSのdisplay:flexを上書きしてしまい、タブ内の余白が効かなくなるため）
  document.getElementById('tab-practice').style.display = tab === 'practice' ? '' : 'none';
  document.getElementById('tab-demo').style.display     = tab === 'demo'     ? '' : 'none';
  document.getElementById('tab-subject-experience').style.display = tab === 'subject-experience' ? '' : 'none';
  document.getElementById('tab-stats').style.display    = tab === 'stats'    ? '' : 'none';
  document.getElementById('tab-admin').style.display    = tab === 'admin'    ? '' : 'none';
  document.getElementById('tab-settings').style.display = tab === 'settings' ? '' : 'none';

  if (tab === 'stats') {
    initStatsProfileSelector(); // セレクタのアカウント一覧を最新化（非同期、await不要）
    if (!statsLoaded) {
      renderStats();
      statsLoaded = true;
    }
  }
  if (tab === 'admin') {
    renderAccountList();
    initResearchTabData();
    if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'researcher')) {
      document.getElementById('researchAnalysisCard').style.display = '';
      loadResearchAnalysis();
    }
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ===========================
// イベント（設定画面のUI部品にリスナーを登録する）
// ===========================
// カテゴリーを変更したら、調セレクトの中身を作り直す
document.getElementById('categorySelect').addEventListener('change', populateScaleSelect);
document.getElementById('demoCategorySelect').addEventListener('change', populateDemoScaleSelect);

// 調を選んだら「開始」ボタンを押せるようにする（未選択なら押せない）
document.getElementById('scaleSelect').addEventListener('change', (e) => {
  document.getElementById('startBtn').disabled = e.target.value === '';
});
document.getElementById('demoScaleSelect').addEventListener('change', (e) => {
  document.getElementById('startDemoBtn').disabled = e.target.value === '';
});

// 「テンポ」「リスニング」モードの切り替えで、BPM設定欄の表示・非表示を切り替える
// （どちらも一定のテンポで進むモードなので、同じBPM欄を共用する）
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    document.getElementById('bpmGroup').style.display =
      (e.target.value === 'tempo' || e.target.value === 'listening') ? 'block' : 'none';
    updateStepHoldModeVisibility();
  });
});

// 管理者にだけ、1音ずつモード限定の「正解判定方式（保持判定）」トグルを表示する。
// 保持判定はstep以外のモードには関係ないので、modeラジオがstep以外のときは管理者でも隠す
function updateStepHoldModeVisibility() {
  const isAdmin  = currentUser && currentUser.role === 'admin';
  const mode     = document.querySelector('input[name="mode"]:checked').value;
  // 検証モード中は、1音ずつモードの判定方式も「設定」タブのverifyModeStepHold（固定値）に従うため、
  // ここでの切り替えトグル自体は常に隠す
  document.getElementById('stepHoldModeGroup').style.display =
    (isAdmin && mode === 'step' && !adminExperiencing) ? '' : 'none';
}

// BPMスライダーを動かしたら、隣に表示している数値も更新する
document.getElementById('bpmRange').addEventListener('input', (e) => {
  document.getElementById('bpmValue').textContent = e.target.value;
});
document.getElementById('demoBpmRange').addEventListener('input', (e) => {
  document.getElementById('demoBpmValue').textContent = e.target.value;
});

// デモモードの「ズレ幅」「正答率」スライダーを動かしたら、隣に表示している数値も更新する
document.getElementById('demoOffsetCents').addEventListener('input', (e) => {
  document.getElementById('demoOffsetCentsValue').textContent = e.target.value;
});
document.getElementById('demoAccuracyRate').addEventListener('input', (e) => {
  document.getElementById('demoAccuracyRateValue').textContent = e.target.value;
});
document.getElementById('demoToneCents').addEventListener('input', (e) => {
  document.getElementById('demoToneCentsValue').textContent = e.target.value;
});

document.getElementById('startBtn').addEventListener('click', startPractice);
document.getElementById('startDemoBtn').addEventListener('click', startDemo);
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
  initDemoModeUI(); // 管理者なら「デモ」タブも念のため再表示しておく
});

// 完了画面の「もう一回練習」ボタンで、設定画面に戻らず同じ設定のまま練習（またはデモ）をやり直す
document.getElementById('retryPracticeBtn').addEventListener('click', () => {
  if (isDemoRun) startDemo(); else startPractice();
});

// 完了画面の「間違えた音だけ練習」ボタン：今回の practiceResults から正解以外の音だけで1音ずつ練習
document.getElementById('weakNoteRetryBtn').addEventListener('click', () => {
  const wrongNotes = practiceResults.filter(r => r.outcome !== 'correct');
  if (wrongNotes.length === 0) return;
  startSubjectStepRetry(wrongNotes);
});

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
  refreshSignupButtonVisibility();
}

// ログイン画面を表示するたび、管理者が「新規アカウント作成」を許可しているか最新の状態を取り直し、
// 「新しいアカウントを作る」ボタンの表示・非表示に反映する
async function refreshSignupButtonVisibility() {
  const settings = await getSettings();
  document.getElementById('showSignupBtn').style.display =
    settings.signup_enabled === 'no' ? 'none' : '';
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
  resetAdminOnlyPracticeSettings(); // 選択状態を次のログインまで持ち越さない（念のための保険）
  document.getElementById('loginName').value = '';
  document.getElementById('loginPassword').value = '';
  showLoginSubForm('login');
  showLoginScreen();
});

// アプリ全体の設定（結果画面の表示形式・新規アカウント作成の可否）をサーバーから読み込み、
// resultDisplayMode / signupEnabled に反映する。
// ゲストの画面にも反映する必要があるため、ログイン有無に関わらず呼ぶ
async function loadAppSettings() {
  const settings = await getSettings();
  resultDisplayMode = ['score', 'both'].includes(settings.result_display_mode)
    ? settings.result_display_mode : 'accuracy';
  signupEnabled = settings.signup_enabled === 'no' ? 'no' : 'yes';
  stepHoldGeneral = settings.step_hold_general === 'yes' ? 'yes' : 'no';
  passThreshold = Number.isFinite(parseInt(settings.pass_threshold, 10)) ? parseInt(settings.pass_threshold, 10) : 80;
  correctCents  = Number.isFinite(parseInt(settings.correct_cents, 10)) ? parseInt(settings.correct_cents, 10) : 15;
  closeCents    = Number.isFinite(parseInt(settings.close_cents, 10))   ? parseInt(settings.close_cents, 10)   : 35;
  verifyModeDirection = ['up', 'down', 'updown', 'arpeggio'].includes(settings.verify_mode_direction)
    ? settings.verify_mode_direction : 'up';
  verifyModeBpm       = Number.isFinite(parseInt(settings.verify_mode_bpm, 10)) ? parseInt(settings.verify_mode_bpm, 10) : 60;
  verifyModeStepHold    = settings.verify_mode_step_hold === 'hold' ? 'hold' : 'instant';
  verifyModeSaveHistory = settings.verify_mode_save_history === 'no' ? 'no' : 'yes';
}

// 管理者にだけ「被験者練習の合格基準」カードを表示し、現在の設定をスライダーに反映する
function initPassThresholdSetting() {
  const card = document.getElementById('passThresholdSettingCard');
  if (!currentUser || currentUser.role !== 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.getElementById('passThresholdInput').value = passThreshold;
  document.getElementById('passThresholdValue').textContent = passThreshold;
}

// 管理者がこの設定を切り替えたら、サーバーに保存する
// （反映は被験者が次にテンポ練習の結果を判定したときから）
document.getElementById('passThresholdInput').addEventListener('input', (e) => {
  document.getElementById('passThresholdValue').textContent = e.target.value;
});
document.getElementById('passThresholdInput').addEventListener('change', async (e) => {
  const errorEl = document.getElementById('passThresholdError');
  errorEl.style.display = 'none';
  const value = parseInt(e.target.value, 10);
  try {
    await updateSettings({ pass_threshold: value });
    passThreshold = value;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    initPassThresholdSetting(); // 失敗したら選択状態を元に戻す
  }
});

// 管理者にだけ「正解判定の許容誤差」カードを表示し、現在の設定を入力欄に反映する
function initPitchToleranceSetting() {
  const card = document.getElementById('pitchToleranceSettingCard');
  if (!currentUser || currentUser.role !== 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.getElementById('correctCentsInput').value = correctCents;
  document.getElementById('closeCentsInput').value   = closeCents;
}

// 管理者がこの設定を変更したら、サーバーに保存する
// （反映は次に音程を判定したときから。1音ずつ・テンポ・点数計算のすべてに影響する）
document.getElementById('correctCentsInput').addEventListener('change', async (e) => {
  const errorEl = document.getElementById('pitchToleranceError');
  errorEl.style.display = 'none';
  const value = parseInt(e.target.value, 10);
  try {
    await updateSettings({ correct_cents: value });
    correctCents = value;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    initPitchToleranceSetting(); // 失敗したら入力欄を元に戻す
  }
});
document.getElementById('closeCentsInput').addEventListener('change', async (e) => {
  const errorEl = document.getElementById('pitchToleranceError');
  errorEl.style.display = 'none';
  const value = parseInt(e.target.value, 10);
  try {
    await updateSettings({ close_cents: value });
    closeCents = value;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    initPitchToleranceSetting(); // 失敗したら入力欄を元に戻す
  }
});

// 管理者にだけ「検証モードの設定」カードを表示し、現在の設定をラジオボタン・スライダーに反映する
function initVerifyModeSetting() {
  const card = document.getElementById('verifyModeSettingCard');
  if (!currentUser || currentUser.role !== 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.querySelectorAll('input[name="verifyModeDirection"]').forEach(radio => {
    radio.checked = radio.value === verifyModeDirection;
  });
  document.getElementById('verifyModeBpmRange').value       = verifyModeBpm;
  document.getElementById('verifyModeBpmValue').textContent = verifyModeBpm;
  document.querySelectorAll('input[name="verifyModeStepHold"]').forEach(radio => {
    radio.checked = radio.value === verifyModeStepHold;
  });
  document.querySelectorAll('input[name="verifyModeSaveHistory"]').forEach(radio => {
    radio.checked = radio.value === verifyModeSaveHistory;
  });
}

document.getElementById('verifyModeBpmRange').addEventListener('input', (e) => {
  document.getElementById('verifyModeBpmValue').textContent = e.target.value;
});

// 管理者がこの設定を変更したら、サーバーに保存する（反映は次に「検証モード」を開始したときから）
document.querySelectorAll('input[name="verifyModeDirection"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const errorEl = document.getElementById('verifyModeSettingError');
    errorEl.style.display = 'none';
    try {
      await updateSettings({ verify_mode_direction: e.target.value });
      verifyModeDirection = e.target.value;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      initVerifyModeSetting(); // 失敗したら選択状態を元に戻す
    }
  });
});
document.getElementById('verifyModeBpmRange').addEventListener('change', async (e) => {
  const errorEl = document.getElementById('verifyModeSettingError');
  errorEl.style.display = 'none';
  const value = parseInt(e.target.value, 10);
  try {
    await updateSettings({ verify_mode_bpm: value });
    verifyModeBpm = value;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
    initVerifyModeSetting(); // 失敗したら入力欄を元に戻す
  }
});
document.querySelectorAll('input[name="verifyModeStepHold"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const errorEl = document.getElementById('verifyModeSettingError');
    errorEl.style.display = 'none';
    try {
      await updateSettings({ verify_mode_step_hold: e.target.value });
      verifyModeStepHold = e.target.value;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      initVerifyModeSetting(); // 失敗したら選択状態を元に戻す
    }
  });
});
document.querySelectorAll('input[name="verifyModeSaveHistory"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const errorEl = document.getElementById('verifyModeSettingError');
    errorEl.style.display = 'none';
    try {
      await updateSettings({ verify_mode_save_history: e.target.value });
      verifyModeSaveHistory = e.target.value;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      initVerifyModeSetting(); // 失敗したら選択状態を元に戻す
    }
  });
});

// 管理者にだけ「検証モードの音階を設定」カードを表示し、現在の設定（または未設定時は
// 自動選択のプレビュー）を6つのカテゴリー・調セレクトに反映する
async function initVerifyModeScalesSetting() {
  const card = document.getElementById('verifyModeScalesCard');
  if (!currentUser || currentUser.role !== 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  const data = await getVerifyModeScales();
  verifyModeScaleSteps = data.steps || [];
  renderVerifyModeScalesEditor();
}

// 検証モードの音階を選ぶ6つのカテゴリー・調セレクトを描画する。
// 未設定（verifyModeScaleSteps が空）の場合は、登録済みの音階から自動で選ぶ仮の内容を表示する
function renderVerifyModeScalesEditor() {
  const listEl = document.getElementById('verifyModeScaleList');
  const preview = verifyModeScaleSteps.length > 0
    ? verifyModeScaleSteps
    : buildPlaceholderRoadmap(verifyModeDirection, verifyModeBpm);

  listEl.innerHTML = preview.map((_, i) => `
    <div class="roadmap-edit-row">
      <label>音階${i + 1}</label>
      <select class="verify-mode-scale-category" data-step="${i}">
        <option value="first_position">第一ポジションの音階</option>
        <option value="two_octave">2オクターブの音階</option>
      </select>
      <select class="verify-mode-scale-select" data-step="${i}"></select>
      <label class="roadmap-edit-practice-label">
        <input type="checkbox" class="verify-mode-practice" data-step="${i}" checked> アプリ練習あり
      </label>
      <label class="roadmap-edit-practice-label">
        <input type="checkbox" class="verify-mode-session-end" data-step="${i}"> 今日はここまで
      </label>
    </div>
  `).join('');

  preview.forEach((step, i) => {
    const categorySelect  = listEl.querySelector(`.verify-mode-scale-category[data-step="${i}"]`);
    const scaleSelect     = listEl.querySelector(`.verify-mode-scale-select[data-step="${i}"]`);
    const practiceCheck   = listEl.querySelector(`.verify-mode-practice[data-step="${i}"]`);
    const sessionEndCheck = listEl.querySelector(`.verify-mode-session-end[data-step="${i}"]`);
    categorySelect.value = step.category_key;
    populateRoadmapEditScaleSelect(scaleSelect, step.category_key);
    scaleSelect.value = String(step.scale_id);
    practiceCheck.checked   = step.with_practice !== 'no';
    sessionEndCheck.checked = step.session_end === 'yes';
    categorySelect.addEventListener('change', () => {
      populateRoadmapEditScaleSelect(scaleSelect, categorySelect.value);
    });
  });
}

document.getElementById('verifyModeScalesSaveBtn').addEventListener('click', async () => {
  const errorEl   = document.getElementById('verifyModeScalesError');
  const successEl = document.getElementById('verifyModeScalesSuccess');
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';

  const listEl = document.getElementById('verifyModeScaleList');
  const steps = Array.from(listEl.querySelectorAll('.verify-mode-scale-category')).map(categorySelect => {
    const i               = categorySelect.dataset.step;
    const scaleSelect     = listEl.querySelector(`.verify-mode-scale-select[data-step="${i}"]`);
    const practiceCheck   = listEl.querySelector(`.verify-mode-practice[data-step="${i}"]`);
    const sessionEndCheck = listEl.querySelector(`.verify-mode-session-end[data-step="${i}"]`);
    return {
      category_key:  categorySelect.value,
      scale_id:      parseInt(scaleSelect.value, 10),
      with_practice: practiceCheck  && practiceCheck.checked  ? 'yes' : 'no',
      session_end:   sessionEndCheck && sessionEndCheck.checked ? 'yes' : 'no'
    };
  });

  try {
    await updateVerifyModeScales(steps);
    verifyModeScaleSteps = steps.map((s, i) => ({ step_order: i, session_end: 'no', ...s }));
    successEl.textContent   = '保存しました';
    successEl.style.display = 'block';
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
});

document.getElementById('verifyModeScalesResetBtn').addEventListener('click', async () => {
  const errorEl   = document.getElementById('verifyModeScalesError');
  const successEl = document.getElementById('verifyModeScalesSuccess');
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';

  try {
    await resetVerifyModeScales();
    verifyModeScaleSteps = [];
    renderVerifyModeScalesEditor();
    successEl.textContent   = '自動選択に戻しました';
    successEl.style.display = 'block';
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
});

// 練習設定画面を、通常の選択画面（音階・方向・モードを自分で選べる）に戻す
function resetToNormalPracticeSetup() {
  subjectProtocolActive   = false;
  adminExperiencing       = false;
  subjectRoadmapSteps     = [];
  subjectRoadmapIndex     = 0;
  subjectStagePhase       = 'baseline';
  subjectLastWrongEntries = [];
  verifyModeClearedStages = new Set();
  verifyModeDemoMode      = false;
  verifyModeContinueAction = null;
  if (subjectAutoAdvanceTimer) { clearTimeout(subjectAutoAdvanceTimer); subjectAutoAdvanceTimer = null; }
  document.getElementById('verifyModeContinueBtn').style.display = 'none';
  document.getElementById('subjectProtocolInfo').style.display    = 'none';
  document.getElementById('subjectRoadmapDoneInfo').style.display  = 'none';
  document.getElementById('subjectSessionEndInfo').style.display   = 'none';
  document.getElementById('subjectWeakNoteBanner').style.display      = 'none';
  document.getElementById('subjectWeakNotePracticeBtn').style.display = 'none';
  document.getElementById('subjectProceedToTestBtn').style.display    = 'none';
  document.getElementById('subjectSkipControls').style.display     = 'none';
  document.getElementById('subjectSkipBaselineBtn').style.display  = 'none';
  document.getElementById('subjectSkipPassBtn').style.display      = 'none';
  document.getElementById('subjectSkipFailBtn').style.display      = 'none';
  document.getElementById('startSubjectExperienceBtn').style.display     = '';
  document.getElementById('startSubjectExperienceDemoBtn').style.display = '';
  document.getElementById('subjectExperienceStageSelect').style.display  = 'none';
  document.getElementById('startBtn').style.display = '';
  ['categoryGroup', 'scaleGroup', 'directionGroup', 'modeGroup'].forEach(id => {
    document.getElementById(id).style.display = '';
  });
  // 「正解判定方式」「記録の有無」は管理者専用の欄なので、現在の権限に応じて表示を再計算する
  // （検証モード中に隠していた場合、単に表示に戻すと一般アカウントにも見えてしまうため）
  updateStepHoldModeVisibility();
  initPracticeSaveHistoryUI();
}

// このアカウントが被験者アカウントかどうかを判定し、対象なら練習設定画面から
// 音階・方向・モード・テンポの選択肢を隠して、ロードマップの現在のステップを自動でセットする。
// 対象でない場合は、通常の選択画面に戻す
async function initSubjectPractice() {
  const isSubject = !!(currentUser && currentUser.is_subject === 'yes');
  if (!isSubject) {
    resetToNormalPracticeSetup();
    return;
  }

  // 初めてログインした被験者には、練習を始める前にチュートリアルを自動で見せる
  if (currentUser.has_seen_tutorial !== 'yes') {
    openSubjectTutorial();
  }

  const data = await getSubjectAssignment(currentUser.id);
  if (!data || !data.steps || data.steps.length === 0) {
    // 割り当てがまだ無い場合は、通常の選択画面にフォールバックする
    resetToNormalPracticeSetup();
    return;
  }

  subjectProtocolActive   = true;
  adminExperiencing       = false;
  subjectRoadmapSteps     = data.steps;
  subjectRoadmapIndex     = Math.min(data.current_step, subjectRoadmapSteps.length);
  subjectStagePhase       = data.stage_phase || 'baseline';
  subjectLastWrongEntries = [];
  // 音階・カテゴリーは常に固定（被験者が選ぶ必要はない）。方向・モード・テンポは
  // フェーズ次第（事前演奏／テスト演奏は固定、自由練習は自由）なのでapplySubjectRoadmapStep()が管理する
  document.getElementById('categoryGroup').style.display = 'none';
  document.getElementById('scaleGroup').style.display    = 'none';

  if (subjectRoadmapIndex >= subjectRoadmapSteps.length) {
    showSubjectRoadmapComplete(); // 前回のログインまでに、既に6つすべて合格していた場合
    return;
  }

  document.getElementById('subjectSessionEndInfo').style.display  = 'none';
  document.getElementById('subjectProtocolInfo').style.display = 'block';
  applySubjectRoadmapStep();
}

// ===========================
// 被験者向けチュートリアル
// ===========================
// 決まった練習フロー（6音階を順番に・音階ごとに事前演奏→自由練習→テスト演奏）だけを
// 簡潔に説明する。操作方法（音符/指板表示の切替など）は対象外（被験者本人がその場で見て分かるため）
const SUBJECT_TUTORIAL_SLIDES = [
  {
    title: '👋 この練習について',
    body: 'このアプリでは、研究のために決められた方法で音階の練習を行います。練習する音階や順番は、あなたが選ぶ必要はありません。',
  },
  {
    title: '📅 4日間にわたって練習します',
    body: '1日に2つの音階を練習します。全部で8つの音階を4日かけて順番に進みます。',
  },
  {
    title: '🎵 まず「事前演奏」を1回行います',
    body: '音階ごとに、まず決まったテンポで1回演奏してもらいます。演奏の前に「楽譜を確認する」で音の並びを確認できます。',
  },
  {
    title: '🎻 「アプリ練習あり」の音階では練習できます',
    body: '一部の音階は事前演奏のあとに自由練習ができます。方向・モード・テンポを自由に設定して練習できます。準備ができたら「✅ テストに進む」を押してください。',
  },
  {
    title: '🥁 最後に「テスト演奏」を行います',
    body: '音階を決まったテンポで演奏します。結果にかかわらず自動的に次へ進みます。',
  },
  {
    title: '🌙 今日のセッション終了',
    body: '1日分の2音階が終わると「今日のセッション終了」と表示されます。次回またログインして続きを練習してください。',
  },
];
let subjectTutorialIndex = 0;

// チュートリアルを開く（初回ログイン時に自動で呼ばれる。設定タブの「チュートリアルを見る」からも呼べる）
function openSubjectTutorial() {
  subjectTutorialIndex = 0;
  renderSubjectTutorialSlide();
  document.getElementById('subjectTutorialOverlay').style.display = 'flex';
}

function renderSubjectTutorialSlide() {
  const slide   = SUBJECT_TUTORIAL_SLIDES[subjectTutorialIndex];
  const isFirst = subjectTutorialIndex === 0;
  const isLast  = subjectTutorialIndex === SUBJECT_TUTORIAL_SLIDES.length - 1;

  document.getElementById('subjectTutorialTitle').textContent = slide.title;
  document.getElementById('subjectTutorialBody').textContent  = slide.body;
  document.getElementById('subjectTutorialProgress').textContent =
    `${subjectTutorialIndex + 1} / ${SUBJECT_TUTORIAL_SLIDES.length}`;
  document.getElementById('subjectTutorialBackBtn').style.display  = isFirst ? 'none' : '';
  document.getElementById('subjectTutorialNextBtn').style.display  = isLast ? 'none' : '';
  document.getElementById('subjectTutorialStartBtn').style.display = isLast ? '' : 'none';
}

// チュートリアルを閉じる。被験者がまだ既読でなければ、サーバーに既読を記録する
// （次回ログイン以降は自動表示しなくなる。設定タブのボタンからはいつでも見返せる）
async function closeSubjectTutorial() {
  document.getElementById('subjectTutorialOverlay').style.display = 'none';
  if (currentUser && currentUser.has_seen_tutorial !== 'yes') {
    currentUser.has_seen_tutorial = 'yes';
    try {
      await markSubjectTutorialSeen();
    } catch (err) {
      // 既読の保存に失敗しても、閉じる操作自体は妨げない（次回ログイン時にまた出るだけ）
    }
  }
}

document.getElementById('subjectTutorialNextBtn').addEventListener('click', () => {
  subjectTutorialIndex = Math.min(subjectTutorialIndex + 1, SUBJECT_TUTORIAL_SLIDES.length - 1);
  renderSubjectTutorialSlide();
});
document.getElementById('subjectTutorialBackBtn').addEventListener('click', () => {
  subjectTutorialIndex = Math.max(subjectTutorialIndex - 1, 0);
  renderSubjectTutorialSlide();
});
document.getElementById('subjectTutorialStartBtn').addEventListener('click', closeSubjectTutorial);
document.getElementById('subjectTutorialSkipBtn').addEventListener('click', closeSubjectTutorial);

// 設定タブの「📖 チュートリアルを見る」ボタン：既読状態に関わらず、いつでも見返せる
document.getElementById('showSubjectTutorialBtn').addEventListener('click', openSubjectTutorial);

// 登録済みの音階から16ステップのロードマップを仮に組み立てる（検証モード用）。
// サーバー側の auto-generation と同じ構造：Phase1（独自練習）× 8 + Phase2（アプリ練習）× 8
function buildPlaceholderRoadmap(direction, bpm) {
  const allScales = [];
  Object.keys(scalesData.categories || {}).forEach(categoryKey => {
    const scales = getScalesForCategory(categoryKey);
    Object.keys(scales).forEach(scaleId => {
      allScales.push({ category_key: categoryKey, scale_id: parseInt(scaleId, 10) });
    });
  });
  allScales.sort((a, b) => a.scale_id - b.scale_id);
  if (allScales.length === 0) return [];

  const steps = [];
  for (let phase = 0; phase < 2; phase++) {
    const wp = phase === 0 ? 'no' : 'yes';
    const s1 = allScales[(phase * 2)     % allScales.length];
    const s2 = allScales[(phase * 2 + 1) % allScales.length];
    for (let day = 0; day < 4; day++) {
      const isLastOverall = phase === 1 && day === 3;
      steps.push({ step_order: steps.length, category_key: s1.category_key, scale_id: s1.scale_id, direction, bpm, with_practice: wp, session_end: 'no' });
      steps.push({ step_order: steps.length, category_key: s2.category_key, scale_id: s2.scale_id, direction, bpm, with_practice: wp, session_end: isLastOverall ? 'no' : 'yes' });
    }
  }
  return steps;
}

// 検証モードで使うロードマップを組み立てる。「設定」タブで音階が指定されていれば
// それをそのまま使い、未設定なら登録済みの音階から自動で仮に選ぶ
function buildVerifyModeRoadmap(direction, bpm) {
  if (verifyModeScaleSteps.length === 0) return buildPlaceholderRoadmap(direction, bpm);

  return verifyModeScaleSteps.map((s, i) => ({
    step_order: i, category_key: s.category_key, scale_id: s.scale_id, direction, bpm,
    with_practice: s.with_practice || 'yes',
    session_end:   s.session_end   || 'no'
  }));
}

// 管理者が「検証モード」タブの「ロードマップを表示する」「デモで体験する」を押したときの処理。
// アカウントは作らず、「設定」タブの検証モード設定欄で決めた練習タイプ・テンポのまま、
// 被験者と同じ6音階のロードマップを組み立てて、ステージ選択画面（丸をクリックして選ぶ）を表示する。
// useDemo=true の場合は、以後の練習でマイクの代わりにDemoPitchSource（デモタブと同じ
// シミュレート音）を使う（マイク無しで管理者だけが一連の流れを確認できるようにするため）
async function openVerifyModeStageSelectScreen(useDemo) {
  const errorEl = document.getElementById('subjectExperienceError');
  errorEl.style.display = 'none';

  // 被験者アカウントが選択されていればそのロードマップを使用する
  const subjectId = parseInt(document.getElementById('verifySubjectSelect').value, 10) || 0;
  let roadmap;
  if (subjectId) {
    try {
      const assignment = await getSubjectAssignment(subjectId);
      roadmap = (assignment?.steps || []).map((s, i) => ({ ...s, step_order: i }));
    } catch (e) {
      errorEl.textContent   = 'ロードマップの取得に失敗しました';
      errorEl.style.display = 'block';
      return;
    }
  } else {
    roadmap = buildVerifyModeRoadmap(verifyModeDirection, verifyModeBpm);
  }

  if (roadmap.length === 0) {
    errorEl.textContent   = '音階が1つも登録されていません。先に音階を追加してください';
    errorEl.style.display = 'block';
    return;
  }

  adminExperiencing       = true;
  subjectProtocolActive   = true;
  subjectRoadmapSteps     = roadmap;
  subjectRoadmapIndex     = 0;
  verifyModeClearedStages = new Set();
  verifyModeDemoMode      = !!useDemo;

  // 本物の被験者と同じく、練習タブの設定画面から音階・方向・モードの選択肢を隠す。
  // 「正解判定方式」「記録の有無」（管理者用）も、設定タブの検証モード設定で決めた値を使うため隠す。
  // これにより、練習を中断した際などに通常の練習設定画面に見えてしまわないようにする
  ['categoryGroup', 'scaleGroup', 'directionGroup', 'modeGroup', 'stepHoldModeGroup', 'practiceSaveHistoryGroup'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });

  document.getElementById('startSubjectExperienceBtn').style.display     = 'none';
  document.getElementById('startSubjectExperienceDemoBtn').style.display = 'none';
  document.getElementById('subjectExperienceStageSelect').style.display  = 'block';
  renderVerifyModeStageTrack();
}

document.getElementById('startSubjectExperienceBtn').addEventListener('click', () => {
  openVerifyModeStageSelectScreen(false);
});
document.getElementById('startSubjectExperienceDemoBtn').addEventListener('click', () => {
  openVerifyModeStageSelectScreen(true);
});

// 検証モードのデイ選択画面：フェーズ×Dayのグリッドを描画する
function renderVerifyModeStageTrack() {
  const container = document.getElementById('subjectExperienceStageTrack');
  if (!container || subjectRoadmapSteps.length === 0) return;

  const wp = subjectRoadmapSteps[0]?.with_practice;
  const groupLabel = wp === 'yes' ? 'アプリ練習あり' : 'アプリ練習なし';

  // ペア1(steps 0-7) と ペア2(steps 8-15) の2ペア × 4日
  const pairs = [
    { label: 'ペア 1', start: 0 },
    { label: 'ペア 2', start: 8 },
  ];

  let html = `<div class="verify-day-grid"><p class="verify-group-label">${groupLabel}</p>`;
  pairs.forEach(({ label, start }) => {
    if (start >= subjectRoadmapSteps.length) return;
    const s1 = subjectRoadmapSteps[start];
    const s2 = subjectRoadmapSteps[start + 1];
    const n1 = getScalesForCategory(s1?.category_key)[String(s1?.scale_id)]?.name || '—';
    const n2 = s2 ? (getScalesForCategory(s2.category_key)[String(s2.scale_id)]?.name || '—') : '';
    html += `<div class="verify-day-phase"><h4>${label}：${n1} / ${n2}</h4><div class="verify-day-row">`;
    for (let d = 0; d < 4; d++) {
      const stepIdx = start + d * 2;
      if (stepIdx >= subjectRoadmapSteps.length) break;
      const cleared = verifyModeClearedStages.has(stepIdx) && verifyModeClearedStages.has(stepIdx + 1);
      const cls = cleared ? ' verified-day-cleared' : '';
      html += `<button type="button" class="verify-day-btn${cls}" data-step="${stepIdx}">
        <span class="verify-day-label">Day ${d + 1}</span>
        ${cleared ? '<span class="verify-day-check">✓</span>' : ''}
      </button>`;
    }
    html += '</div></div>';
  });
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.verify-day-btn').forEach(btn => {
    btn.addEventListener('click', () => startVerifyModeStage(parseInt(btn.dataset.step, 10)));
  });
}

// ステージ選択画面で丸を1つクリックしたときの処理：そのステージ（音階）の練習を、
// デモモードと同じく設定画面を経由せずそのまま開始する
// 検証モード用：タブを切り替えずに、練習タブの中身（設定／練習／結果カード）を
// 「検証モード」タブの中にそのまま表示する。「練習」タブに移動する手間を無くすための仕組み
// （中身自体は練習タブと共用のため、タブの中身だけ出して、アクティブなタブ表示は「検証モード」のままにする）
function showVerifyModePracticeArea() {
  document.getElementById('tab-practice').style.display = '';
  document.getElementById('subjectExperienceStageSelect').style.display = 'none';
}

// 検証モード用：練習タブの中身を隠し、ステージ選択（ロードマップの丸）に戻す
function hideVerifyModePracticeArea() {
  document.getElementById('tab-practice').style.display = 'none';
  document.getElementById('subjectExperienceStageSelect').style.display = 'block';
}

function startVerifyModeStage(stageIndex) {
  subjectRoadmapIndex     = stageIndex;
  subjectStagePhase       = 'baseline'; // ステージを選ぶたび、事前演奏からやり直す
  subjectLastWrongEntries = [];
  returnToSubjectSetupScreen(); // setupCardを確実に表示（前ステージのcompleteCardで隠れている場合がある）
  applySubjectRoadmapStep();
  document.getElementById('subjectProtocolInfo').style.display = 'block';
  showVerifyModePracticeArea();
  // ここではまだ練習を始めない。案内パネルの内容を確認し、管理者自身が
  // 「▶ 練習開始」を押したタイミングでカウントダウンが始まるようにする
}

// 練習を終えた（合格した）あと、検証モードのステージ選択画面に戻る
function returnToVerifyModeStageSelect() {
  document.getElementById('practiceCard').style.display    = 'none';
  document.getElementById('completeCard').style.display    = 'none';
  document.getElementById('subjectProtocolInfo').style.display = 'none';
  subjectLastWrongEntries = [];
  hideVerifyModePracticeArea();
  renderVerifyModeStageTrack();
}

// 検証モードの結果画面に「▶ 確認して次へ」ボタンを出す。本物の被験者と違い、
// 検証モードは自動では進まず、管理者がこのボタンを押すまで結果画面に留まる
function showVerifyModeContinueBtn(action) {
  verifyModeContinueAction = action;
  document.getElementById('verifyModeContinueBtn').style.display = 'block';
}

document.getElementById('verifyModeContinueBtn').addEventListener('click', () => {
  document.getElementById('verifyModeContinueBtn').style.display = 'none';
  const action = verifyModeContinueAction;
  verifyModeContinueAction = null;
  if (action) action();
});

// 「検証モードを終了する」ボタン：練習タブの設定画面を通常表示に戻し、
// 検証モードタブも「ロードマップを表示する」ボタンだけの最初の状態に戻す
document.getElementById('exitSubjectExperienceBtn').addEventListener('click', () => {
  resetToNormalPracticeSetup();
});

document.getElementById('exitVerifyFromPracticeBtn').addEventListener('click', () => {
  resetToNormalPracticeSetup();
});

// 独自練習後「練習できました・事後計測に進む」を押したときの処理
document.getElementById('subjectSelfPracticeReadyBtn').addEventListener('click', async () => {
  document.getElementById('subjectSelfPracticeReadyBtn').style.display = 'none';
  subjectStagePhase = 'test';
  await setSubjectStagePhase('test');
  applySubjectRoadmapStep();
  returnToSubjectSetupScreen();
});

// 自由練習フェーズで「✅ テストに進む」を押したときの処理：
// フェーズをテスト演奏（test）に切り替え、音階・方向・モード・テンポを再び固定する
document.getElementById('subjectProceedToTestBtn').addEventListener('click', async () => {
  subjectStagePhase = 'test';
  if (!adminExperiencing) await setSubjectStagePhase('test');
  applySubjectRoadmapStep();
});

// 自由練習フェーズで「🎯 苦手な音を練習する」を押したときの処理：
// 直前のテスト演奏で×・△だった音だけを対象に1音ずつモードを開始する（任意の練習項目であり、強制ではない）
document.getElementById('subjectWeakNotePracticeBtn').addEventListener('click', () => {
  if (subjectLastWrongEntries.length === 0) return;
  startSubjectStepRetry(subjectLastWrongEntries);
});

// 「苦手な音を練習する」が使えることを知らせるバナーを閉じる（練習項目自体は消えない）
document.getElementById('subjectWeakNoteBannerDismissBtn').addEventListener('click', () => {
  document.getElementById('subjectWeakNoteBanner').style.display = 'none';
});

// 検証モード専用：実際に演奏せず、各画面・合否パターンをすぐ確認するためのスキップボタン
// （練習設定画面と、練習中の画面の両方に同じボタンがあるので、まとめて登録する）
[
  ['subjectSkipBaselineBtn', 'baseline'], ['practiceSkipBaselineBtn', 'baseline'],
  ['subjectSkipPassBtn', 'pass'],         ['practiceSkipPassBtn', 'pass'],
  ['subjectSkipFailBtn', 'fail'],         ['practiceSkipFailBtn', 'fail'],
].forEach(([id, outcome]) => {
  document.getElementById(id).addEventListener('click', () => skipSubjectPerformance(outcome));
});

// 検証モード専用：練習設定画面から、ステージ選択画面（ロードマップの丸）に戻る。
// 検証モード自体の終了（「✕ 検証モードを終了する」）は、この先のステージ選択画面でのみ行える
document.getElementById('backToStageSelectBtn').addEventListener('click', () => {
  if (subjectAutoAdvanceTimer) { clearTimeout(subjectAutoAdvanceTimer); subjectAutoAdvanceTimer = null; }
  document.getElementById('verifyModeContinueBtn').style.display = 'none';
  returnToVerifyModeStageSelect();
});

// ロードマップ（丸をステージ、線でつないだ進行マップ）をcontainerIdの欄に描画する。
// subjectRoadmapIndexより手前は「クリア済み」の丸、ちょうどそこは「挑戦中」の丸、
// それより先は「未挑戦」の丸として塗り分け、丸の間の線もクリア済みの区間だけ色を付ける
function renderRoadmapTrack(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (subjectRoadmapSteps.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  subjectRoadmapSteps.forEach((step, i) => {
    const isCleared = i < subjectRoadmapIndex;
    const isCurrent  = i === subjectRoadmapIndex;
    const state = isCleared ? 'cleared' : (isCurrent ? 'current' : 'locked');
    const noPractice = step && step.with_practice === 'no';
    const npClass = noPractice ? ' no-practice' : '';
    const npTitle = noPractice ? '（支援なし）' : '';
    html += `<div class="roadmap-circle ${state}${npClass}" title="音階${i + 1}${npTitle}">${isCleared ? '✓' : (i + 1)}</div>`;
    if (i < subjectRoadmapSteps.length - 1) {
      html += `<div class="roadmap-line ${isCleared ? 'cleared' : ''}"></div>`;
    }
  });
  container.innerHTML = html;
}

// 今のロードマップのステップ（subjectRoadmapIndex）とフェーズ（subjectStagePhase）を、
// 練習設定フォームに反映し、既存のstartPractice()がそのまま使えるようにする。
// ・事前演奏（baseline）／テスト演奏（test）：音階・方向・モード・テンポをすべて固定し、選択肢を隠す
// ・自由練習（practice）：音階・カテゴリーだけ固定し、方向・モード・テンポは被験者が自由に選べるようにする
// あわせて案内パネルの文言・「テストに進む」「苦手な音を練習する」ボタンの表示・ロードマップ表示も更新する
function applySubjectRoadmapStep() {
  const step = subjectRoadmapSteps[subjectRoadmapIndex];
  const noPractice = step && step.with_practice === 'no';

  // 支援なしステップで誤って practice フェーズになっていたら test に補正する
  if (noPractice && subjectStagePhase === 'practice') {
    subjectStagePhase = 'test';
  }

  document.getElementById('categorySelect').value = step.category_key;
  populateScaleSelect();
  document.getElementById('scaleSelect').value = String(step.scale_id);

  const isFixedPhase = subjectStagePhase === 'baseline' || subjectStagePhase === 'test';

  document.querySelector(`input[name="direction"][value="${step.direction}"]`).checked = true;
  document.getElementById('bpmRange').value = step.bpm;
  document.getElementById('bpmValue').textContent = step.bpm;

  if (isFixedPhase) {
    document.querySelector('input[name="mode"][value="tempo"]').checked = true;
    ['directionGroup', 'modeGroup', 'bpmGroup'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
  } else {
    // 自由練習の開始時点では、キリのいい基準としてモードは「1音ずつ」をデフォルトにしておく
    // （方向・テンポはこのステージの既定値のまま。被験者はここからどれでも自由に変更できる）
    document.querySelector('input[name="mode"][value="step"]').checked = true;
    document.getElementById('directionGroup').style.display = '';
    document.getElementById('modeGroup').style.display       = '';
    document.getElementById('bpmGroup').style.display        = 'none';
    updateStepHoldModeVisibility();
  }

  // 練習タブの設定画面内にある案内パネルに、現在のステージ・フェーズの詳細を表示する
  // （本物の被験者はここで次の内容を確認し、管理者の検証モードはステージを選んだ直後にここで
  //  内容を確認してから、自分のタイミングで「▶ 練習開始」を押して始められる）
  const dirLabels = { up: '上行', down: '下行', updown: '上下', arpeggio: 'アルペジオ' };
  const scaleName = getScalesForCategory(step.category_key)[String(step.scale_id)]?.name || '';
  const dirLabel  = dirLabels[step.direction] || step.direction;
  const phaseLabels = { baseline: '事前演奏', practice: '自由練習', test: 'テスト演奏' };

  // グループ・音階ブロック・日数を表示に反映
  const { scalePair: pdPair, day: pdDay } = subjectStepToPhaseDay(subjectRoadmapIndex);
  const groupDesc = step.with_practice === 'yes' ? 'アプリ練習あり' : 'アプリ練習なし';
  document.getElementById('subjectGroupBadge').textContent         = groupDesc;
  document.getElementById('subjectDayBadge').textContent           = `ペア${pdPair} · Day ${pdDay} / 4`;
  document.getElementById('subjectPhaseLabel').textContent         = phaseLabels[subjectStagePhase] || '';
  document.getElementById('subjectScaleDisplay').textContent       = `${scaleName}　${dirLabel}`;
  document.getElementById('subjectProtocolStepNum').textContent    = subjectRoadmapIndex + 1;
  document.getElementById('subjectProtocolStepTotal').textContent  = subjectRoadmapSteps.length;

  // 五線譜（横スクロール）
  const staffEl   = document.getElementById('subjectStaffInner');
  const staffWrap = document.getElementById('subjectStaffScroll');
  const staffOpts = document.getElementById('staffOptsRow');
  if (staffEl && staffWrap) {
    const staffNotes    = buildPracticeNotes(step.category_key, String(step.scale_id), step.direction);
    const colorByString = step.with_practice === 'yes';
    const scaleData     = scalesData?.categories?.[step.category_key]?.scales?.[String(step.scale_id)];
    const keySig        = scaleData?.key_sig || {};
    if (staffNotes && staffNotes.length > 0) {
      window._currentStaffNotes    = staffNotes;
      window._currentStaffColor    = colorByString;
      window._currentStaffKeySig   = keySig;
      window._currentStaffWithPrac = step.with_practice === 'yes';
      renderSubjectStaff();
      staffWrap.style.display = '';
      if (staffOpts) {
        staffOpts.style.display = '';
        // アプリ練習ありのみ指番号トグルを表示
        const fingerBtn = document.getElementById('staffFingerToggle');
        if (fingerBtn) fingerBtn.style.display = colorByString ? '' : 'none';
      }
    } else {
      staffWrap.style.display = 'none';
      if (staffOpts) staffOpts.style.display = 'none';
    }
  }

  const descEl = document.getElementById('subjectProtocolDesc');
  if (subjectStagePhase === 'baseline') {
    const nextDesc = noPractice ? '演奏後、すぐにテスト演奏に進みます（アプリ練習なし）。' : 'その後、アプリで練習できます。';
    descEl.textContent =
      `音階「${scaleName}」（${dirLabel}）を${step.bpm} BPMのテンポで1回演奏します。${nextDesc}`;
  } else if (subjectStagePhase === 'test') {
    const nextNote = adminExperiencing
      ? 'ステージ選択画面に戻ります。'
      : (step.session_end === 'yes' ? '演奏後、今日のセッションはここで終了です。' : '演奏後、次の音階に進みます。');
    descEl.textContent =
      `音階「${scaleName}」（${dirLabel}）を${step.bpm} BPMのテンポで演奏します。${nextNote}`;
  } else {
    descEl.textContent =
      `音階「${scaleName}」は固定ですが、方向・モード・テンポは自由に設定して練習できます。準備ができたら「✅ テストに進む」を押してください。`;
  }

  document.getElementById('subjectSheetMusicBtn').style.display =
    subjectStagePhase === 'baseline' ? '' : 'none';

  document.getElementById('subjectProceedToTestBtn').style.display =
    (subjectStagePhase === 'practice' && !noPractice) ? '' : 'none';
  const hasWrongEntries = subjectStagePhase === 'practice' && subjectLastWrongEntries.length > 0;
  document.getElementById('subjectWeakNotePracticeBtn').style.display = hasWrongEntries ? '' : 'none';
  document.getElementById('subjectWeakNoteBanner').style.display      = hasWrongEntries ? '' : 'none';

  updateSubjectSkipControls();

  document.getElementById('startBtn').disabled = false;
}

// ロードマップの6音階すべてに合格したときの表示。
// 本物の被験者は練習タブの設定画面に、管理者の体験は「検証モード」タブに、
// それぞれ「お疲れ様でした」の案内（全部クリア済みのロードマップ）を出す
function showSubjectRoadmapComplete() {
  document.getElementById('practiceCard').style.display = 'none';
  document.getElementById('completeCard').style.display = 'none';

  document.getElementById('setupCard').style.display     = 'block';
  document.getElementById('subjectProtocolInfo').style.display   = 'none';
  document.getElementById('subjectRoadmapDoneInfo').style.display = 'block';
  document.getElementById('startBtn').style.display = 'none';
}

// 今日のセッション終了画面を表示する（session_end='yes' のステップ完了後）
function showSubjectSessionEndScreen() {
  document.getElementById('practiceCard').style.display    = 'none';
  document.getElementById('completeCard').style.display    = 'none';
  document.getElementById('setupCard').style.display       = 'block';
  document.getElementById('subjectProtocolInfo').style.display    = 'none';
  document.getElementById('subjectSessionEndInfo').style.display  = 'block';

  // 完了したステップ（advance後なので次ステップ番号）からフェーズ・日数を表示
  const doneIdx = Math.max(0, subjectRoadmapIndex - 1);
  const { scalePair: epPair, day: epDay } = subjectStepToPhaseDay(doneIdx);
  document.getElementById('subjectSessionEndDesc').innerHTML =
    `ペア${epPair} · Day ${epDay} の練習が完了しました。<br>次回またログインして続きを練習してください。`;
  document.getElementById('startBtn').style.display = 'none';
}

// 楽譜（音の並び）をプレビューオーバーレイで表示する（事前演奏の前に確認できる）
function previewSheetMusic() {
  const step = subjectRoadmapSteps[subjectRoadmapIndex];
  if (!step) return;

  const notes = buildPracticeNotes(step.category_key, String(step.scale_id), step.direction);
  if (!notes || notes.length === 0) return;

  const tbody = document.getElementById('sheetMusicPreviewBody');
  tbody.innerHTML = notes.map((n, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${n.string || ''}</td>
      <td>${n.position || ''}</td>
    </tr>
  `).join('');

  document.getElementById('sheetMusicPreviewOverlay').style.display = 'flex';
}

// 管理者にだけ「結果画面の設定」カードを表示し、現在の設定をラジオボタンに反映する
function initResultDisplaySetting() {
  const card = document.getElementById('resultDisplaySettingCard');
  if (!currentUser || currentUser.role !== 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.querySelectorAll('input[name="resultDisplaySetting"]').forEach(radio => {
    radio.checked = radio.value === resultDisplayMode;
  });
}

// 管理者にだけ「デモ」タブを表示する。
// デモモードの値はサーバーには保存せず、他のユーザーには一切影響しない、その場限りの設定
function initDemoModeUI() {
  document.getElementById('demoTabBtn').style.display =
    (currentUser && currentUser.role === 'admin') ? '' : 'none';
}

// 管理者にだけ「検証」タブを表示する
function initSubjectExperienceTab() {
  document.getElementById('subjectExperienceTabBtn').style.display =
    (currentUser && currentUser.role === 'admin') ? '' : 'none';
}

// 管理者・研究者に「管理」タブを表示する（管理者は全機能、研究者は研究データのみ）
function initAdminTab() {
  const isAdmin      = currentUser && currentUser.role === 'admin';
  const isResearcher = currentUser && currentUser.role === 'researcher';
  document.getElementById('adminTabBtn').style.display = (isAdmin || isResearcher) ? '' : 'none';
  // アカウント管理・ロードマップ編集は管理者のみ
  ['subjectAccountCard', 'researcherAccountCard', 'signupSettingCard', 'accountListCard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isAdmin ? '' : 'none';
  });
  if (isAdmin) {
    populateSubjectCreateScaleSelects();
    populateVerifySubjectSelect();
  }
}

// 検証モードの被験者アカウントセレクトを被験者一覧で初期化する
function populateVerifySubjectSelect() {
  const sel = document.getElementById('verifySubjectSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">選択なし（上の設定を使用）</option>' +
    allProfilesCache.filter(p => p.is_subject === 'yes').map(p =>
      `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');
}

// 管理者にだけ、通常の練習モードにも「この結果を記録に残すか」のトグルを表示する
// （一般ユーザーは常に記録する従来通りの挙動のまま。ラジオ自体は既定で「記録する」なので、
//  非表示のままでもcompletePractice()の判定には影響しない）
function initPracticeSaveHistoryUI() {
  document.getElementById('practiceSaveHistoryGroup').style.display =
    (currentUser && currentUser.role === 'admin') ? '' : 'none';
}

// 「記録の有無」「正解判定方式（保持判定）」を既定値に戻す。
// この2つはただのHTMLラジオボタンなので、非表示にしても選択状態はDOMに残り続けてしまう。
// そのままだと、同じブラウザタブ内で管理者が変更した値が、次にログインした別アカウント
// （一般ユーザーやゲスト）にも黙って適用され続けてしまうため、ログイン/ログアウトのたびに必ず呼ぶ
function resetAdminOnlyPracticeSettings() {
  const saveYes = document.querySelector('input[name="practiceSaveHistory"][value="yes"]');
  if (saveYes) saveYes.checked = true;
  const holdInstant = document.querySelector('input[name="stepHoldMode"][value="instant"]');
  if (holdInstant) holdInstant.checked = true;
}

// チューナーとFFTは廃止（removed）



// 管理者にだけ「被験者アカウント作成」カードを表示する（設定タブ）
function initSubjectAccountCreation() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('subjectAccountCard').style.display = isAdmin ? 'block' : 'none';
}

// 管理者にだけ「研究者アカウント作成」カードを表示する
function initResearcherAccountCreation() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('researcherAccountCard').style.display = isAdmin ? 'block' : 'none';
}

// 管理者・研究者にだけ統計タブのアカウントセレクタを表示し、プロフィール一覧を反映する
let allProfilesCache = []; // 統計タブのセレクタ用プロフィールキャッシュ

async function initStatsProfileSelector() {
  const canAccess = currentUser && (currentUser.role === 'admin' || currentUser.role === 'researcher');
  document.getElementById('statsProfileSelectorCard').style.display = canAccess ? '' : 'none';
  document.getElementById('statsRecordEditCard').style.display      = canAccess ? '' : 'none';
  if (!canAccess) return;

  try {
    allProfilesCache = await getProfiles();
  } catch (_) {}
  renderStatsProfileOptions();
}

function renderStatsProfileOptions() {
  const sel  = document.getElementById('statsProfileSelect');
  // 被験者アカウントは個別に切り替えて閲覧する対象ではないため除外
  const list = allProfilesCache.filter(p => p.is_subject !== 'yes');

  sel.innerHTML = list.map(p =>
    `<option value="${p.id}"${p.id === currentProfileId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');

  // 現在選択中のIDがリストにない場合は先頭に合わせる
  if (list.length > 0 && !list.find(p => p.id === currentProfileId)) {
    sel.value = list[0].id;
  }
  updateStatsProfileNameLabel();
}

document.getElementById('statsSubjectOnlyCheck').addEventListener('change', renderStatsProfileOptions);

function updateStatsProfileNameLabel() {
  const sel   = document.getElementById('statsProfileSelect');
  const label = document.getElementById('statsProfileName');
  const opt   = sel.options[sel.selectedIndex];
  label.textContent = opt ? `表示中：${opt.text}` : '';
}

document.getElementById('statsProfileSwitchBtn').addEventListener('click', async () => {
  const sel = document.getElementById('statsProfileSelect');
  const id  = parseInt(sel.value, 10);
  if (!id || id === currentProfileId) return;
  currentProfileId = id;
  updateStatsProfileNameLabel();
  statsLoaded = false;
  await renderHistory();
  await renderStatsForCurrentProfile();
  await loadStatsResearchData();
  statsLoaded = true;
});

// 被験者アカウントは自分では削除できないようにする（代わりに管理者が「記録」タブの
// アカウント一覧から削除する）。被験者以外（管理者・一般アカウント）は従来通り自分で削除できる
function initAccountDeletionUI() {
  const isSubject = !!(currentUser && currentUser.is_subject === 'yes');
  document.getElementById('deleteAccountBtn').style.display         = isSubject ? 'none' : '';
  document.getElementById('subjectDeleteAccountNote').style.display = isSubject ? 'block' : 'none';
  document.getElementById('showSubjectTutorialBtn').style.display   = isSubject ? '' : 'none';
}

document.getElementById('subjectBpmRange').addEventListener('input', (e) => {
  document.getElementById('subjectBpmValue').textContent = e.target.value;
});

// 管理者にだけ「新規アカウント作成」カードを表示し、現在の設定をラジオボタンに反映する
function initSignupSetting() {
  const card = document.getElementById('signupSettingCard');
  if (!currentUser || currentUser.role !== 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.querySelectorAll('input[name="signupSetting"]').forEach(radio => {
    radio.checked = radio.value === signupEnabled;
  });
}

// 管理者が「新規アカウント作成」の許可・不許可を切り替えたら、サーバーに保存する
// （反映はログイン画面を次に表示したときから。管理者自身の「被験者アカウント作成」には影響しない）
document.querySelectorAll('input[name="signupSetting"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const errorEl = document.getElementById('signupSettingError');
    errorEl.style.display = 'none';
    try {
      await updateSettings({ signup_enabled: e.target.value });
      signupEnabled = e.target.value;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      initSignupSetting(); // 失敗したら選択状態を元に戻す
    }
  });
});

// 管理者にだけ「1音ずつモードの正解判定（管理者以外への適用）」カードを表示し、
// 現在の設定をラジオボタンに反映する
function initStepHoldGeneralSetting() {
  const card = document.getElementById('stepHoldGeneralSettingCard');
  if (!currentUser || currentUser.role !== 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  document.querySelectorAll('input[name="stepHoldGeneralSetting"]').forEach(radio => {
    radio.checked = radio.value === stepHoldGeneral;
  });
}

// 管理者がこの設定を切り替えたら、サーバーに保存する（反映は次に練習を開始したときから）
document.querySelectorAll('input[name="stepHoldGeneralSetting"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    const errorEl = document.getElementById('stepHoldGeneralSettingError');
    errorEl.style.display = 'none';
    try {
      await updateSettings({ step_hold_general: e.target.value });
      stepHoldGeneral = e.target.value;
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      initStepHoldGeneralSetting(); // 失敗したら選択状態を元に戻す
    }
  });
});

// ===========================
// 音階を追加（管理者用）：五線譜クリック入力
// ===========================
const SCALE_BUILDER_MIN_OFFSET = staffOffset('G3'); // クリック可能な下限（ヴァイオリンの最低音）
const SCALE_BUILDER_MAX_OFFSET = staffOffset('H6'); // クリック可能な上限（音名対応表の最高音）
const STAFF_STEP_LETTER = ['C', 'D', 'E', 'F', 'G', 'A', 'B']; // STAFF_LETTER_STEPの逆引き

let scaleBuilderPhase     = null; // null(未開始) | 'notes'(音階) | 'arpeggio'
let scaleBuilderNotes     = [];   // 確定済みの音階の音符
let scaleBuilderArpeggio  = [];   // 確定済みのアルペジオの音符
let scaleBuilderPending   = null; // { offset, accidental } クリックして仮配置中（未確定）の音
let scaleBuilderEditingId = null; // 音階一覧の「編集」から開始した場合、対象の音階ID（新規追加ならnull）
let scaleBuilderEditIndex = null; // リスト内の既存の音を編集中の場合、そのインデックス（新規追加・挿入ならnull）
let scaleBuilderInsertAt  = null; // 「＋」から挿入中の場合、挿入先のインデックス（末尾に追加ならnull）

// 音階の調号：音名（C〜B）ごとに、その音が常にどの臨時記号になるか（null/'s'/'f'）。
// 音符を置き始める前にここで設定しておくと、該当する音名はクリックした瞬間からその臨時記号で
// 仮登録される（例：ファとドを♯にしておけば、以後ファ・ドをクリックするとF♯・C♯になる）。
// 1音だけ例外にしたい場合は、仮配置パネルの「この音だけ臨時記号を変える」で個別に直せる
let scaleBuilderKeySignature = {};

// 管理者にだけ「音階を追加」カードと「音階一覧」ボタンを表示する（設定タブ）
function initScaleBuilder() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('scaleBuilderCard').style.display   = isAdmin ? 'block' : 'none';
  document.getElementById('scaleListToggleBtn').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('scaleListCard').style.display      = 'none';
}

// 五線譜上のオフセット(段数)が、どの幹音（♯♭なしの基本の音名）にあたるかを返す（'C'〜'B'）
function scaleBuilderNaturalLetter(offset) {
  const E4_STEP = 4 * 7 + STAFF_LETTER_STEP.E; // =30（E4を基準0とする換算に使う定数）
  const total   = offset + E4_STEP;
  return STAFF_STEP_LETTER[((total % 7) + 7) % 7];
}

// 五線譜上のオフセット(段数)と臨時記号から、notes.json用のキー（例："Fs4"）を組み立てる。
// 実在しない組み合わせ（例：ミの♯、シの♯）ならnullを返す
function scaleBuilderNoteKey(offset, accidental) {
  const E4_STEP = 4 * 7 + STAFF_LETTER_STEP.E; // =30（E4を基準0とする換算に使う定数）
  const total   = offset + E4_STEP;
  const octave  = Math.floor(total / 7);
  const letter  = scaleBuilderNaturalLetter(offset);
  const key = letter === 'B'
    ? (accidental === 'f' ? `Bf${octave}` : accidental === 's' ? null : `H${octave}`) // シ♯は存在しない
    : `${letter}${accidental || ''}${octave}`;
  return key && scalesData.notes[key] ? key : null;
}

// notes.json用のキー（例："Fs4"）から、臨時記号（'s'/'f'/null）だけを取り出す。
// 既存の音を編集し直すとき、五線上のオフセットと合わせて仮配置の初期状態を復元するのに使う
function scaleBuilderAccidentalFromKey(key) {
  const [, , accidentalChar] = key.match(/^([A-Za-z])([sf]?)(\d+)$/);
  return accidentalChar || null;
}

// ===========================
// 弦・指の予測（音を選んだときの初期値。確定前に管理者が自由に直せる）
// ===========================
const SCALE_BUILDER_STRING_ORDER = ['G弦', 'D弦', 'A弦', 'E弦'];

// 各弦の開放弦から、臨時記号なし（白鍵）の音に1〜4の指で届くまでの半音数。
// 例：D弦は開放=D、1の指=E(+2)、2の指=F(+3。ミ→ファは半音なので+1しか離れていない)、
// 3の指=G(+5)、4の指=A(+7)。これを「素の」指番号とし、半音1つ分低い／高い音は
// 「(低)」「(高)」付きの同じ指番号として予測する
const SCALE_BUILDER_FINGER_PLAIN_OFFSETS = {
  'G弦': { 1: 2, 2: 4, 3: 5, 4: 7 },
  'D弦': { 1: 2, 2: 3, 3: 5, 4: 7 },
  'A弦': { 1: 2, 2: 3, 3: 5, 4: 7 },
  'E弦': { 1: 1, 2: 3, 3: 5, 4: 7 },
};

// 指定した弦のうえで、開放弦から半音いくつ分のところかから、指の判定文字列を決める
// （開放弦／Nの指／Nの指(低)／Nの指(高)）。素の指と素の指のあいだが全音分空いている場合は、
// その半音を「下の指を半音上げた（高）」側として扱う
function scaleBuilderFingerLabel(stringName, semitoneOffset) {
  if (semitoneOffset <= 0) return '開放弦';

  const plains = SCALE_BUILDER_FINGER_PLAIN_OFFSETS[stringName];
  for (const finger of [1, 2, 3, 4]) {
    if (plains[finger] === semitoneOffset) return `${finger}の指`;
  }
  for (const finger of [1, 2, 3, 4]) {
    if (plains[finger] + 1 === semitoneOffset) return `${finger}の指(高)`;
  }
  for (const finger of [1, 2, 3, 4]) {
    if (plains[finger] - 1 === semitoneOffset) return `${finger}の指(低)`;
  }
  return '4の指(高)'; // 第一ポジションの範囲を超える音は、いちばん高いラベルで近似する（手動で直す想定）
}

// 音名（notes.jsonのキー）から、もっとも自然な弦・指の組み合わせを予測する。
// 「開放弦からの半音数がいちばん小さい弦」を選ぶ（＝いちばん低い指番号で届く弦）。
// あくまで初期値の予測であり、確定前に管理者が選び直すことを前提にしている
function predictFingering(noteKey) {
  const noteData = scalesData.notes[noteKey];
  if (!noteData) return null;

  let best = null;
  SCALE_BUILDER_STRING_ORDER.forEach(stringName => {
    const openFreq = scalesData.notes[FB_STRING_OPEN[stringName]].freq;
    const offset = Math.round(12 * Math.log2(noteData.freq / openFreq));
    if (offset < 0) return; // その弦では（開放弦より低く）届かない
    if (!best || offset < best.offset) best = { string: stringName, offset };
  });
  if (!best) return null;

  return { string: best.string, position: scaleBuilderFingerLabel(best.string, best.offset) };
}

// 指定した弦より1つ下の弦を返す（G弦より下は無いのでnull）
function scaleBuilderLowerString(stringName) {
  const idx = SCALE_BUILDER_STRING_ORDER.indexOf(stringName);
  return idx > 0 ? SCALE_BUILDER_STRING_ORDER[idx - 1] : null;
}

// 今入力中の音より前（挿入・編集中ならその手前まで）に、すでに折り返し点（最高音）が
// 確定済みかどうか。true なら今の音は下行側（頂点を過ぎたあと）であることを意味する
function scaleBuilderIsPastTurn() {
  const list = scaleBuilderPhase === 'notes' ? scaleBuilderNotes : scaleBuilderArpeggio;
  const upTo = scaleBuilderEditIndex !== null ? scaleBuilderEditIndex
             : scaleBuilderInsertAt !== null ? scaleBuilderInsertAt
             : list.length;
  return list.slice(0, upTo).some(entry => entry.turn);
}

// 仮配置中の音（scaleBuilderPending）の現在のオフセット・臨時記号から弦・指を予測し、
// 入力欄に反映する。実在しない音の位置のときは何もしない
function applyScaleBuilderFingeringPrediction() {
  if (!scaleBuilderPending) return;
  const { offset, accidental } = scaleBuilderPending;
  const key = scaleBuilderNoteKey(offset, accidental);
  if (!key) return;

  let predicted = predictFingering(key);
  if (!predicted) return;

  // 頂点（折り返し点）を過ぎた下行側では、開放弦ではなく「1つ下の弦の4の指」を予測する
  // （下りでも同じ弦を保って弾くのが一般的な運指のため）
  if (predicted.position === '開放弦' && scaleBuilderIsPastTurn()) {
    const lowerString = scaleBuilderLowerString(predicted.string);
    if (lowerString) predicted = { string: lowerString, position: '4の指' };
  }

  document.getElementById('scaleBuilderString').value   = predicted.string;
  document.getElementById('scaleBuilderPosition').value = predicted.position;
}

// 音階の調号ボタン（ド〜シ、各ボタンでナチュラル→♯→♭→ナチュラルと切り替える。
// シ♯は存在しないため、シのボタンだけナチュラル→♭→ナチュラルのみを巡回する）。
// ボタンの表示（例：「ファ♯」）を、今のscaleBuilderKeySignatureに合わせて更新する
const SCALE_BUILDER_LETTER_LABELS = { C: 'ド', D: 'レ', E: 'ミ', F: 'ファ', G: 'ソ', A: 'ラ', B: 'シ' };
function updateScaleBuilderKeySigButtons() {
  document.querySelectorAll('.scale-builder-keysig-btn').forEach(btn => {
    const letter    = btn.dataset.letter;
    const accidental = scaleBuilderKeySignature[letter] || null;
    const symbol     = accidental === 's' ? '♯' : accidental === 'f' ? '♭' : '';
    btn.textContent = `${SCALE_BUILDER_LETTER_LABELS[letter]}${symbol}`;
    btn.classList.toggle('active', !!accidental);
  });
}

document.querySelectorAll('.scale-builder-keysig-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const letter  = btn.dataset.letter;
    const cycle   = letter === 'B' ? [null, 'f'] : [null, 's', 'f'];
    const current = scaleBuilderKeySignature[letter] || null;
    scaleBuilderKeySignature[letter] = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    updateScaleBuilderKeySigButtons();
  });
});

// 仮配置パネルの「この音だけ臨時記号を変える」ボタン（♮／♯／♭）の見た目を、
// 今仮配置中の音の臨時記号に合わせる
function updateScaleBuilderOverrideButtons() {
  const current = scaleBuilderPending ? (scaleBuilderPending.accidental || null) : null;
  document.querySelectorAll('.scale-builder-override-option').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.accidental || null) === current);
  });
}

// 「この音だけ臨時記号を変える」ボタン：調号による既定値を、今仮配置中の音だけ上書きする
// （調号そのものは変えない。次に別の音名をクリックすれば、調号どおりの既定値に戻る）
document.querySelectorAll('.scale-builder-override-option').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!scaleBuilderPending) return;
    scaleBuilderPending.accidental = btn.dataset.accidental || null;
    renderScaleBuilderPendingNote();
    applyScaleBuilderFingeringPrediction();
  });
});

// 五線（正規の5本）と、その外側のガイド用加線をまとめて描画する（入力ステップに入ったら1回だけ呼ぶ）
function renderScaleBuilderGuides() {
  // 加線は五線と同じ偶数オフセット（-2,-4,...／10,12,...）にしか存在しない。
  // 奇数オフセットは線と線の「間」（空間）であり、そこに加線は引かない
  // （例：レ4(-1)やソ5(9)は間の音なので線は不要）
  const guideOffsets = [];
  for (let o = -2; o >= SCALE_BUILDER_MIN_OFFSET; o -= 2) guideOffsets.push(o);
  for (let o = 10; o <= SCALE_BUILDER_MAX_OFFSET; o += 2) guideOffsets.push(o);

  document.getElementById('scaleBuilderGuideLines').innerHTML = guideOffsets.map(o =>
    `<line class="scale-builder-guide-line" x1="40" y1="${staffY(o)}" x2="420" y2="${staffY(o)}"/>`
  ).join('');
  document.getElementById('scaleBuilderStaffLines').innerHTML = [0, 2, 4, 6, 8].map(o =>
    `<line class="staff-line" x1="40" y1="${staffY(o)}" x2="420" y2="${staffY(o)}"/>`
  ).join('');
}

// クリックした位置（画面座標）をSVGのローカル座標に変換し、一番近い五線譜の段（オフセット）に丸める
document.getElementById('scaleBuilderClickArea').addEventListener('click', (e) => {
  if (scaleBuilderPhase !== 'notes' && scaleBuilderPhase !== 'arpeggio') return;

  const svg = document.getElementById('scaleBuilderStaffSvg');
  const pt  = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const local = pt.matrixTransform(svg.getScreenCTM().inverse());

  let offset = Math.round((STAFF_BOTTOM_Y - local.y) / STAFF_STEP_PX);
  offset = Math.max(SCALE_BUILDER_MIN_OFFSET, Math.min(SCALE_BUILDER_MAX_OFFSET, offset));

  // パネルが既に開いている（編集中・挿入中・入力し直し）場合も、弦・指は音の高さに
  // 合わせて予測し直す（折り返し点の選択はそのまま）。初めて開く場合はパネル自体を表示する。
  // 臨時記号は、その音名に調号で設定してある臨時記号（無ければナチュラル）を既定値として使う
  const panelAlreadyOpen = document.getElementById('scaleBuilderNotePanel').style.display === 'block';
  const defaultAccidental = scaleBuilderKeySignature[scaleBuilderNaturalLetter(offset)] || null;
  scaleBuilderPending = { offset, accidental: defaultAccidental };
  renderScaleBuilderPendingNote();
  applyScaleBuilderFingeringPrediction();
  if (panelAlreadyOpen) {
    updateScaleBuilderConfirmBtnLabel();
  } else {
    showScaleBuilderPendingPanel();
  }
});

// 仮配置中の音符を、五線譜上に点線の輪郭で描画する（確定済みの音符とは見た目で区別する）
// まだ音を選んでいない（scaleBuilderPendingがnull）間は、五線譜に何も描かず、仮の音名も出さず、
// 確定ボタンも押せないようにする。実際にクリックして音を選んだら、点線の音符を五線譜に表示する
function renderScaleBuilderPendingNote() {
  const group      = document.getElementById('scaleBuilderPendingNote');
  const labelEl     = document.getElementById('scaleBuilderPendingLabel');
  const confirmBtn  = document.getElementById('scaleBuilderConfirmNoteBtn');

  updateScaleBuilderOverrideButtons();

  if (!scaleBuilderPending) {
    group.innerHTML = '';
    labelEl.textContent = '（五線譜をクリックして音を選んでください）';
    confirmBtn.disabled = true;
    return;
  }

  const { offset, accidental } = scaleBuilderPending;
  const y = staffY(offset);
  const x = 230;
  const ledgers = ledgerOffsets(offset).map(o => {
    const ly = staffY(o);
    return `<line class="note-ledger" x1="${x - 12}" y1="${ly}" x2="${x + 12}" y2="${ly}"/>`;
  }).join('');
  const accidentalGlyph = accidental === 's' ? '♯' : accidental === 'f' ? '♭' : '';
  const accidentalSvg = accidentalGlyph
    ? `<text class="note-accidental" x="${x - 13}" y="${y + 4}">${accidentalGlyph}</text>`
    : '';

  group.innerHTML = `<g class="staff-note pending">
    <circle class="note-highlight" cx="${x}" cy="${y}" r="15" style="opacity:0.25"/>
    ${ledgers}
    ${accidentalSvg}
    <ellipse class="note-head" cx="${x}" cy="${y}" rx="7" ry="5.5"/>
  </g>`;

  const key = scaleBuilderNoteKey(offset, accidental);
  labelEl.textContent = key ? `${scalesData.notes[key].label}（${key}）` : '（この位置に実在する音がありません）';
  confirmBtn.disabled = !key;
}

// 挿入・編集中は、その前後にある確定済みの音を五線譜に薄く表示し、今どのあたりに音を置いているかの目安にする。
// 末尾に追加するだけの通常入力では、直前の音だけを目安として表示する
function renderScaleBuilderContextNotes() {
  const group = document.getElementById('scaleBuilderContextNotes');
  const list  = scaleBuilderPhase === 'notes' ? scaleBuilderNotes : scaleBuilderArpeggio;

  let beforeNote = null;
  let afterNote  = null;
  if (scaleBuilderEditIndex !== null) {
    beforeNote = list[scaleBuilderEditIndex - 1] || null;
    afterNote  = list[scaleBuilderEditIndex + 1] || null;
  } else if (scaleBuilderInsertAt !== null) {
    beforeNote = list[scaleBuilderInsertAt - 1] || null;
    afterNote  = list[scaleBuilderInsertAt] || null;
  } else {
    beforeNote = list[list.length - 1] || null;
  }

  const renderOne = (entry, x) => {
    if (!entry) return '';
    const offset = staffOffset(entry.note);
    const y = staffY(offset);
    const ledgers = ledgerOffsets(offset).map(o => {
      const ly = staffY(o);
      return `<line class="note-ledger" x1="${x - 10}" y1="${ly}" x2="${x + 10}" y2="${ly}"/>`;
    }).join('');
    const { accidental } = parseNoteForStaff(entry.note);
    const accidentalGlyph = accidental === 's' ? '♯' : accidental === 'f' ? '♭' : '';
    const accidentalSvg = accidentalGlyph
      ? `<text class="note-accidental" x="${x - 11}" y="${y + 4}">${accidentalGlyph}</text>`
      : '';
    return `<g class="staff-note context">
      ${ledgers}
      ${accidentalSvg}
      <ellipse class="note-head" cx="${x}" cy="${y}" rx="6" ry="4.7"/>
    </g>`;
  };

  group.innerHTML = renderOne(beforeNote, 120) + renderOne(afterNote, 340);
}

// 仮配置中の音を確定するパネルの表示・非表示
function showScaleBuilderPendingPanel() {
  document.getElementById('scaleBuilderNotePanel').style.display = 'block';
  document.getElementById('scaleBuilderTurnGroup').style.display = scaleBuilderPhase === 'notes' ? 'block' : 'none';
  document.getElementById('scaleBuilderString').value   = 'G弦';
  document.getElementById('scaleBuilderPosition').value = '開放弦';
  applyScaleBuilderFingeringPrediction(); // まだ音を選んでいない（「＋」挿入直後）場合は何もしない
  document.getElementById('scaleBuilderTurnCheckbox').checked = false;
  updateScaleBuilderConfirmBtnLabel();
  renderScaleBuilderContextNotes();
  renderScaleBuilderInsertLines();
}
function hideScaleBuilderPendingPanel() {
  document.getElementById('scaleBuilderNotePanel').style.display = 'none';
  scaleBuilderPending   = null;
  scaleBuilderEditIndex = null;
  scaleBuilderInsertAt  = null;
  document.getElementById('scaleBuilderPendingNote').innerHTML = '';
  document.getElementById('scaleBuilderContextNotes').innerHTML = '';
  document.getElementById('scaleBuilderInsertLines').innerHTML = '';
}

// 音を追加・挿入する「枠」を示す左右2本の縦線を描く。パネルが開いている間は常に表示し、
// その間のどこかに（クリックして選んだ）音が入ることを示す
function renderScaleBuilderInsertLines() {
  const group = document.getElementById('scaleBuilderInsertLines');
  group.innerHTML = [170, 290].map(x =>
    `<line class="scale-builder-insert-line" x1="${x}" y1="-15" x2="${x}" y2="125"/>`
  ).join('');
}

// 確定ボタンの文言を、今やっていること（新規追加／挿入／既存の音の編集）に合わせて変える
function updateScaleBuilderConfirmBtnLabel() {
  const btn = document.getElementById('scaleBuilderConfirmNoteBtn');
  if (scaleBuilderEditIndex !== null)      btn.textContent = 'この音を更新する';
  else if (scaleBuilderInsertAt !== null)  btn.textContent = 'ここに挿入する';
  else                                     btn.textContent = 'この音を確定して次へ';
}

// 確定ボタン：仮配置中の音を、弦・指（・折り返し点）と合わせてリストに反映する。
// 新規追加なら末尾に追加、「＋」から来ていれば指定位置に挿入、既存の音の編集なら置き換える
document.getElementById('scaleBuilderConfirmNoteBtn').addEventListener('click', () => {
  if (!scaleBuilderPending) return;
  const key = scaleBuilderNoteKey(scaleBuilderPending.offset, scaleBuilderPending.accidental);
  if (!key) return; // 実在しない組み合わせのままでは確定できない

  const entry = {
    note:     key,
    string:   document.getElementById('scaleBuilderString').value,
    position: document.getElementById('scaleBuilderPosition').value,
  };
  if (scaleBuilderPhase === 'notes' && document.getElementById('scaleBuilderTurnCheckbox').checked) {
    entry.turn = true;
  }

  const list = scaleBuilderPhase === 'notes' ? scaleBuilderNotes : scaleBuilderArpeggio;
  if (scaleBuilderEditIndex !== null) {
    list[scaleBuilderEditIndex] = entry;
  } else if (scaleBuilderInsertAt !== null) {
    list.splice(scaleBuilderInsertAt, 0, entry);
  } else {
    list.push(entry);
  }

  hideScaleBuilderPendingPanel();
  renderScaleBuilderNoteList();
});

// 「◀ 一つ戻る」：仮配置中の音があればそれを取り消し、無ければ直前に確定した音を1つ取り消す
document.getElementById('scaleBuilderBackBtn').addEventListener('click', () => {
  // パネルが開いている間は、まだ音を選んでいない（挿入待ち）状態でもキャンセル扱いにする
  const panelOpen = document.getElementById('scaleBuilderNotePanel').style.display === 'block';
  if (panelOpen) {
    hideScaleBuilderPendingPanel();
    return;
  }
  const list = scaleBuilderPhase === 'notes' ? scaleBuilderNotes : scaleBuilderArpeggio;
  list.pop();
  renderScaleBuilderNoteList();
});

// 確定済みの音符一覧を、各音ごとの「編集」「削除」ボタンと、音と音の間の「＋」挿入ポイント付きで描画する。
// 入力中の音数の表示もここで更新する
function renderScaleBuilderNoteList() {
  const list = scaleBuilderPhase === 'notes' ? scaleBuilderNotes : scaleBuilderArpeggio;
  const container = document.getElementById('scaleBuilderNoteList');

  const insertRow = (at) =>
    `<div class="scale-builder-insert-row" data-insert-at="${at}">＋ ここに音を挿入</div>`;

  const noteRow = (n, i) => {
    const noteData = scalesData.notes[n.note];
    const turnMark = n.turn ? '<span class="turn-mark">◀折り返し</span>' : '';
    return `<div class="scale-builder-note-item" data-index="${i}">
      <span class="scale-builder-note-num">${i + 1}.</span>
      <span class="scale-builder-note-text">${noteData.label}（${n.note}） − ${n.string}・${n.position}${turnMark}</span>
      <div class="scale-builder-note-actions">
        <button type="button" class="btn-secondary scale-builder-edit-note-btn" data-index="${i}">編集</button>
        <button type="button" class="btn-danger scale-builder-delete-note-btn" data-index="${i}">削除</button>
      </div>
    </div>`;
  };

  container.innerHTML = insertRow(0) + list.map((n, i) => noteRow(n, i) + insertRow(i + 1)).join('');

  container.querySelectorAll('.scale-builder-insert-row').forEach(row => {
    row.addEventListener('click', () => startScaleBuilderInsert(parseInt(row.dataset.insertAt, 10)));
  });
  container.querySelectorAll('.scale-builder-edit-note-btn').forEach(btn => {
    btn.addEventListener('click', () => startScaleBuilderNoteEdit(parseInt(btn.dataset.index, 10)));
  });
  container.querySelectorAll('.scale-builder-delete-note-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const list = scaleBuilderPhase === 'notes' ? scaleBuilderNotes : scaleBuilderArpeggio;
      list.splice(parseInt(btn.dataset.index, 10), 1);
      hideScaleBuilderPendingPanel();
      renderScaleBuilderNoteList();
    });
  });

  const count     = list.length;
  const phaseText = scaleBuilderPhase === 'arpeggio' ? 'アルペジオ' : '音階';
  document.getElementById('scaleBuilderPhaseLabel').textContent = `${phaseText}を入力中（${count}音）`;
}

// 音階一覧の各行の「編集」ボタンで呼ばれる：既存の音を仮配置パネルに読み込み、修正できるようにする
function startScaleBuilderNoteEdit(index) {
  const list  = scaleBuilderPhase === 'notes' ? scaleBuilderNotes : scaleBuilderArpeggio;
  const entry = list[index];
  if (!entry) return;

  scaleBuilderEditIndex = index;
  scaleBuilderInsertAt  = null;
  scaleBuilderPending   = { offset: staffOffset(entry.note), accidental: scaleBuilderAccidentalFromKey(entry.note) };
  renderScaleBuilderPendingNote();
  showScaleBuilderPendingPanel();

  document.getElementById('scaleBuilderString').value   = entry.string;
  document.getElementById('scaleBuilderPosition').value = entry.position;
  document.getElementById('scaleBuilderTurnCheckbox').checked = !!entry.turn;
  updateScaleBuilderConfirmBtnLabel();

  document.getElementById('scaleBuilderNotePanel').scrollIntoView({ block: 'nearest' });
}

// 各行の間にある「＋」で呼ばれる：新しい音を指定位置に挿入する準備をする。
// 初期のピッチは、直前の音（無ければ直後の音、どちらも無ければA4）を引き継いでおく
// 挿入する音のピッチはまだ決めない（デフォルト値を仮表示しない）。
// 管理者が実際に五線譜をクリックして選ぶまで、確定ボタンは押せない状態にしておく
function startScaleBuilderInsert(insertAt) {
  scaleBuilderEditIndex = null;
  scaleBuilderInsertAt  = insertAt;
  scaleBuilderPending   = null;
  renderScaleBuilderPendingNote(); // ラベルを「選んでください」にし、確定ボタンを無効化する
  showScaleBuilderPendingPanel();

  document.getElementById('scaleBuilderNotePanel').scrollIntoView({ block: 'nearest' });
}

// 「入力を完了する」：音階の入力ならアルペジオを追加するか尋ね、アルペジオの入力ならそのまま保存する
document.getElementById('scaleBuilderFinishBtn').addEventListener('click', () => {
  const errorEl = document.getElementById('scaleBuilderError');
  errorEl.style.display = 'none';

  const list = scaleBuilderPhase === 'notes' ? scaleBuilderNotes : scaleBuilderArpeggio;
  if (list.length < 2) {
    errorEl.textContent = '音符を2つ以上入力してください';
    errorEl.style.display = 'block';
    return;
  }
  hideScaleBuilderPendingPanel();

  if (scaleBuilderPhase === 'notes') {
    document.getElementById('scaleBuilderInput').style.display = 'none';
    document.getElementById('scaleBuilderArpeggioAsk').style.display = 'block';
  } else {
    saveScaleBuilderResult();
  }
});

document.getElementById('scaleBuilderArpeggioYesBtn').addEventListener('click', () => {
  scaleBuilderPhase = 'arpeggio';
  // scaleBuilderArpeggio はここでは空にしない：新規追加ならもともと空、
  // 音階一覧からの「修正」で既存のアルペジオを読み込んでいた場合はそれを引き継いで編集を続けられるようにする
  document.getElementById('scaleBuilderArpeggioAsk').style.display = 'none';
  document.getElementById('scaleBuilderInput').style.display = 'block';
  renderScaleBuilderNoteList();
  hideScaleBuilderPendingPanel();
});

document.getElementById('scaleBuilderArpeggioNoBtn').addEventListener('click', saveScaleBuilderResult);

document.getElementById('scaleBuilderCancelBtn').addEventListener('click', () => {
  if (!confirm('入力中の内容を取り消しますか？')) return;
  resetScaleBuilder();
});

// カテゴリー・調の名前・入力してきた音符（・アルペジオ）をまとめてサーバーに送る。
// 音階一覧の「修正」から来ていれば更新(PUT)、それ以外は新規追加(POST)
async function saveScaleBuilderResult() {
  const errorEl   = document.getElementById('scaleBuilderError');
  const successEl = document.getElementById('scaleBuilderSuccess');
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';

  const categoryKey = document.getElementById('scaleBuilderCategory').value;
  const name        = document.getElementById('scaleBuilderName').value.trim();
  const arpeggio     = scaleBuilderArpeggio.length > 0 ? scaleBuilderArpeggio : null;

  const keySig = Object.fromEntries(Object.entries(scaleBuilderKeySignature).filter(([,v]) => v !== null));
  const wasEditing = scaleBuilderEditingId !== null;
  try {
    if (scaleBuilderEditingId) {
      await updateScale(scaleBuilderEditingId, categoryKey, name, scaleBuilderNotes, arpeggio, keySig);
      successEl.textContent = `「${name}」を修正しました`;
    } else {
      await createScale(categoryKey, name, scaleBuilderNotes, arpeggio, keySig);
      successEl.textContent = `「${name}」を追加しました`;
    }
    successEl.style.display = 'block';
    await loadScales(); // 練習タブ・デモタブの調セレクトに、変更をすぐ反映する
    resetScaleBuilder();
    // 音階一覧の「修正」から来た場合は、結果を確認できるよう一覧に戻して更新しておく
    if (wasEditing) {
      document.getElementById('scaleListCard').style.display = 'block';
      await renderScaleList();
    }
  } catch (err) {
    document.getElementById('scaleBuilderArpeggioAsk').style.display = 'none';
    document.getElementById('scaleBuilderInput').style.display = 'block';
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
}

// 「音符の入力を始める」：カテゴリー・調の名前を確定し、入力ステップへ進む
document.getElementById('scaleBuilderStartBtn').addEventListener('click', () => {
  const errorEl = document.getElementById('scaleBuilderSetupError');
  errorEl.style.display = 'none';
  const name = document.getElementById('scaleBuilderName').value.trim();
  if (!name) {
    errorEl.textContent   = '調の名前を入力してください';
    errorEl.style.display = 'block';
    return;
  }

  scaleBuilderEditingId = null;
  scaleBuilderPhase     = 'notes';
  scaleBuilderNotes     = [];
  scaleBuilderArpeggio  = [];
  scaleBuilderKeySignature = {};
  updateScaleBuilderKeySigButtons();

  document.getElementById('scaleBuilderSetup').style.display = 'none';
  document.getElementById('scaleBuilderArpeggioAsk').style.display = 'none';
  document.getElementById('scaleBuilderInput').style.display = 'block';
  document.getElementById('scaleBuilderCancelBtn').style.display = 'block';
  renderScaleBuilderGuides();
  renderScaleBuilderNoteList();
  hideScaleBuilderPendingPanel();
});

// 音階一覧の「修正」ボタンから呼ばれる：既存の音階の内容を読み込み、入力ステップへ直接進む
function startScaleBuilderEdit(id, categoryKey, scale) {
  scaleBuilderEditingId = id;
  scaleBuilderPhase     = 'notes';
  scaleBuilderNotes     = scale.notes.map(n => ({ ...n }));
  scaleBuilderArpeggio  = scale.arpeggio ? scale.arpeggio.map(n => ({ ...n })) : [];
  scaleBuilderKeySignature = scale.key_sig ? { ...scale.key_sig } : {};
  updateScaleBuilderKeySigButtons();

  document.getElementById('scaleBuilderCategory').value = categoryKey;
  document.getElementById('scaleBuilderName').value     = scale.name;

  document.getElementById('scaleListCard').style.display = 'none';
  document.getElementById('scaleBuilderSetup').style.display = 'none';
  document.getElementById('scaleBuilderArpeggioAsk').style.display = 'none';
  document.getElementById('scaleBuilderInput').style.display = 'block';
  document.getElementById('scaleBuilderCancelBtn').style.display = 'block';
  renderScaleBuilderGuides();
  renderScaleBuilderNoteList();
  hideScaleBuilderPendingPanel();

  document.getElementById('scaleBuilderCard').scrollIntoView({ block: 'start' });
}

// 保存・取り消しのあと、フォーム全体を最初の状態（カテゴリー・調の名前入力）に戻す
function resetScaleBuilder() {
  scaleBuilderEditingId = null;
  scaleBuilderPhase     = null;
  scaleBuilderNotes     = [];
  scaleBuilderArpeggio  = [];
  scaleBuilderKeySignature = {};
  updateScaleBuilderKeySigButtons();
  hideScaleBuilderPendingPanel();
  document.getElementById('scaleBuilderName').value = '';
  document.getElementById('scaleBuilderInput').style.display = 'none';
  document.getElementById('scaleBuilderArpeggioAsk').style.display = 'none';
  document.getElementById('scaleBuilderCancelBtn').style.display = 'none';
  document.getElementById('scaleBuilderSetup').style.display = 'block';
}

// 「📋 音階一覧を見る」ボタン：一覧の表示・非表示を切り替える
document.getElementById('scaleListToggleBtn').addEventListener('click', async () => {
  const card = document.getElementById('scaleListCard');
  if (card.style.display === 'block') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  await renderScaleList();
});

// カテゴリーごとに音階一覧を描画し、各行に「修正」「削除」ボタンを付ける
async function renderScaleList() {
  const res = await fetch('/api/scales'); // 常に最新の状態を取り直す
  const { categories } = await res.json();
  const content = document.getElementById('scaleListContent');

  content.innerHTML = Object.entries(categories).map(([categoryKey, cat]) => {
    const rows = Object.entries(cat.scales);
    const rowsHtml = rows.length > 0
      ? rows.map(([id, scale]) => `
        <div class="scale-list-row" data-scale-id="${id}" data-category-key="${categoryKey}">
          <div class="scale-list-row-header">
            <div>
              <div class="scale-list-name">${escapeHtml(scale.name)}</div>
              <div class="scale-list-meta">${scale.notes.length}音${scale.arpeggio ? '・アルペジオあり' : ''}</div>
            </div>
            <div class="scale-list-actions">
              <button type="button" class="btn-secondary scale-list-staff-btn">楽譜</button>
              <button type="button" class="btn-secondary scale-list-finger-btn" style="display:none">指番号</button>
              <button type="button" class="btn-secondary scale-list-acc-btn" style="display:none">臨時記号</button>
              <button type="button" class="btn-secondary scale-list-edit-btn">修正</button>
              <button type="button" class="btn-danger scale-list-delete-btn">削除</button>
            </div>
          </div>
          <div class="scale-list-staff-preview" style="display:none"></div>
        </div>
      `).join('')
      : '<p class="scale-list-empty">まだ音階がありません</p>';

    return `<div class="scale-list-category">
      <h3>${escapeHtml(cat.label)}</h3>
      ${rowsHtml}
    </div>`;
  }).join('');

  // 音階一覧：楽譜ボタン＋指番号・臨時記号トグル
  function reRenderScalePreview(row) {
    const id      = row.dataset.scaleId;
    const catKey  = row.dataset.categoryKey;
    const scale   = categories[catKey].scales[id];
    const preview = row.querySelector('.scale-list-staff-preview');
    const showF   = row.dataset.showFingers === '1';
    const showA   = row.dataset.showAcc === '1';
    preview.innerHTML = buildStaffSVG(scale.notes, true, scale.key_sig || {},
      { showFingers: showF, showAllAccidentals: showA });
  }

  content.querySelectorAll('.scale-list-staff-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row       = e.target.closest('.scale-list-row');
      const preview   = row.querySelector('.scale-list-staff-preview');
      const fingerBtn = row.querySelector('.scale-list-finger-btn');
      const accBtn    = row.querySelector('.scale-list-acc-btn');
      if (preview.style.display !== 'none') {
        preview.style.display = 'none';
        [fingerBtn, accBtn].forEach(b => { if (b) b.style.display = 'none'; });
        return;
      }
      row.dataset.showFingers = '0';
      row.dataset.showAcc     = '0';
      reRenderScalePreview(row);
      preview.style.display = 'block';
      [fingerBtn, accBtn].forEach(b => { if (b) b.style.display = ''; });
    });
  });

  content.querySelectorAll('.scale-list-finger-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('.scale-list-row');
      row.dataset.showFingers = row.dataset.showFingers === '1' ? '0' : '1';
      btn.classList.toggle('active', row.dataset.showFingers === '1');
      reRenderScalePreview(row);
    });
  });

  content.querySelectorAll('.scale-list-acc-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('.scale-list-row');
      row.dataset.showAcc = row.dataset.showAcc === '1' ? '0' : '1';
      btn.classList.toggle('active', row.dataset.showAcc === '1');
      reRenderScalePreview(row);
    });
  });

  content.querySelectorAll('.scale-list-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row         = e.target.closest('.scale-list-row');
      const id          = row.dataset.scaleId;
      const categoryKey = row.dataset.categoryKey;
      startScaleBuilderEdit(id, categoryKey, categories[categoryKey].scales[id]);
    });
  });

  content.querySelectorAll('.scale-list-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row         = e.target.closest('.scale-list-row');
      const id          = row.dataset.scaleId;
      const categoryKey = row.dataset.categoryKey;
      const scale       = categories[categoryKey].scales[id];
      if (!confirm(`「${scale.name}」を削除しますか？この操作は取り消せません。`)) return;
      try {
        await deleteScale(id);
        await loadScales(); // 練習タブ・デモタブの調セレクトから削除を反映する
        await renderScaleList();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// 被験者アカウント作成フォームの4音階セレクトを初期化する
function populateSubjectCreateScaleSelects() {
  [
    ['subjectScale1Category', 'subjectScale1'],
    ['subjectScale2Category', 'subjectScale2'],
    ['subjectScale3Category', 'subjectScale3'],
    ['subjectScale4Category', 'subjectScale4'],
  ].forEach(([catId, scaleId]) => {
    const catEl   = document.getElementById(catId);
    const scaleEl = document.getElementById(scaleId);
    if (!catEl || !scaleEl) return;
    populateRoadmapEditScaleSelect(scaleEl, catEl.value);
    catEl.addEventListener('change', () => populateRoadmapEditScaleSelect(scaleEl, catEl.value));
  });
}

// 管理者が被験者用アカウントをその場で作成する。
// /api/profiles は管理者からのリクエストだと自動ログインを行わない仕様になっているため、
// 作成しても管理者自身のログイン状態はそのまま
document.getElementById('createSubjectAccountBtn').addEventListener('click', async () => {
  const errorEl   = document.getElementById('subjectAccountError');
  const successEl = document.getElementById('subjectAccountSuccess');
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';

  const name         = document.getElementById('subjectName').value.trim();
  const password     = document.getElementById('subjectPassword').value;
  const direction    = document.querySelector('input[name="subjectDirection"]:checked').value;
  const bpm          = parseInt(document.getElementById('subjectBpmRange').value, 10);
  const with_practice = document.querySelector('input[name="subjectWithPractice"]:checked').value;
  if (!name) {
    errorEl.textContent   = '名前を入力してください';
    errorEl.style.display = 'block';
    return;
  }

  // 4音階の選択値を収集
  const scalePairs = [
    ['subjectScale1Category', 'subjectScale1'],
    ['subjectScale2Category', 'subjectScale2'],
    ['subjectScale3Category', 'subjectScale3'],
    ['subjectScale4Category', 'subjectScale4'],
  ];
  const scales = scalePairs.map(([catId, scaleId]) => ({
    category_key: document.getElementById(catId).value,
    scale_id:     parseInt(document.getElementById(scaleId).value, 10),
  }));
  if (scales.some(s => !s.scale_id)) {
    errorEl.textContent   = '4つの音階をすべて選択してください';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const created = await createProfile(name, password, { direction, bpm, with_practice, scales });
    document.getElementById('subjectName').value     = '';
    document.getElementById('subjectPassword').value = '';
    successEl.textContent   = `「${created.name}」を作成しました`;
    successEl.style.display = 'block';
    await renderAccountList(); // 記録タブのアカウント一覧にも反映する
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
});

// ===========================
// 研究者アカウント作成
// ===========================
document.getElementById('createResearcherAccountBtn').addEventListener('click', async () => {
  const errorEl   = document.getElementById('researcherAccountError');
  const successEl = document.getElementById('researcherAccountSuccess');
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';

  const name     = document.getElementById('researcherName').value.trim();
  const password = document.getElementById('researcherPassword').value;
  if (!name) {
    errorEl.textContent   = '名前を入力してください';
    errorEl.style.display = 'block';
    return;
  }
  try {
    const created = await createProfile(name, password, { account_type: 'researcher' });
    document.getElementById('researcherName').value     = '';
    document.getElementById('researcherPassword').value = '';
    successEl.textContent   = `「${created.name}」（研究者）を作成しました`;
    successEl.style.display = 'block';
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
});

// ===========================
// 五線譜（スタッフ）SVG 描画
// ===========================

// ト音記号五線譜上の位置（E4=0基準）を返す。ドイツ音名 H = B
function toggleCollapsible(bodyId, headingId) {
  const body    = document.getElementById(bodyId);
  const heading = document.getElementById(headingId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  const arrow = heading?.querySelector('.collapsible-arrow');
  if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
}

// バイオリンの弦ごとの色（E4=0 基準のステップで判定）
const STRING_COLORS = {
  G: '#D97706', // G線：琥珀
  D: '#16A34A', // D線：緑
  A: '#2563EB', // A線：青
  E: '#DC2626', // E線：赤
};
function getStringColor(step) {
  if (step <= -2) return STRING_COLORS.G; // G3〜C4
  if (step <=  2) return STRING_COLORS.D; // D4〜G4
  if (step <=  6) return STRING_COLORS.A; // A4〜D5
  return STRING_COLORS.E;                 // E5〜
}
function getStringName(step) {
  if (step <= -2) return 'G';
  if (step <=  2) return 'D';
  if (step <=  6) return 'A';
  return 'E';
}

function noteNameToStaffStep(noteStr) {
  const m = noteStr.match(/^([A-H])(s|f)?(\d+)$/i);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accStr = m[2] ? m[2].toLowerCase() : '';
  const octave  = parseInt(m[3]);
  // E4 = 0 基準: C=-2, D=-1, E=0, F=1, G=2, A=3, H=4 (各オクターブで +7)
  const NOTE_BASE = { C: -2, D: -1, E: 0, F: 1, G: 2, A: 3, H: 4 };
  const base = NOTE_BASE[letter];
  if (base === undefined) return null;
  return {
    step:       base + (octave - 4) * 7,
    accidental: accStr === 's' ? 'sharp' : accStr === 'f' ? 'flat' : ''
  };
}

// 音符オブジェクト配列 [{note:"C4", turn?:true}, ...] から五線譜 SVG 文字列を生成する
// colorByString=true のときだけ弦ごとの色分けを適用する
// keySignature = { F:'s', C:'s', ... } 形式で調号を渡すとト音記号の右に表示する
// opts.showFingers=true で指番号を音符上方に表示
// opts.showAllAccidentals=true で調号に含まれる音の臨時記号も表示
function buildStaffSVG(noteObjs, colorByString = false, keySignature = {}, opts = {}) {
  if (!noteObjs || noteObjs.length === 0) return '';

  const LS  = 16;    // 五線間隔(px)
  const HS  = LS / 2;
  const NRX = 9.0;   // 音符楕円 横半径（横広楕円）
  const NRY = 6.5;   // 音符楕円 縦半径
  const NS  = 36;    // 音符の水平間隔
  const RP  = 24;
  const SVG_H = 240;
  const E4_Y  = 165; // E4（底線）のY座標

  // 調号シンボル収集（トレブル譜上の標準位置）
  const SHARP_ORDER = ['F','C','G','D','A','E','B'];
  const SHARP_STEPS = { F:8, C:5, G:9, D:6, A:3, E:7, B:4 };
  const FLAT_ORDER  = ['B','E','A','D','G','C','F'];
  const FLAT_STEPS  = { B:4, E:7, A:3, D:6, G:2, C:5, F:1 };
  const keySigItems = [];
  for (const l of SHARP_ORDER) {
    if ((keySignature || {})[l] === 's') keySigItems.push({ ch: '♯', step: SHARP_STEPS[l] });
  }
  if (keySigItems.length === 0) {
    for (const l of FLAT_ORDER) {
      if ((keySignature || {})[l] === 'f') keySigItems.push({ ch: '♭', step: FLAT_STEPS[l] });
    }
  }
  const KS_X0  = 62;   // 調号開始 x（ト音記号から十分離す）
  const KS_W   = 16;   // 1記号あたりの幅
  const LP     = Math.max(56, KS_X0 + keySigItems.length * KS_W + 18); // +18 で初音符との余白確保

  const stepToY = (s) => E4_Y - s * HS;
  const SVG_W   = LP + noteObjs.length * NS + RP;
  const noteParts   = []; // 音符・符尾（先に描画）
  const lineParts   = []; // 五線・加線・小節線（音符の上に重ねる）
  const textParts   = []; // 臨時記号・ト音記号・調号（最前面）

  // 五線（E4=0, G4=2, H4=4, D5=6, F5=8）
  for (const s of [0, 2, 4, 6, 8]) {
    const y = stepToY(s).toFixed(1);
    lineParts.push(`<line x1="8" y1="${y}" x2="${SVG_W - 8}" y2="${y}" class="staff-line"/>`);
  }
  // ト音記号（Unicode U+1D11E）
  textParts.push(`<text x="8" y="${stepToY(5).toFixed(1)}" font-size="${(LS * 5.5).toFixed(0)}" class="staff-clef" dominant-baseline="middle">𝄞</text>`);
  // 調号
  keySigItems.forEach((item, i) => {
    const kx  = KS_X0 + i * KS_W;
    const ky  = stepToY(item.step);
    const kfs = item.ch === '♯' ? 22 : 24;
    const ktf = `translate(${kx.toFixed(1)},${ky.toFixed(1)}) scale(1,1.4) translate(${(-kx).toFixed(1)},${(-ky).toFixed(1)})`;
    textParts.push(`<text x="${kx.toFixed(1)}" y="${ky.toFixed(1)}" font-size="${kfs}" fill="#111" text-anchor="middle" dominant-baseline="middle" transform="${ktf}">${item.ch}</text>`);
  });

  // 16分音符：4音ずつ連桁
  const BEAM_W   = 4.5;
  const BEAM_GAP = 6;
  const lw = NRX + 5;

  // 音符データ事前収集（インデックス維持）
  const allNoteData = noteObjs.map((noteObj, i) => {
    const noteStr = typeof noteObj === 'string' ? noteObj : noteObj?.note;
    if (!noteStr) return null;
    const parsed = noteNameToStaffStep(noteStr);
    if (!parsed) return null;
    return { i, noteObj, step: parsed.step, accidental: parsed.accidental,
             x: LP + i * NS, y: stepToY(parsed.step) };
  });

  // 全音符の中で最も高い（y が小さい）位置より上に指番号を揃える
  const topNoteY = allNoteData.filter(Boolean).reduce((m, nd) => Math.min(m, nd.y), stepToY(8));
  const FINGER_Y = Math.min(topNoteY - NRY - 12, stepToY(8) - 10);

  // 半音ペアを括る半透明ハイライト
  const bracketParts = [];
  const NOTE_BASE_SEMI = { C:0, D:2, E:4, F:5, G:7, A:9, H:11, B:11 };
  function ndToSemi(nd) {
    const ns = typeof nd.noteObj === 'string' ? nd.noteObj : nd.noteObj?.note;
    const m  = ns?.match(/^([A-GH])(s|f)?(\d+)$/i);
    if (!m) return null;
    let s = (NOTE_BASE_SEMI[m[1].toUpperCase()] ?? 0) + parseInt(m[3]) * 12;
    if (m[2] === 's') s += 1;
    if (m[2] === 'f') s -= 1;
    return s;
  }
  for (let idx = 0; idx < allNoteData.length - 1; idx++) {
    const nd1 = allNoteData[idx], nd2 = allNoteData[idx + 1];
    if (!nd1 || !nd2) continue;
    if (Math.abs((ndToSemi(nd2) ?? 999) - (ndToSemi(nd1) ?? 999)) !== 1) continue;
    const bx1 = nd1.x - NRX - 5;
    const bx2 = nd2.x + NRX + 5;
    const by1 = Math.min(nd1.y, nd2.y) - NRY - 5;
    const by2 = Math.max(nd1.y, nd2.y) + NRY + 5;
    const bw  = bx2 - bx1, bh = by2 - by1;
    const br  = Math.min(10, bw / 2, bh / 2);
    bracketParts.push(`<rect x="${bx1.toFixed(1)}" y="${by1.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${br}" ry="${br}" fill="rgba(255,140,0,0.22)" stroke="rgba(220,100,0,0.45)" stroke-width="1"/>`);
  }

  for (let gi = 0; gi < allNoteData.length; gi += 4) {
    const group = allNoteData.slice(gi, gi + 4).filter(Boolean);
    if (!group.length) continue;

    // グループ平均ステップで符尾の向きを統一
    const avgStep = group.reduce((s, n) => s + n.step, 0) / group.length;
    const stemUp  = avgStep <= 4;
    const STEM_LEN = LS * 3.2;

    // 連桁の傾き：最初と最後の音符の符尾端（最大 HS/2 までに制限）
    const first = group[0], last = group[group.length - 1];
    let byS = stemUp ? first.y - STEM_LEN : first.y + STEM_LEN;
    let byE = stemUp ? last.y  - STEM_LEN : last.y  + STEM_LEN;
    const maxTilt = HS / 2;
    if (Math.abs(byE - byS) > maxTilt) {
      byE = byS + Math.sign(byE - byS) * maxTilt;
    }
    // 最短符尾を保証（全音符が STEM_LEN 以上になるよう連桁を押し上げ/押し下げ）
    for (const nd of group) {
      const nat = stemUp ? nd.y - STEM_LEN : nd.y + STEM_LEN;
      const t   = group.length > 1 ? (nd.x - first.x) / (last.x - first.x) : 0;
      const bAt = byS + (byE - byS) * t;
      if (stemUp && bAt > nat) { const d = bAt - nat; byS -= d; byE -= d; }
      if (!stemUp && bAt < nat) { const d = nat - bAt; byS += d; byE += d; }
    }

    // 音符ごとに符尾端を線形補間で計算
    const beamYAt = (x) => {
      if (group.length < 2) return byS;
      return byS + (byE - byS) * (x - first.x) / (last.x - first.x);
    };

    for (const nd of group) {
      const { i, noteObj, step, accidental, x, y } = nd;
      const col    = colorByString ? getStringColor(step) : '#111';
      const stemEnd = beamYAt(x);

      // 臨時記号（調号に含まれる#/♭は省略）
      const noteStrAcc = typeof noteObj === 'string' ? noteObj : noteObj?.note;
      const noteLetter = noteStrAcc ? noteStrAcc[0].toUpperCase() : null;
      const inKeySig = !opts.showAllAccidentals && noteLetter && (
        (accidental === 'sharp' && (keySignature || {})[noteLetter] === 's') ||
        (accidental === 'flat'  && (keySignature || {})[noteLetter] === 'f')
      );
      if (!inKeySig) {
        // 音符左端の少し手前を中心に縦長で表示
        const ax = x - NRX - 6;
        const ay = y;
        // 中心点(ax,ay)を固定したまま縦方向に1.4倍拡大
        const tf = `translate(${ax.toFixed(1)},${ay.toFixed(1)}) scale(1,1.4) translate(${(-ax).toFixed(1)},${(-ay).toFixed(1)})`;
        if (accidental === 'sharp') {
          textParts.push(`<text x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" font-size="22" class="staff-acc" fill="${col}" dominant-baseline="middle" text-anchor="middle" transform="${tf}">♯</text>`);
        } else if (accidental === 'flat') {
          textParts.push(`<text x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" font-size="24" class="staff-acc" fill="${col}" dominant-baseline="middle" text-anchor="middle" transform="${tf}">♭</text>`);
        }
      }

      // 音符頭（斜め楕円・傾き+20°）
      noteParts.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${NRX}" ry="${NRY}" fill="${col}" stroke="${col}" stroke-width="0.5" transform="rotate(13,${x.toFixed(1)},${y.toFixed(1)})"/>`);

      // 符尾（連桁端まで）
      const sx = stemUp ? x + NRX - 0.5 : x - NRX + 0.5;
      noteParts.push(`<line x1="${sx.toFixed(1)}" y1="${y.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${stemEnd.toFixed(1)}" stroke="${col}" stroke-width="1.8"/>`);

      // 加線
      if (step < 0) {
        for (let s = -2; s >= step; s -= 2) {
          const ly = stepToY(s).toFixed(1);
          lineParts.push(`<line x1="${(x - lw).toFixed(1)}" y1="${ly}" x2="${(x + lw).toFixed(1)}" y2="${ly}" class="ledger-line"/>`);
        }
      } else if (step > 8) {
        for (let s = 10; s <= step; s += 2) {
          const ly = stepToY(s).toFixed(1);
          lineParts.push(`<line x1="${(x - lw).toFixed(1)}" y1="${ly}" x2="${(x + lw).toFixed(1)}" y2="${ly}" class="ledger-line"/>`);
        }
      }

      // 小節線：16個目と17個目の間（インデックス15の右）
      if (i === 15) {
        const bx = (x + NS / 2).toFixed(1);
        lineParts.push(`<line x1="${bx}" y1="${(stepToY(8) - 8).toFixed(1)}" x2="${bx}" y2="${(stepToY(0) + 8).toFixed(1)}" class="staff-barline"/>`);
      }

      // 指番号（全音符共通の高さ FINGER_Y に描画）
      if (opts.showFingers) {
        const posStr = typeof noteObj === 'object' ? (noteObj?.position || '') : '';
        const fNum   = posStr.includes('開放') ? '0' : (posStr.match(/(\d)/) || [])[1] || '';
        if (fNum !== '') {
          textParts.push(`<text x="${x.toFixed(1)}" y="${FINGER_Y.toFixed(1)}" font-size="11" fill="#444" text-anchor="middle" dominant-baseline="auto" font-weight="bold">${fNum}</text>`);
        }
      }
    }

    // 連桁2本（斜め）
    const x1b = first.x + (stemUp ?  NRX - 0.5 : -(NRX - 0.5));
    const x2b = last.x  + (stemUp ?  NRX - 0.5 : -(NRX - 0.5));
    lineParts.push(`<line x1="${x1b.toFixed(1)}" y1="${byS.toFixed(1)}" x2="${x2b.toFixed(1)}" y2="${byE.toFixed(1)}" stroke="#111" stroke-width="${BEAM_W}" stroke-linecap="square"/>`);
    const b2S = stemUp ? byS + BEAM_GAP + BEAM_W : byS - BEAM_GAP - BEAM_W;
    const b2E = stemUp ? byE + BEAM_GAP + BEAM_W : byE - BEAM_GAP - BEAM_W;
    lineParts.push(`<line x1="${x1b.toFixed(1)}" y1="${b2S.toFixed(1)}" x2="${x2b.toFixed(1)}" y2="${b2E.toFixed(1)}" stroke="#111" stroke-width="${BEAM_W}" stroke-linecap="square"/>`);
  }

  // 終止線（二重線）：スタッフ右端
  const finalX = SVG_W - RP / 2;
  const fTop   = (stepToY(8) - 8).toFixed(1);
  const fBot   = (stepToY(0) + 8).toFixed(1);
  lineParts.push(`<line x1="${(finalX - 3).toFixed(1)}" y1="${fTop}" x2="${(finalX - 3).toFixed(1)}" y2="${fBot}" stroke="#111" stroke-width="1.5"/>`);
  lineParts.push(`<line x1="${finalX.toFixed(1)}" y1="${fTop}" x2="${finalX.toFixed(1)}" y2="${fBot}" stroke="#111" stroke-width="4.5"/>`);

  const parts = [...lineParts, ...bracketParts, ...noteParts, ...textParts];

  // 凡例（弦の色説明）をSVG下部に追加（色分けモードのみ）
  if (colorByString) {
    const legendY = SVG_H - 14;
    const legendItems = [
      { label: 'G線', step: -3 },
      { label: 'D線', step:  1 },
      { label: 'A線', step:  4 },
      { label: 'E線', step:  8 },
    ];
    let lx = LP;
    legendItems.forEach(({ label, step: ls }) => {
      const c = getStringColor(ls);
      parts.push(`<circle cx="${lx + 5}" cy="${legendY}" r="4" fill="${c}"/>`);
      parts.push(`<text x="${lx + 13}" y="${legendY + 4}" font-size="10" fill="#444" font-family="sans-serif">${label}</text>`);
      lx += 44;
    });
  }

  const bg = `<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="white"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" class="staff-svg">${bg}${parts.join('')}</svg>`;
}

// 被験者ステップインデックスから { scalePair: 1|2, day: 1-4 } を返す
// ペア1(steps 0-7)  → scalePair=1, day=1〜4
// ペア2(steps 8-15) → scalePair=2, day=1〜4
function subjectStepToPhaseDay(stepIndex) {
  return {
    scalePair: Math.floor(stepIndex / 8) + 1,
    day:       Math.floor((stepIndex % 8) / 2) + 1,
  };
}

// ===========================
// 研究データタブ
// ===========================
let researchRecords = []; // 現在表示中の記録一覧
let researchEditingId = null; // 編集中の記録ID（nullなら追加モード）
let researchAddMode = false;  // true=新規追加モード、false=編集モード
let researchSubjectSteps = []; // 現在選択中のアカウントの被験者ロードマップステップ（BPM自動入力用）

// 管理者ライブ記録モード（「実際に弾いて記録する」機能）
let adminLiveRecordMode = false;
let adminLiveNoteResults = [];
let adminLiveScaleName = '';
let adminLiveDirection = '';
let adminLiveMode = 'tempo';
let adminLiveBpm = 60;
let baselineWrongNotes = []; // 当日baseline記録から取得した不正確音符

// 音符ごとの詳細設定グリッド
let adminNoteResultsData = []; // [{note, string, outcome, cents}]
let adminNoteResultsGridActive = false; // グリッドが有効な間は正答数・総音符数を自動計算

// DB形式（YYYY/MM/DD HH:MM）↔ datetime-local入力値（YYYY-MM-DDTHH:MM）変換
function dbDateToDatetimeLocal(s) {
  if (!s) return '';
  return s.replace(/\//g, '-').replace(' ', 'T');
}
function datetimeLocalToDbDate(s) {
  if (!s) return '';
  return s.replace(/-/g, '/').replace('T', ' ');
}

// 研究データ編集モーダルの音階セレクトを、登録済み音階でカテゴリー別に作り直す
function populateResearchScaleSelect(currentName) {
  const sel  = document.getElementById('researchEditScale');
  const cats = scalesData.categories || {};
  sel.innerHTML = '<option value="">（音階を選択）</option>';
  Object.keys(cats).forEach(catKey => {
    const cat = cats[catKey];
    const scales = cat.scales || {};
    if (Object.keys(scales).length === 0) return;
    const group = document.createElement('optgroup');
    group.label = cat.label || catKey;
    Object.keys(scales).forEach(scaleId => {
      const scale = scales[scaleId];
      const opt   = document.createElement('option');
      opt.value               = scale.name;
      opt.dataset.scaleId     = scaleId;
      opt.dataset.categoryKey = catKey;
      opt.textContent         = scale.name;
      group.appendChild(opt);
    });
    sel.appendChild(group);
  });
  if (currentName) sel.value = currentName;
}

// 正答率バッジを更新する（正答数・総音符数が変わるたびに呼ぶ）
function updateResearchAccuracyDisplay() {
  const nc = parseInt(document.getElementById('researchEditNotesCorrect').value, 10);
  const nt = parseInt(document.getElementById('researchEditNotesTotal').value, 10);
  const el = document.getElementById('researchEditAccuracy');
  if (!isNaN(nc) && !isNaN(nt) && nt > 0) {
    const acc = Math.round(nc / nt * 100);
    el.textContent = `${acc}%`;
    el.className = 'research-accuracy-badge' +
      (acc >= 80 ? ' acc-good' : acc >= 50 ? ' acc-ok' : ' acc-bad');
  } else {
    el.textContent = '';
    el.className = 'research-accuracy-badge';
  }
}

// 選択中の音階と方向から総音符数を自動計算してフィールドに入れ、音符グリッドを初期化する
function updateResearchNotesTotal() {
  const scaleSel = document.getElementById('researchEditScale');
  const scaleOpt = scaleSel.options[scaleSel.selectedIndex];
  const direction = document.getElementById('researchEditDirection').value;
  const ntEl  = document.getElementById('researchEditNotesTotal');
  const ncEl  = document.getElementById('researchEditNotesCorrect');
  const errEl = document.getElementById('researchEditError');

  const catKey  = scaleOpt?.dataset?.categoryKey;
  const scaleId = scaleOpt?.dataset?.scaleId;

  if (!catKey || !scaleId) {
    ntEl.value = '';
    ncEl.removeAttribute('max');
    clearNoteResultsGrid();
    updateResearchAccuracyDisplay();
    return;
  }

  // scalesDataから音階オブジェクトを直接取得して検証
  const scaleObj = scalesData?.categories?.[catKey]?.scales?.[scaleId];
  if (!scaleObj || !scaleObj.notes) {
    ntEl.value = '';
    ncEl.removeAttribute('max');
    clearNoteResultsGrid();
    updateResearchAccuracyDisplay();
    return;
  }

  // buildPracticeNotesを呼び出し、失敗したらscale.notesを直接使う
  let notes;
  try {
    notes = buildPracticeNotes(catKey, scaleId, direction);
  } catch (e) {
    // フォールバック: splitScaleNotesを直接呼ぶ
    try {
      const parts = splitScaleNotes(scaleObj);
      notes = direction === 'down' ? parts.down
            : direction === 'updown' ? parts.updown
            : parts.up;
    } catch (e2) {
      notes = scaleObj.notes;
    }
  }

  // notesがundefinedの場合（directionが既知の値に合わない等）scaleObj.notesを使う
  if (!notes) notes = scaleObj.notes;

  const nt = notes.length;
  ntEl.value = nt;
  ncEl.setAttribute('max', nt);
  const nc = parseInt(ncEl.value, 10);
  if (!isNaN(nc) && nc > nt) ncEl.value = nt;
  initNoteResultsGrid(notes, null);
  updateResearchAccuracyDisplay();
}

// ===== 音符ごとの詳細設定グリッド =====

// noteObjs: buildPracticeNotes() の返り値（.note/.string を持つ配列）
// existingResults: 実演後の note_results、またはnull（デフォルトはすべて正解）
function initNoteResultsGrid(noteObjs, existingResults) {
  if (!noteObjs || noteObjs.length === 0) {
    clearNoteResultsGrid();
    return;
  }
  adminNoteResultsData = noteObjs.map((n, i) => {
    const ex = existingResults && existingResults[i];
    return {
      note:    n.note,
      string:  n.string,
      turn:    n.turn || false,
      outcome: ex ? ex.outcome : 'correct',
      cents:   ex ? (ex.cents ?? 0) : 0,
    };
  });
  adminNoteResultsGridActive = true;
  // セクションとbodyを自動展開
  document.getElementById('noteResultsSection').style.display = '';
  const body    = document.getElementById('noteResultsBody');
  const heading = document.getElementById('noteResultsHeading');
  if (body) body.style.display = '';
  const arrow = heading?.querySelector('.collapsible-arrow');
  if (arrow) arrow.textContent = '▲';
  renderNoteResultsGrid();
  syncNotesCorrectFromGrid();
}

const OUTCOME_LABELS = { correct: '正解', near: '惜しい', wrong: '不正解', retry: 'やり直し' };
const STRING_SHORT   = { G: 'G線', D: 'D線', A: 'A線', E: 'E線' };

function computeOutcomeFromCents(cents) {
  const abs = Math.abs(parseFloat(cents) || 0);
  if (abs <= correctCents) return 'correct';
  if (abs <= closeCents)   return 'near';
  return 'wrong';
}

function nrRowClasses(r) {
  return `nr-row nr-outcome-${r.outcome}${r.turn ? ' nr-turn-note' : ''}`;
}

function renderNoteResultsGrid() {
  const grid = document.getElementById('noteResultsGrid');
  grid.innerHTML = adminNoteResultsData.map((r, i) => {
    const noteLabel = noteDisplayLabel(r.note);
    const strLabel  = r.string || '';
    const turnMark  = r.turn ? '<span class="nr-turn-mark">★</span>' : '';
    return `<div class="${nrRowClasses(r)}" data-idx="${i}">
      <span class="nr-name">${noteLabel}${turnMark}</span>
      <span class="nr-str">${strLabel}</span>
      <select class="nr-outcome-sel" data-idx="${i}">
        <option value="correct"${r.outcome === 'correct' ? ' selected' : ''}>○ 正解</option>
        <option value="near"${r.outcome === 'near' ? ' selected' : ''}>△ 惜しい</option>
        <option value="wrong"${r.outcome === 'wrong' ? ' selected' : ''}>× 不正解</option>
      </select>
      <input class="nr-cents" type="number" data-idx="${i}"
             value="${r.cents ?? 0}" min="-9999" max="9999" step="1">
      <span class="nr-unit">¢</span>
    </div>`;
  }).join('');

  grid.querySelectorAll('.nr-outcome-sel').forEach(sel => {
    sel.addEventListener('change', e => {
      const idx = parseInt(e.target.dataset.idx, 10);
      adminNoteResultsData[idx].outcome = e.target.value;
      const row = e.target.closest('.nr-row');
      row.className = nrRowClasses(adminNoteResultsData[idx]);
      syncNotesCorrectFromGrid();
    });
  });
  grid.querySelectorAll('.nr-cents').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const cents = parseFloat(e.target.value) || 0;
      adminNoteResultsData[idx].cents = cents;
      // セント値から自動評価（retryは手動設定優先）
      const cur = adminNoteResultsData[idx].outcome;
      if (cur !== 'retry') {
        const auto = computeOutcomeFromCents(cents);
        adminNoteResultsData[idx].outcome = auto;
        const sel = e.target.closest('.nr-row').querySelector('.nr-outcome-sel');
        if (sel) sel.value = auto;
        e.target.closest('.nr-row').className = nrRowClasses(adminNoteResultsData[idx]);
        syncNotesCorrectFromGrid();
      }
    });
  });
}

// グリッドの内容から正答数・総音符数を自動計算してフィールドに反映する
function syncNotesCorrectFromGrid() {
  if (!adminNoteResultsGridActive || adminNoteResultsData.length === 0) return;
  const correct = adminNoteResultsData.filter(r => r.outcome === 'correct').length;
  const total   = adminNoteResultsData.length;
  const ncEl = document.getElementById('researchEditNotesCorrect');
  const ntEl = document.getElementById('researchEditNotesTotal');
  ncEl.value    = correct;
  ntEl.value    = total;
  ncEl.setAttribute('max', total);
  ntEl.setAttribute('max', total);
  ncEl.readOnly = true;   // グリッドから自動計算中は手動編集不可
  updateResearchAccuracyDisplay();
}

function clearNoteResultsGrid() {
  adminNoteResultsData = [];
  adminNoteResultsGridActive = false;
  document.getElementById('noteResultsSection').style.display = 'none';
  document.getElementById('noteResultsGrid').innerHTML = '';
  // 正答数の readOnly を解除（グリッド無効時は手動入力可能）
  const ncEl = document.getElementById('researchEditNotesCorrect');
  if (ncEl) ncEl.readOnly = false;
  // 総音符数は常に読み取り専用（音階・方向から自動計算）
}

// フェーズ変更時: baseline/test → ロードマップで音階を絞り込み、方向・BPMを自動入力して無効化
//                practice → 全音階を表示して全項目を編集可能にする
function onResearchPhaseChange() {
  const phase         = document.getElementById('researchEditPhase').value;
  const isMeasurement = phase === 'baseline' || phase === 'test';
  const directionEl   = document.getElementById('researchEditDirection');
  const bpmEl         = document.getElementById('researchEditBpm');
  const modeRow       = document.getElementById('researchModeRow');
  const scaleHint     = document.getElementById('researchScaleHint');
  const dirHint       = document.getElementById('researchDirectionHint');
  const bpmHint       = document.getElementById('researchBpmHint');

  if (isMeasurement && researchSubjectSteps.length > 0) {
    // 音階をロードマップの音階のみに絞る（重複排除）
    const sel         = document.getElementById('researchEditScale');
    const currentName = sel.value;
    sel.innerHTML     = '<option value="">（音階を選択）</option>';
    const seen = new Set();
    researchSubjectSteps.forEach(step => {
      if (seen.has(step.scale_id)) return;
      seen.add(step.scale_id);
      const scaleName = scalesData.categories?.[step.category_key]?.scales?.[step.scale_id]?.name || '';
      if (!scaleName) return;
      const opt = document.createElement('option');
      opt.value               = scaleName;
      opt.dataset.scaleId     = step.scale_id;
      opt.dataset.categoryKey = step.category_key;
      opt.textContent         = scaleName;
      sel.appendChild(opt);
    });
    // 既存の選択を復元、なければ先頭の音階を自動選択
    sel.value = currentName;
    if (!sel.value && sel.options.length > 1) sel.value = sel.options[1].value;
    scaleHint.style.display = '';

    // 選択中の音階に対応するステップから方向とBPMを自動入力
    const selOpt = sel.options[sel.selectedIndex];
    if (selOpt && selOpt.dataset.scaleId) {
      const scaleId = parseInt(selOpt.dataset.scaleId, 10);
      const step    = researchSubjectSteps.find(s => s.scale_id === scaleId);
      if (step) {
        directionEl.value = step.direction || 'up';
        if (step.bpm != null) bpmEl.value = step.bpm;
      }
    }
    directionEl.disabled   = true;
    bpmEl.disabled         = true;
    dirHint.style.display  = '';
    bpmHint.style.display  = '';
    modeRow.style.display  = 'none';

  } else if (isMeasurement) {
    // ロードマップなし: 自由選択可能だが mode は非表示
    directionEl.disabled    = false;
    bpmEl.disabled          = false;
    scaleHint.style.display = 'none';
    dirHint.style.display   = 'none';
    bpmHint.style.display   = 'none';
    modeRow.style.display   = 'none';

  } else {
    // 自由練習: 全音階を表示して全項目を編集可能に
    const sel         = document.getElementById('researchEditScale');
    const currentName = sel.value;
    populateResearchScaleSelect(currentName);
    directionEl.disabled    = false;
    bpmEl.disabled          = false;
    scaleHint.style.display = 'none';
    dirHint.style.display   = 'none';
    bpmHint.style.display   = 'none';
    modeRow.style.display   = '';
  }
}

// 指定アカウントの被験者ロードマップを取得して researchSubjectSteps にキャッシュし、フェーズに応じた UI を更新する
async function loadResearchSubjectSteps(profileId) {
  researchSubjectSteps = [];
  if (!profileId) { onResearchPhaseChange(); return; }
  try {
    const assignment = await getSubjectAssignment(profileId);
    researchSubjectSteps = assignment?.steps || [];
  } catch (_) {}
  onResearchPhaseChange();
}

async function loadResearchData() {
  const errorEl = document.getElementById('researchError');
  errorEl.style.display = 'none';

  const profileId = document.getElementById('researchProfileFilter').value || null;
  try {
    researchRecords = await getAllHistory(profileId ? parseInt(profileId, 10) : null);
    renderResearchTable();
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
}

function renderResearchTable() {
  const wrap      = document.getElementById('researchTableWrap');
  const tbody     = document.getElementById('researchTableBody');
  const countEl   = document.getElementById('researchCount');
  const emptyNote = document.getElementById('researchEmptyNote');

  countEl.textContent = `${researchRecords.length}件`;

  if (researchRecords.length === 0) {
    wrap.style.display      = 'none';
    emptyNote.style.display = '';
    return;
  }
  wrap.style.display      = '';
  emptyNote.style.display = 'none';

  const phaseBadge = {
    baseline: '<span class="phase-badge phase-baseline">事前計測</span>',
    test:     '<span class="phase-badge phase-test">事後計測</span>',
    practice: '<span class="phase-badge phase-practice">自由練習</span>',
  };

  tbody.innerHTML = researchRecords.map(r => `
    <tr data-id="${r.id}">
      <td>${phaseBadge[r.phase] || escapeHtml(r.phase || '')}</td>
      <td>${escapeHtml(r.profile_name || '')}</td>
      <td>${escapeHtml(r.scale || '')}</td>
      <td class="research-accuracy">${r.accuracy != null ? r.accuracy + '%' : '—'}</td>
      <td>${r.notes_correct ?? 0} / ${r.notes_total ?? 0}</td>
      <td>${r.bpm ?? '—'}</td>
      <td>${r.practiced_at || ''}</td>
      <td>
        <button type="button" class="btn-secondary btn-sm research-edit-btn" data-id="${r.id}">✏️ 編集</button>
        <button type="button" class="btn-danger btn-sm research-delete-btn" data-id="${r.id}">🗑️</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.research-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openResearchEditModal(parseInt(btn.dataset.id, 10)));
  });
  tbody.querySelectorAll('.research-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => confirmResearchDelete(parseInt(btn.dataset.id, 10)));
  });
}

function openResearchEditModal(id) {
  const r = researchRecords.find(x => x.id === id);
  if (!r) return;
  researchEditingId = id;
  researchAddMode   = false;

  document.getElementById('researchModalTitle').textContent      = '✏️ 記録を編集';
  document.getElementById('researchAddProfileRow').style.display = 'none';
  document.getElementById('researchEditMeta').style.display      = '';
  document.getElementById('researchEditId').textContent          = r.id;
  document.getElementById('researchEditAccount').textContent     = r.profile_name || '';
  populateResearchScaleSelect(r.scale || '');
  document.getElementById('researchEditDirection').value         = r.direction || 'up';
  document.getElementById('researchEditMode').value              = r.mode || 'step';
  document.getElementById('researchEditBpm').value               = r.bpm ?? '';
  document.getElementById('researchEditNotesCorrect').value      = r.notes_correct ?? 0;
  document.getElementById('researchEditNotesTotal').value        = r.notes_total   ?? 0;
  document.getElementById('researchEditPhase').value             = r.phase || 'practice';
  document.getElementById('researchEditPracticedAt').value       = dbDateToDatetimeLocal(r.practiced_at || '');
  document.getElementById('researchEditError').style.display     = 'none';
  document.getElementById('researchEditSuccess').style.display   = 'none';
  adminLiveNoteResults = [];
  clearNoteResultsGrid(); // 編集モードではグリッドをいったんクリア（手動で展開して設定可能）
  updateResearchAccuracyDisplay();
  onResearchPhaseChange(); // フェーズに合わせて初期表示を設定（ステップ未取得の段階）
  document.getElementById('researchEditOverlay').style.display   = 'flex';
  // 被験者ロードマップを非同期で取得し、フェーズ UI を再適用する
  loadResearchSubjectSteps(r.profile_id);
}

// fixedProfileId: 記録タブから開いたとき等、アカウントを固定したい場合に渡す
function openResearchAddModal(fixedProfileId) {
  researchEditingId     = null;
  researchAddMode       = true;
  researchSubjectSteps  = [];

  document.getElementById('researchModalTitle').textContent = '＋ 記録を追加';
  document.getElementById('researchEditMeta').style.display = 'none';

  // アカウント選択肢を allProfilesCache から組み立てる
  const addSel = document.getElementById('researchAddProfileSelect');
  addSel.innerHTML = '<option value="">アカウントを選択...</option>' +
    allProfilesCache.map(p => {
      const tag = p.is_subject === 'yes' ? ' 🧪' : '';
      return `<option value="${p.id}">${escapeHtml(p.name)}${tag}</option>`;
    }).join('');

  // 固定IDが渡されていればそれを選択、なければフィルターの現在値
  const preSelectedId = fixedProfileId || document.getElementById('researchProfileFilter').value || '';
  addSel.value = String(preSelectedId);
  document.getElementById('researchAddProfileRow').style.display = '';

  // 入力欄をリセット
  populateResearchScaleSelect('');
  document.getElementById('researchEditDirection').value        = 'up';
  document.getElementById('researchEditMode').value             = 'tempo';
  document.getElementById('researchEditBpm').value              = '';
  document.getElementById('researchEditNotesCorrect').value     = 0;
  document.getElementById('researchEditNotesTotal').value       = 0;
  document.getElementById('researchEditPhase').value            = 'practice';
  // 現在日時をデフォルトにセット
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('researchEditPracticedAt').value =
    `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  document.getElementById('researchEditError').style.display   = 'none';
  document.getElementById('researchEditSuccess').style.display = 'none';
  adminLiveNoteResults = [];
  clearNoteResultsGrid();
  updateResearchAccuracyDisplay();
  onResearchPhaseChange(); // 初期フェーズ（practice）に合わせてモード行などを表示
  document.getElementById('researchEditOverlay').style.display = 'flex';

  // 事前に選択されているアカウントがあれば被験者ロードマップを読み込み、フェーズ UI を再適用する
  if (preSelectedId) loadResearchSubjectSteps(parseInt(preSelectedId, 10));
  baselineWrongNotes = [];
  document.getElementById('baselineWrongPracticeRow').style.display = 'none';
  checkBaselineWrongNotes();
}

document.getElementById('researchEditCancelBtn').addEventListener('click', () => {
  document.getElementById('researchEditOverlay').style.display = 'none';
  researchEditingId = null;
  researchAddMode   = false;
});

document.getElementById('researchEditSaveBtn').addEventListener('click', async () => {
  if (!researchAddMode && researchEditingId == null) return;
  const errorEl   = document.getElementById('researchEditError');
  const successEl = document.getElementById('researchEditSuccess');
  errorEl.style.display   = 'none';
  successEl.style.display = 'none';

  const nc        = parseInt(document.getElementById('researchEditNotesCorrect').value, 10);
  const bpmVal    = document.getElementById('researchEditBpm').value;
  const direction = document.getElementById('researchEditDirection').value;
  const scaleSel  = document.getElementById('researchEditScale');
  const scaleOpt  = scaleSel.options[scaleSel.selectedIndex];

  // 総音数はフィールドから読む（音階・方向変更時に自動計算済み、手動上書きも可能）
  const ntRaw = document.getElementById('researchEditNotesTotal').value;
  const nt = ntRaw === '' ? 0 : parseInt(ntRaw, 10);

  const fields = {
    scale:         scaleOpt?.value || '',
    direction,
    mode:          document.getElementById('researchEditMode').value,
    bpm:           bpmVal === '' ? null : parseInt(bpmVal, 10),
    notes_correct: isNaN(nc) ? 0 : nc,
    notes_total:   isNaN(nt) ? 0 : nt,
    phase:         document.getElementById('researchEditPhase').value,
    practiced_at:  datetimeLocalToDbDate(document.getElementById('researchEditPracticedAt').value),
  };

  try {
    if (researchAddMode) {
      const profileId = parseInt(document.getElementById('researchAddProfileSelect').value, 10);
      if (!profileId) {
        errorEl.textContent   = 'アカウントを選択してください';
        errorEl.style.display = 'block';
        return;
      }
      // グリッドが有効ならグリッドのデータ、ライブ演奏後でグリッドなしならliveResults、両方なければnone
      const noteResults = adminNoteResultsGridActive && adminNoteResultsData.length > 0
        ? adminNoteResultsData
        : adminLiveNoteResults.length > 0 ? adminLiveNoteResults : undefined;
      await createHistoryForProfile({ profile_id: profileId, ...fields,
        ...(noteResults ? { note_results: noteResults } : {}) });
      successEl.textContent   = '記録を追加しました';
      successEl.style.display = 'block';
      await loadResearchData();
      await loadStatsResearchData();
    } else {
      await updateHistoryRecord(researchEditingId, fields);
      const acc = fields.notes_total > 0 ? Math.round(fields.notes_correct / fields.notes_total * 1000) / 10 : 0;
      const patch = { ...fields, accuracy: acc };
      const idx = researchRecords.findIndex(x => x.id === researchEditingId);
      if (idx >= 0) researchRecords[idx] = { ...researchRecords[idx], ...patch };
      const idx2 = statsResearchRecords.findIndex(x => x.id === researchEditingId);
      if (idx2 >= 0) statsResearchRecords[idx2] = { ...statsResearchRecords[idx2], ...patch };
      successEl.textContent   = '保存しました';
      successEl.style.display = 'block';
      renderResearchTable();
      renderStatsResearchTable();
    }
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
});

document.getElementById('researchAddBtn').addEventListener('click', openResearchAddModal);

// 追加モードでアカウントを変更したとき、被験者ロードマップを再読み込みしてBPM自動入力に備える
document.getElementById('researchAddProfileSelect').addEventListener('change', () => {
  const profileId = parseInt(document.getElementById('researchAddProfileSelect').value, 10);
  loadResearchSubjectSteps(profileId || null);
  checkBaselineWrongNotes();
});

document.getElementById('researchEditPracticedAt').addEventListener('change', checkBaselineWrongNotes);

// 音階が変わったとき: baseline/testかつロードマップあり → 方向・BPMを更新、常に総音符数も更新
document.getElementById('researchEditScale').addEventListener('change', () => {
  const phase = document.getElementById('researchEditPhase').value;
  if ((phase === 'baseline' || phase === 'test') && researchSubjectSteps.length > 0) {
    const sel = document.getElementById('researchEditScale');
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.dataset.scaleId) {
      const step = researchSubjectSteps.find(s => s.scale_id === parseInt(opt.dataset.scaleId, 10));
      if (step) {
        document.getElementById('researchEditDirection').value = step.direction || 'up';
        if (step.bpm != null) document.getElementById('researchEditBpm').value = step.bpm;
      }
    }
  }
  updateResearchNotesTotal();
});
// フェーズが変わったとき、音階・方向・BPM・モード行を再構築する
document.getElementById('researchEditPhase').addEventListener('change', onResearchPhaseChange);
// 方向が変わったとき: 総音符数を更新する
document.getElementById('researchEditDirection').addEventListener('change', updateResearchNotesTotal);
// 正答数・総音符数が変わったとき: 正答率を更新する
document.getElementById('researchEditNotesCorrect').addEventListener('input', function() {
  const max = parseInt(this.getAttribute('max'), 10);
  const val = parseInt(this.value, 10);
  if (!isNaN(max) && !isNaN(val) && val > max) this.value = max;
  if (!isNaN(val) && val < 0) this.value = 0;
  updateResearchAccuracyDisplay();
});

// 「実際に弾いて記録する」ボタン: モーダルの設定を使って実際にバイオリンを演奏し、結果をモーダルに戻す
function startAdminLivePractice() {
  const scaleSel = document.getElementById('researchEditScale');
  const scaleOpt = scaleSel.options[scaleSel.selectedIndex];
  if (!scaleOpt || !scaleOpt.value || !scaleOpt.dataset.scaleId) {
    document.getElementById('researchEditError').textContent   = '音階を選択してください';
    document.getElementById('researchEditError').style.display = 'block';
    return;
  }
  const catKey    = scaleOpt.dataset.categoryKey;
  const scaleKey  = scaleOpt.dataset.scaleId;
  adminLiveScaleName = scaleOpt.value;
  adminLiveDirection = document.getElementById('researchEditDirection').value;
  adminLiveMode      = document.getElementById('researchEditMode')?.value || 'tempo';
  adminLiveBpm       = parseInt(document.getElementById('researchEditBpm').value, 10) || 60;

  practiceNotes     = buildPracticeNotes(catKey, scaleKey, adminLiveDirection);
  currentIndex      = 0;
  notesCorrect      = 0;
  practiceResults   = [];
  currentNoteMissed = false;
  showCurrentGlow   = true;
  activeSource      = detector;
  isDemoRun         = false;
  adminLiveRecordMode = true;
  adminLiveNoteResults = [];

  document.getElementById('researchEditOverlay').style.display = 'none';
  document.getElementById('setupCard').style.display    = 'none';
  document.getElementById('practiceCard').style.display = 'block';
  document.getElementById('completeCard').style.display = 'none';

  const dirLabels = { up: '上行', down: '下行', updown: '上下' };
  const dirLabel  = dirLabels[adminLiveDirection] || adminLiveDirection;
  const badge = document.getElementById('modeBadge');
  badge.textContent = adminLiveMode === 'step'
    ? `🎯 1音ずつモード　（管理者ライブ記録: ${adminLiveScaleName} ${dirLabel}）`
    : `🥁 テンポモード ${adminLiveBpm} BPM　（管理者ライブ記録: ${adminLiveScaleName} ${dirLabel}）`;

  renderNoteTrack();

  if (adminLiveMode === 'step') {
    startStepMode();
  } else {
    showCurrentGlow = false;
    showCurrentNote();
    showBeginCountdownBtn(() => startTempoMode(adminLiveBpm));
  }
}

document.getElementById('adminLivePracticeBtn').addEventListener('click', startAdminLivePractice);

// 当日のbaseline記録に不正確な音符があるか確認し、ボタン行の表示を切り替える
async function checkBaselineWrongNotes() {
  const row  = document.getElementById('baselineWrongPracticeRow');
  const hint = document.getElementById('baselineWrongHint');
  baselineWrongNotes = [];

  if (!researchAddMode) { row.style.display = 'none'; return; }

  const profileId = parseInt(document.getElementById('researchAddProfileSelect').value, 10);
  const dtVal     = document.getElementById('researchEditPracticedAt').value;
  if (!profileId || !dtVal) { row.style.display = 'none'; return; }

  const date = dtVal.substring(0, 10); // YYYY-MM-DD
  try {
    const resp = await fetch(`/api/history/baseline-wrong-notes?profile_id=${profileId}&date=${date}`);
    if (!resp.ok) { row.style.display = 'none'; return; }
    const data = await resp.json();
    baselineWrongNotes = data.notes || [];
    hint.textContent = `不正確な音：${baselineWrongNotes.length}音符`;
    row.style.display = baselineWrongNotes.length > 0 ? '' : 'none';
  } catch {
    row.style.display = 'none';
  }
}

// 事前練習の不正確な音だけで1音ずつ練習を開始（adminLiveRecordMode で結果をモーダルへ返す）
function startAdminBaselineWrongPractice() {
  if (baselineWrongNotes.length === 0) return;

  const scaleSel = document.getElementById('researchEditScale');
  adminLiveScaleName = scaleSel.options[scaleSel.selectedIndex]?.value || '事前練習';
  adminLiveDirection = document.getElementById('researchEditDirection').value;
  adminLiveMode      = 'step';
  adminLiveBpm       = parseInt(document.getElementById('researchEditBpm').value, 10) || 60;

  practiceNotes     = baselineWrongNotes;
  currentIndex      = 0;
  notesCorrect      = 0;
  practiceResults   = [];
  currentNoteMissed = false;
  showCurrentGlow   = true;
  activeSource      = detector;
  isDemoRun         = false;
  adminLiveRecordMode  = true;
  adminLiveNoteResults = [];

  document.getElementById('researchEditOverlay').style.display = 'none';
  document.getElementById('setupCard').style.display    = 'none';
  document.getElementById('practiceCard').style.display = 'block';
  document.getElementById('completeCard').style.display = 'none';
  document.getElementById('modeBadge').textContent =
    `🎯 1音ずつモード　（事前練習の不正確な音: ${adminLiveScaleName}）`;

  renderNoteTrack();
  startStepMode();
}

document.getElementById('adminBaselineWrongBtn').addEventListener('click', startAdminBaselineWrongPractice);

async function confirmResearchDelete(id) {
  const r = researchRecords.find(x => x.id === id);
  if (!r) return;
  const label = `ID:${r.id}　${r.profile_name}　${r.scale}　${r.practiced_at}`;
  if (!confirm(`この記録を削除しますか？\n${label}`)) return;

  const errorEl = document.getElementById('researchError');
  errorEl.style.display = 'none';
  try {
    await deleteHistoryRecord(id);
    researchRecords = researchRecords.filter(x => x.id !== id);
    renderResearchTable();
    document.getElementById('researchCount').textContent = `${researchRecords.length}件`;
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
}

document.getElementById('researchLoadBtn').addEventListener('click', loadResearchData);

// フィルターのアカウントを切り替えたら自動で再読み込み
document.getElementById('researchProfileFilter').addEventListener('change', loadResearchData);

// 研究データタブを開いたとき、プロフィール選択肢を最新にしてから自動でデータ取得
async function initResearchTabData() {
  const sel = document.getElementById('researchProfileFilter');
  const prevVal = sel.value;
  try {
    const profiles = await getProfiles();
    sel.innerHTML = '<option value="">すべてのアカウント</option>' +
      profiles.map(p => {
        const tag = p.is_subject === 'yes' ? ' 🧪' : '';
        return `<option value="${p.id}">${escapeHtml(p.name)}${tag}</option>`;
      }).join('');
    sel.value = prevVal;
  } catch (_) { /* 失敗しても続行 */ }
  await loadResearchData();
}

// ===========================
// 記録タブ内の研究データ編集セクション（管理者・研究者用）
// ===========================
let statsResearchRecords = [];

async function loadStatsResearchData() {
  const errorEl = document.getElementById('statsResearchError');
  errorEl.style.display = 'none';
  try {
    statsResearchRecords = await getAllHistory(currentProfileId || null);
    renderStatsResearchTable();
  } catch (err) {
    errorEl.textContent   = err.message;
    errorEl.style.display = 'block';
  }
}

function renderStatsResearchTable() {
  const wrap      = document.getElementById('statsResearchTableWrap');
  const tbody     = document.getElementById('statsResearchTableBody');
  const countEl   = document.getElementById('statsResearchCount');
  const emptyNote = document.getElementById('statsResearchEmptyNote');

  countEl.textContent = `${statsResearchRecords.length}件`;

  if (statsResearchRecords.length === 0) {
    wrap.style.display      = 'none';
    emptyNote.style.display = '';
    return;
  }
  wrap.style.display      = '';
  emptyNote.style.display = 'none';

  const phaseBadge = {
    baseline: '<span class="phase-badge phase-baseline">事前計測</span>',
    test:     '<span class="phase-badge phase-test">事後計測</span>',
    practice: '<span class="phase-badge phase-practice">自由練習</span>',
  };

  tbody.innerHTML = statsResearchRecords.map(r => `
    <tr data-id="${r.id}">
      <td>${phaseBadge[r.phase] || escapeHtml(r.phase || '')}</td>
      <td>${escapeHtml(r.scale || '')}</td>
      <td class="research-accuracy">${r.accuracy != null ? r.accuracy + '%' : '—'}</td>
      <td>${r.notes_correct ?? 0} / ${r.notes_total ?? 0}</td>
      <td>${r.bpm ?? '—'}</td>
      <td>${r.practiced_at || ''}</td>
      <td>
        <button type="button" class="btn-secondary btn-sm stats-research-edit-btn" data-id="${r.id}">✏️ 編集</button>
        <button type="button" class="btn-danger btn-sm stats-research-delete-btn" data-id="${r.id}">🗑️</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.stats-research-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // 管理タブの researchRecords に一時コピーして既存モーダルを再利用
      researchRecords = statsResearchRecords;
      openResearchEditModal(parseInt(btn.dataset.id, 10));
    });
  });
  tbody.querySelectorAll('.stats-research-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id      = parseInt(btn.dataset.id, 10);
      const r       = statsResearchRecords.find(x => x.id === id);
      const label   = r ? `ID ${r.id}（${r.scale || ''}・${r.practiced_at || ''}）` : `ID ${id}`;
      const errorEl = document.getElementById('statsResearchError');
      if (!confirm(`この記録を削除しますか？\n${label}`)) return;
      try {
        await deleteHistoryRecord(id);
        await loadStatsResearchData();
      } catch (err) {
        errorEl.textContent   = err.message;
        errorEl.style.display = 'block';
      }
    });
  });
}

document.getElementById('statsResearchAddBtn').addEventListener('click', () => {
  // 現在表示中のアカウントを固定して追加モーダルを開く
  openResearchAddModal(currentProfileId || null);
});

// ===========================
// 研究分析グラフ（管理者・研究者用）
// ===========================
let researchAnalysisData  = [];
let chartDayProgress      = null;
let chartImprovement      = null;
let chartByScale          = null;
let chartSubjects         = null;

async function loadResearchAnalysis() {
  const errorEl = document.getElementById('researchAnalysisError');
  errorEl.style.display = 'none';
  try {
    const res  = await apiFetch('/api/research-analysis');
    researchAnalysisData = await res.json();
    populateResearchAnalysisSubjectFilter();
    renderResearchAnalysisCharts();
  } catch (err) {
    errorEl.textContent   = err.message || '取得に失敗しました';
    errorEl.style.display = 'block';
  }
}

function populateResearchAnalysisSubjectFilter() {
  const sel = document.getElementById('researchAnalysisSubjectFilter');
  const subjects = [...new Set(researchAnalysisData.map(r => r.subject))];
  sel.innerHTML = '<option value="">全被験者（平均）</option>' +
    subjects.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
}

document.getElementById('researchAnalysisSubjectFilter').addEventListener('change', renderResearchAnalysisCharts);
document.getElementById('researchAnalysisReloadBtn').addEventListener('click', loadResearchAnalysis);

function renderResearchAnalysisCharts() {
  const filterSubject = document.getElementById('researchAnalysisSubjectFilter').value;
  let data = filterSubject
    ? researchAnalysisData.filter(r => r.subject === filterSubject)
    : researchAnalysisData;

  // 音階ごとにグループ化
  const scaleMap = {};  // scale → { baseline: {1:acc, 2:acc,...}, test: {1:acc,...} }
  data.forEach(r => {
    if (!scaleMap[r.scale]) scaleMap[r.scale] = { baseline: {}, test: {} };
    const bucket = scaleMap[r.scale][r.phase];
    if (!bucket[r.day]) { bucket[r.day] = []; }
    bucket[r.day].push(r.accuracy);
  });
  // 平均を出す
  const scaleSummary = {};  // scale → { baseline: [day1,day2,...], test: [...] }
  Object.keys(scaleMap).forEach(scale => {
    const b = scaleMap[scale].baseline;
    const t = scaleMap[scale].test;
    const days = [...new Set([...Object.keys(b), ...Object.keys(t)].map(Number))].sort((a,v) => a-v);
    scaleSummary[scale] = {
      days,
      baseline: days.map(d => b[d] ? b[d].reduce((s,v) => s+v,0)/b[d].length : null),
      test:     days.map(d => t[d] ? t[d].reduce((s,v) => s+v,0)/t[d].length : null),
    };
  });

  const scales = Object.keys(scaleSummary);
  const palette = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];

  // --- グラフ1: 日別 事前/事後 推移（全音階） ---
  const ctx1 = document.getElementById('chartResearchDayProgress').getContext('2d');
  if (chartDayProgress) chartDayProgress.destroy();
  const ds1 = [];
  scales.forEach((scale, si) => {
    const col = palette[si % palette.length];
    const { days, baseline, test } = scaleSummary[scale];
    ds1.push({ label: `${scale} 事前`, data: baseline.map((v,i) => ({x: days[i], y: v})), borderColor: col, backgroundColor: col+'33', borderDash: [5,3], tension: 0.3 });
    ds1.push({ label: `${scale} 事後`, data: test.map((v,i)     => ({x: days[i], y: v})), borderColor: col, backgroundColor: col+'88', tension: 0.3 });
  });
  chartDayProgress = new Chart(ctx1, { type: 'line', data: { datasets: ds1 },
    options: { scales: { x: { type: 'linear', title: { display: true, text: '日目' } }, y: { min: 0, max: 100, title: { display: true, text: '正答率 (%)' } } },
               plugins: { legend: { position: 'bottom' } } } });

  // --- グラフ2: 1日ごとの改善量（事後 − 事前） ---
  const ctx2 = document.getElementById('chartResearchImprovement').getContext('2d');
  if (chartImprovement) chartImprovement.destroy();
  const allDays = [...new Set(data.map(r => r.day))].sort((a,b) => a-b);
  const ds2 = scales.map((scale, si) => {
    const col = palette[si % palette.length];
    const { days, baseline, test } = scaleSummary[scale];
    const improvements = days.map((_, i) => {
      const b = baseline[i], t = test[i];
      return (b != null && t != null) ? +(t - b).toFixed(1) : null;
    });
    return { label: scale, data: improvements, backgroundColor: col+'cc', borderColor: col, borderWidth: 1 };
  });
  chartImprovement = new Chart(ctx2, { type: 'bar',
    data: { labels: (scaleSummary[scales[0]]?.days || allDays).map(d => `${d}日目`), datasets: ds2 },
    options: { scales: { y: { title: { display: true, text: '改善量 (pp)' } } },
               plugins: { legend: { position: 'bottom' } } } });

  // --- グラフ3: 音階別 平均改善量 ---
  const ctx3 = document.getElementById('chartResearchByScale').getContext('2d');
  if (chartByScale) chartByScale.destroy();
  const avgImprovements = scales.map(scale => {
    const { baseline, test } = scaleSummary[scale];
    const diffs = baseline.map((b,i) => (b != null && test[i] != null) ? test[i] - b : null).filter(v => v !== null);
    return diffs.length ? +(diffs.reduce((s,v) => s+v,0)/diffs.length).toFixed(1) : 0;
  });
  chartByScale = new Chart(ctx3, { type: 'bar',
    data: { labels: scales, datasets: [{ label: '平均改善量 (pp)', data: avgImprovements, backgroundColor: scales.map((_,i) => palette[i%palette.length]+'cc'), borderColor: scales.map((_,i) => palette[i%palette.length]), borderWidth: 1 }] },
    options: { scales: { y: { title: { display: true, text: '改善量 (pp)' } } }, plugins: { legend: { display: false } } } });

  // --- グラフ4: 被験者別 全体改善量（初日事前→最終日事後） ---
  const ctx4 = document.getElementById('chartResearchSubjects').getContext('2d');
  if (chartSubjects) chartSubjects.destroy();
  const subjectMap = {};
  researchAnalysisData.forEach(r => {
    if (!subjectMap[r.subject]) subjectMap[r.subject] = { baseline: [], test: [] };
    subjectMap[r.subject][r.phase].push(r.accuracy);
  });
  const subjectNames = Object.keys(subjectMap);
  const subjectAvgBase = subjectNames.map(s => {
    const vals = subjectMap[s].baseline;
    return vals.length ? +(vals.reduce((a,v) => a+v,0)/vals.length).toFixed(1) : 0;
  });
  const subjectAvgTest = subjectNames.map(s => {
    const vals = subjectMap[s].test;
    return vals.length ? +(vals.reduce((a,v) => a+v,0)/vals.length).toFixed(1) : 0;
  });
  chartSubjects = new Chart(ctx4, { type: 'bar',
    data: { labels: subjectNames, datasets: [
      { label: '事前平均', data: subjectAvgBase, backgroundColor: '#93c5fd', borderColor: '#3b82f6', borderWidth: 1 },
      { label: '事後平均', data: subjectAvgTest, backgroundColor: '#6ee7b7', borderColor: '#10b981', borderWidth: 1 },
    ]},
    options: { scales: { y: { min: 0, max: 100, title: { display: true, text: '正答率 (%)' } } }, plugins: { legend: { position: 'bottom' } } } });
}

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
      initResultDisplaySetting(); // 失敗したら選択状態を元に戻す
    }
  });
});

// ログイン成功直後の共通処理：アプリ本体を表示し、必要なデータを読み込む
async function onLoggedIn() {
  // viewer ロールは専用ダッシュボードへリダイレクト
  if (currentUser && currentUser.role === 'viewer') {
    window.location.href = '/viewer';
    return;
  }
  isGuest = false;
  resetGuestUI();
  currentProfileId = currentUser.id;
  showApp();
  renderAccountBar();
  await loadScales();
  await loadAppSettings();
  initResultDisplaySetting();
  initPassThresholdSetting();
  initPitchToleranceSetting();
  initVerifyModeSetting();
  await initVerifyModeScalesSetting();
  initDemoModeUI();
  initSubjectExperienceTab();
  resetAdminOnlyPracticeSettings();
  initPracticeSaveHistoryUI();
  updateStepHoldModeVisibility();
  initSubjectAccountCreation();
  initResearcherAccountCreation();
  await initStatsProfileSelector();
  initAdminTab(); // allProfilesCache が埋まった後に呼ぶ（verifySubjectSelect の初期化に必要）
  initAccountDeletionUI();
  initSignupSetting();
  initStepHoldGeneralSetting();
  initScaleBuilder();
  await initSubjectPractice();
  await renderHistory();
  statsLoaded = false;
  switchTab('practice');
  renderFingerboardTicks();
}

// ヘッダーに、ログイン中の名前・管理者バッジを表示する
function renderAccountBar() {
  document.getElementById('profileName').textContent = currentUser.name;
  const badgeLabels = { admin: '管理者', researcher: '研究者', viewer: '閲覧者' };
  const badgeText   = badgeLabels[currentUser.role];
  document.getElementById('roleBadge').textContent   = badgeText || '';
  document.getElementById('roleBadge').style.display = badgeText ? 'inline-block' : 'none';
  // viewer / admin / researcher は「📊 閲覧」リンクを表示
  const vl = document.getElementById('viewerLink');
  if (vl) vl.style.display = ['viewer','admin','researcher'].includes(currentUser.role) ? '' : 'none';
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
  document.getElementById('logoutBtn').textContent = '🚪 ログイン画面に戻る';
  document.getElementById('logoutBtn').title = 'ログイン画面に戻る';
  document.getElementById('demoTabBtn').style.display    = 'none';
  document.getElementById('subjectExperienceTabBtn').style.display = 'none';
  document.getElementById('statsTabBtn').style.display    = 'none';
  document.getElementById('adminTabBtn').style.display    = 'none';
  document.getElementById('settingsTabBtn').style.display = 'none';
  document.getElementById('historySection').style.display = 'none';
  document.getElementById('guestNote').style.display = 'block';

  // ゲストは管理者・被験者になり得ないので、この2つは必ず既定値に戻し、非表示にする
  // （直前に同じタブで管理者・被験者が使っていた場合、選択状態がDOMに残ったままになるため）
  resetAdminOnlyPracticeSettings();
  document.getElementById('practiceSaveHistoryGroup').style.display = 'none';
  document.getElementById('stepHoldModeGroup').style.display = 'none';
  resetToNormalPracticeSetup();

  await loadScales();
  await loadAppSettings();
  switchTab('practice');
  renderFingerboardTicks();
});

// ゲストモード用に変えていたヘッダー・タブの表示を、通常ログイン用に戻す
function resetGuestUI() {
  document.getElementById('roleBadge').textContent = '管理者';
  document.getElementById('logoutBtn').textContent = '🚪 ログアウト';
  document.getElementById('logoutBtn').title = 'ログアウト';
  document.getElementById('statsTabBtn').style.display   = '';
  document.getElementById('settingsTabBtn').style.display = '';
  document.getElementById('historySection').style.display = '';
  document.getElementById('guestNote').style.display = 'none';
}

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