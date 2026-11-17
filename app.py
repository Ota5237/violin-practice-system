from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import os
import secrets
import json
from datetime import datetime, timedelta

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), 'database', 'history.db')
SECRET_KEY_PATH = os.path.join(os.path.dirname(__file__), 'database', 'secret.key')
DEFAULT_PROFILE_NAME = 'デフォルト'

# 音階のカテゴリー（第1ポジション／2オクターブ）。フロントの選択肢と対応しており固定。
CATEGORY_LABELS = {
    'first_position': '第一ポジションの音階',
    'two_octave':      '2オクターブの音階',
}
VALID_STRINGS = {'G弦', 'D弦', 'A弦', 'E弦'}
VALID_DIRECTIONS = {'up', 'down', 'updown', 'arpeggio'}
SUBJECT_ROADMAP_LENGTH = 16  # 被験者に練習してもらうステップ数（4音階・2ペア×4日×2音階）
MAX_ROADMAP_STEPS = 20      # ロードマップの上限ステップ数

# 音階データに含まれる音名(note)が、周波数対応表(notes.json)に実在するキーかを検証するために読み込む
def get_valid_note_keys():
    notes_path = os.path.join(os.path.dirname(__file__), 'static', 'data', 'notes.json')
    with open(notes_path, encoding='utf-8') as f:
        return set(json.load(f).keys())

# ===== セッション用の秘密鍵（初回起動時に生成してファイルに保存し、以後使い回す） =====
def load_secret_key():
    if os.path.exists(SECRET_KEY_PATH):
        with open(SECRET_KEY_PATH, 'r') as f:
            return f.read().strip()
    os.makedirs(os.path.dirname(SECRET_KEY_PATH), exist_ok=True)
    key = secrets.token_hex(32)
    with open(SECRET_KEY_PATH, 'w') as f:
        f.write(key)
    return key

app.secret_key = load_secret_key()
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)

# ===== DB初期化 =====
def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT    NOT NULL UNIQUE,
                created_at    TEXT    NOT NULL,
                password_hash TEXT,
                role          TEXT    NOT NULL DEFAULT 'user'
            )
        ''')

        conn.execute('''
            CREATE TABLE IF NOT EXISTS history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                scale         TEXT    NOT NULL,
                direction     TEXT    NOT NULL,
                mode          TEXT    NOT NULL DEFAULT 'step',
                bpm           INTEGER,
                notes_correct INTEGER NOT NULL DEFAULT 0,
                notes_total   INTEGER NOT NULL DEFAULT 0,
                accuracy      REAL    NOT NULL DEFAULT 0.0,
                practiced_at  TEXT    NOT NULL
            )
        ''')

        # 練習1回ごとの、音ごとの結果（苦手な音の分析に使う）
        conn.execute('''
            CREATE TABLE IF NOT EXISTS note_results (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                history_id INTEGER NOT NULL,
                note       TEXT    NOT NULL,
                string     TEXT    NOT NULL,
                outcome    TEXT    NOT NULL,
                cents      REAL
            )
        ''')

        # アプリ全体の設定（練習中の音符表示・結果画面の表示形式）。1行だけ持つ設定テーブル。
        # 管理者だけが変更でき、全員（ゲスト含む）の画面に反映される
        conn.execute('''
            CREATE TABLE IF NOT EXISTS app_settings (
                id                  INTEGER PRIMARY KEY CHECK (id = 1),
                result_display_mode TEXT NOT NULL DEFAULT 'accuracy',
                signup_enabled      TEXT NOT NULL DEFAULT 'yes',
                step_hold_general   TEXT NOT NULL DEFAULT 'no',
                pass_threshold      INTEGER NOT NULL DEFAULT 80,
                correct_cents       INTEGER NOT NULL DEFAULT 15,
                close_cents         INTEGER NOT NULL DEFAULT 35,
                verify_mode_direction TEXT    NOT NULL DEFAULT 'up',
                verify_mode_bpm        INTEGER NOT NULL DEFAULT 60,
                verify_mode_step_hold     TEXT NOT NULL DEFAULT 'instant',
                verify_mode_save_history  TEXT NOT NULL DEFAULT 'yes'
            )
        ''')
        existing_settings_cols = {row[1] for row in conn.execute('PRAGMA table_info(app_settings)')}
        if 'result_display_mode' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN result_display_mode TEXT NOT NULL DEFAULT 'accuracy'")
        if 'signup_enabled' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN signup_enabled TEXT NOT NULL DEFAULT 'yes'")
        if 'step_hold_general' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN step_hold_general TEXT NOT NULL DEFAULT 'no'")
        if 'pass_threshold' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN pass_threshold INTEGER NOT NULL DEFAULT 80")
        if 'correct_cents' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN correct_cents INTEGER NOT NULL DEFAULT 15")
        if 'close_cents' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN close_cents INTEGER NOT NULL DEFAULT 35")
        if 'verify_mode_direction' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN verify_mode_direction TEXT NOT NULL DEFAULT 'up'")
        if 'verify_mode_bpm' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN verify_mode_bpm INTEGER NOT NULL DEFAULT 60")
        if 'verify_mode_step_hold' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN verify_mode_step_hold TEXT NOT NULL DEFAULT 'instant'")
        if 'verify_mode_save_history' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN verify_mode_save_history TEXT NOT NULL DEFAULT 'yes'")
        if 'note_display_mode' in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings DROP COLUMN note_display_mode")
        conn.execute('''
            INSERT OR IGNORE INTO app_settings (id, result_display_mode) VALUES (1, 'accuracy')
        ''')

        # 旧スキーマ（mode/bpm/profile_id等の列がない）のDBを移行
        existing_cols = {row[1] for row in conn.execute('PRAGMA table_info(history)')}
        migrations = {
            'mode':          "ALTER TABLE history ADD COLUMN mode TEXT NOT NULL DEFAULT 'step'",
            'bpm':           "ALTER TABLE history ADD COLUMN bpm INTEGER",
            'notes_correct': "ALTER TABLE history ADD COLUMN notes_correct INTEGER NOT NULL DEFAULT 0",
            'notes_total':   "ALTER TABLE history ADD COLUMN notes_total INTEGER NOT NULL DEFAULT 0",
            'accuracy':      "ALTER TABLE history ADD COLUMN accuracy REAL NOT NULL DEFAULT 0.0",
            'profile_id':    "ALTER TABLE history ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1",
            'phase':         "ALTER TABLE history ADD COLUMN phase TEXT NOT NULL DEFAULT 'practice'",
        }
        for col, ddl in migrations.items():
            if col not in existing_cols:
                conn.execute(ddl)

        # 旧スキーマ（password_hash/roleがない）のprofilesを移行。
        # role列がまだ無かった＝ログイン機能導入前のDBという印なので、
        # 移行直後に一番古いプロフィールを管理者に昇格させる
        # （導入前からの利用者が、機能追加後も自分のデータに管理者権限でアクセスできるようにするため）
        existing_profile_cols = {row[1] for row in conn.execute('PRAGMA table_info(profiles)')}
        upgrading_from_no_auth = 'role' not in existing_profile_cols
        profile_migrations = {
            'password_hash': "ALTER TABLE profiles ADD COLUMN password_hash TEXT",
            'role':          "ALTER TABLE profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
            'is_subject':    "ALTER TABLE profiles ADD COLUMN is_subject TEXT NOT NULL DEFAULT 'no'",
            'subject_step_index': "ALTER TABLE profiles ADD COLUMN subject_step_index INTEGER NOT NULL DEFAULT 0",
            'has_seen_tutorial':  "ALTER TABLE profiles ADD COLUMN has_seen_tutorial TEXT NOT NULL DEFAULT 'no'",
            'subject_stage_phase': "ALTER TABLE profiles ADD COLUMN subject_stage_phase TEXT NOT NULL DEFAULT 'baseline'",
        }
        for col, ddl in profile_migrations.items():
            if col not in existing_profile_cols:
                conn.execute(ddl)

        if upgrading_from_no_auth:
            first_id = conn.execute('SELECT MIN(id) FROM profiles').fetchone()[0]
            if first_id is not None:
                conn.execute('UPDATE profiles SET role = ? WHERE id = ?', ('admin', first_id))

        # プロフィールが1件もなければ、デフォルトプロフィール（管理者）を作成
        if conn.execute('SELECT COUNT(*) FROM profiles').fetchone()[0] == 0:
            conn.execute(
                'INSERT INTO profiles (name, created_at, role) VALUES (?, ?, ?)',
                (DEFAULT_PROFILE_NAME, datetime.now().strftime('%Y/%m/%d %H:%M'), 'admin')
            )

        # 音階（調）。以前は static/data/scales/*.json に直書きしていたが、
        # 管理者がWeb画面（五線譜クリック入力）から追加できるようDBに移した
        conn.execute('''
            CREATE TABLE IF NOT EXISTS scales (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                category_key  TEXT NOT NULL,
                name          TEXT NOT NULL,
                notes_json    TEXT NOT NULL,
                arpeggio_json TEXT,
                key_sig_json  TEXT,
                created_at    TEXT NOT NULL
            )
        ''')
        # 既存DBへのカラム追加マイグレーション
        try:
            conn.execute('ALTER TABLE scales ADD COLUMN key_sig_json TEXT')
        except Exception:
            pass

        # 初回起動時だけ、旧スキーマ（静的JSONファイル）の内容をDBに取り込む
        if conn.execute('SELECT COUNT(*) FROM scales').fetchone()[0] == 0:
            scales_dir = os.path.join(os.path.dirname(__file__), 'static', 'data', 'scales')
            seeded_at  = datetime.now().strftime('%Y/%m/%d %H:%M')
            for category_key in CATEGORY_LABELS:
                path = os.path.join(scales_dir, f'{category_key}.json')
                if not os.path.exists(path):
                    continue
                with open(path, encoding='utf-8') as f:
                    data = json.load(f)
                for scale in data.get('scales', {}).values():
                    conn.execute(
                        'INSERT INTO scales (category_key, name, notes_json, arpeggio_json, created_at) '
                        'VALUES (?, ?, ?, ?, ?)',
                        (
                            category_key,
                            scale['name'],
                            json.dumps(scale['notes'], ensure_ascii=False),
                            json.dumps(scale['arpeggio'], ensure_ascii=False) if scale.get('arpeggio') else None,
                            seeded_at,
                        )
                    )

        # 被験者アカウントに割り当てる、決まった練習の「ロードマップ」（音階6つを順番に練習する）。
        # 各ステップ（step_order = 0〜5）は、音階・方向・テンポを持つ。被験者はこの内容を
        # 自分で選ばず、各ステップでテンポ練習→（不合格なら）1音ずつ練習→再テンポ練習…を
        # 合格するまで繰り返し、合格したら次のステップ（次の音階）に進む
        conn.execute('''
            CREATE TABLE IF NOT EXISTS subject_assignment_steps (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id    INTEGER NOT NULL,
                step_order    INTEGER NOT NULL,
                category_key  TEXT    NOT NULL,
                scale_id      INTEGER NOT NULL,
                direction     TEXT    NOT NULL,
                bpm           INTEGER NOT NULL,
                with_practice TEXT    NOT NULL DEFAULT 'yes',
                session_end   TEXT    NOT NULL DEFAULT 'no',
                updated_at    TEXT    NOT NULL
            )
        ''')
        existing_step_cols = {row[1] for row in conn.execute('PRAGMA table_info(subject_assignment_steps)')}
        if 'with_practice' not in existing_step_cols:
            conn.execute("ALTER TABLE subject_assignment_steps ADD COLUMN with_practice TEXT NOT NULL DEFAULT 'yes'")
        if 'session_end' not in existing_step_cols:
            conn.execute("ALTER TABLE subject_assignment_steps ADD COLUMN session_end TEXT NOT NULL DEFAULT 'no'")

        # 検証モード（管理者が自分のアカウントで被験者フローを体験する機能）で使う、
        # 音階SUBJECT_ROADMAP_LENGTH個のロードマップ。管理者全体で共通の1つだけを持つ
        # （被験者ごとではない）。未設定（0行）の場合は、登録済みの音階から自動で仮に選ぶ
        conn.execute('''
            CREATE TABLE IF NOT EXISTS verify_mode_scale_steps (
                step_order    INTEGER PRIMARY KEY,
                category_key  TEXT    NOT NULL,
                scale_id      INTEGER NOT NULL,
                with_practice TEXT    NOT NULL DEFAULT 'yes',
                session_end   TEXT    NOT NULL DEFAULT 'no'
            )
        ''')
        existing_verify_step_cols = {row[1] for row in conn.execute('PRAGMA table_info(verify_mode_scale_steps)')}
        if 'with_practice' not in existing_verify_step_cols:
            conn.execute("ALTER TABLE verify_mode_scale_steps ADD COLUMN with_practice TEXT NOT NULL DEFAULT 'yes'")
        if 'session_end' not in existing_verify_step_cols:
            conn.execute("ALTER TABLE verify_mode_scale_steps ADD COLUMN session_end TEXT NOT NULL DEFAULT 'no'")

        conn.commit()

# ===== 認証まわりのヘルパー =====
def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'profile_id' not in session:
            return jsonify({'error': 'ログインが必要です'}), 401
        return f(*args, **kwargs)
    return wrapper

# 自分のデータか、管理者・研究者・閲覧者かどうかを判定する
def can_access_profile(profile_id):
    return session.get('role') in ('admin', 'researcher', 'viewer') or session.get('profile_id') == profile_id

# ===== ページ =====
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/viewer')
def viewer_page():
    if 'profile_id' not in session:
        return redirect(url_for('home'))
    if session.get('role') not in ('viewer', 'admin', 'researcher'):
        return redirect(url_for('home'))
    return render_template('viewer.html')

# ===== ログイン =====
@app.route('/api/login', methods=['POST'])
def login():
    data     = request.get_json() or {}
    name     = (data.get('name') or '').strip()
    password = data.get('password') or ''
    if not name or not password:
        return jsonify({'error': '名前とパスワードを入力してください'}), 400

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        profile = conn.execute('SELECT * FROM profiles WHERE name = ?', (name,)).fetchone()

    if profile is None:
        return jsonify({'error': 'その名前のアカウントは見つかりません'}), 401

    # ログイン機能導入前から存在するアカウントはまだパスワードが無いので、
    # 初回パスワード設定へ誘導する
    if profile['password_hash'] is None:
        return jsonify({'needs_setup': True, 'name': profile['name']}), 200

    if not check_password_hash(profile['password_hash'], password):
        return jsonify({'error': 'パスワードが違います'}), 401

    session.clear()
    session.permanent = True
    session['profile_id'] = profile['id']
    session['role']       = profile['role']
    return jsonify({
        'id': profile['id'], 'name': profile['name'], 'role': profile['role'],
        'is_subject': profile['is_subject'], 'has_seen_tutorial': profile['has_seen_tutorial']
    }), 200

# ===== 初回パスワード設定（password_hashがまだ無いアカウント専用） =====
@app.route('/api/set-password', methods=['POST'])
def set_password():
    data     = request.get_json() or {}
    name     = (data.get('name') or '').strip()
    password = data.get('password') or ''
    if not name or len(password) < 4:
        return jsonify({'error': 'パスワードは4文字以上で入力してください'}), 400

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        profile = conn.execute('SELECT * FROM profiles WHERE name = ?', (name,)).fetchone()
        if profile is None:
            return jsonify({'error': 'その名前のアカウントは見つかりません'}), 404
        if profile['password_hash'] is not None:
            return jsonify({'error': 'すでにパスワードが設定されています。ログインしてください'}), 409

        conn.execute('UPDATE profiles SET password_hash = ? WHERE id = ?',
                     (generate_password_hash(password), profile['id']))
        conn.commit()

    session.clear()
    session.permanent = True
    session['profile_id'] = profile['id']
    session['role']       = profile['role']
    return jsonify({
        'id': profile['id'], 'name': profile['name'], 'role': profile['role'],
        'is_subject': profile['is_subject'], 'has_seen_tutorial': profile['has_seen_tutorial']
    }), 200

# ===== ログアウト =====
@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'logged out'}), 200

# ===== 現在ログイン中のアカウント情報 =====
@app.route('/api/me', methods=['GET'])
def me():
    if 'profile_id' not in session:
        return jsonify({'error': 'not logged in'}), 401
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        profile = conn.execute(
            'SELECT id, name, role, is_subject, has_seen_tutorial FROM profiles WHERE id = ?', (session['profile_id'],)
        ).fetchone()
    if profile is None:
        session.clear()
        return jsonify({'error': 'not logged in'}), 401
    return jsonify(dict(profile)), 200

# ===== アプリ全体の設定を取得（結果画面の表示形式、新規アカウント作成の可否など） =====
# ログインしていないゲスト・ログイン画面にも反映する必要があるため、誰でも読める
@app.route('/api/settings', methods=['GET'])
def get_settings():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            'SELECT result_display_mode, signup_enabled, step_hold_general, pass_threshold, '
            'correct_cents, close_cents, verify_mode_direction, verify_mode_bpm, '
            'verify_mode_step_hold, verify_mode_save_history FROM app_settings WHERE id = 1'
        ).fetchone()
    if row is None:
        return jsonify({
            'result_display_mode': 'accuracy', 'signup_enabled': 'yes',
            'step_hold_general': 'no', 'pass_threshold': 80,
            'correct_cents': 15, 'close_cents': 35,
            'verify_mode_direction': 'up', 'verify_mode_bpm': 60,
            'verify_mode_step_hold': 'instant', 'verify_mode_save_history': 'yes'
        })
    return jsonify(dict(row))

# ===== アプリ全体の設定を変更（管理者のみ）。渡された項目だけ更新する =====
@app.route('/api/settings', methods=['POST'])
@login_required
def update_settings():
    if session.get('role') != 'admin':
        return jsonify({'error': '権限がありません'}), 403

    data = request.get_json() or {}
    updates = {}

    if 'result_display_mode' in data:
        if data['result_display_mode'] not in ('accuracy', 'score', 'both'):
            return jsonify({'error': 'result_display_modeはaccuracy・score・bothのいずれかで指定してください'}), 400
        updates['result_display_mode'] = data['result_display_mode']

    if 'signup_enabled' in data:
        if data['signup_enabled'] not in ('yes', 'no'):
            return jsonify({'error': 'signup_enabledはyesかnoで指定してください'}), 400
        updates['signup_enabled'] = data['signup_enabled']

    if 'step_hold_general' in data:
        if data['step_hold_general'] not in ('yes', 'no'):
            return jsonify({'error': 'step_hold_generalはyesかnoで指定してください'}), 400
        updates['step_hold_general'] = data['step_hold_general']

    if 'pass_threshold' in data:
        try:
            threshold = int(data['pass_threshold'])
        except (TypeError, ValueError):
            return jsonify({'error': 'pass_thresholdは1〜100の整数で指定してください'}), 400
        if not (1 <= threshold <= 100):
            return jsonify({'error': 'pass_thresholdは1〜100の整数で指定してください'}), 400
        updates['pass_threshold'] = threshold

    # 「正解」「惜しい」の許容誤差（セント）。1音ずつ・テンポ・点数計算のすべてでこの2つの値を使う
    if 'correct_cents' in data:
        try:
            correct_cents = int(data['correct_cents'])
        except (TypeError, ValueError):
            return jsonify({'error': 'correct_centsは1〜100の整数で指定してください'}), 400
        if not (1 <= correct_cents <= 100):
            return jsonify({'error': 'correct_centsは1〜100の整数で指定してください'}), 400
        updates['correct_cents'] = correct_cents

    if 'close_cents' in data:
        try:
            close_cents = int(data['close_cents'])
        except (TypeError, ValueError):
            return jsonify({'error': 'close_centsは1〜100の整数で指定してください'}), 400
        if not (1 <= close_cents <= 100):
            return jsonify({'error': 'close_centsは1〜100の整数で指定してください'}), 400
        updates['close_cents'] = close_cents

    # 検証モード（管理者が自分のアカウントで被験者フローを体験するときの練習タイプ・テンポ）
    if 'verify_mode_direction' in data:
        if data['verify_mode_direction'] not in VALID_DIRECTIONS:
            return jsonify({'error': '不正な練習タイプです'}), 400
        updates['verify_mode_direction'] = data['verify_mode_direction']

    if 'verify_mode_bpm' in data:
        try:
            verify_bpm = int(data['verify_mode_bpm'])
        except (TypeError, ValueError):
            return jsonify({'error': 'verify_mode_bpmは40〜120の整数で指定してください'}), 400
        if not (40 <= verify_bpm <= 120):
            return jsonify({'error': 'verify_mode_bpmは40〜120の整数で指定してください'}), 400
        updates['verify_mode_bpm'] = verify_bpm

    if 'verify_mode_step_hold' in data:
        if data['verify_mode_step_hold'] not in ('instant', 'hold'):
            return jsonify({'error': 'verify_mode_step_holdはinstantかholdで指定してください'}), 400
        updates['verify_mode_step_hold'] = data['verify_mode_step_hold']

    if 'verify_mode_save_history' in data:
        if data['verify_mode_save_history'] not in ('yes', 'no'):
            return jsonify({'error': 'verify_mode_save_historyはyesかnoで指定してください'}), 400
        updates['verify_mode_save_history'] = data['verify_mode_save_history']

    if not updates:
        return jsonify({'error': '更新する項目がありません'}), 400

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        # 「惜しい」は「正解」より狭くならないようにする（両方同時指定・片方のみ指定のどちらでも、
        # 既存値と組み合わせた実際の値同士で比較する）
        if 'correct_cents' in updates or 'close_cents' in updates:
            current = conn.execute('SELECT correct_cents, close_cents FROM app_settings WHERE id = 1').fetchone()
            effective_correct = updates.get('correct_cents', current['correct_cents'] if current else 15)
            effective_close   = updates.get('close_cents', current['close_cents'] if current else 35)
            if effective_close < effective_correct:
                return jsonify({'error': '「惜しい」の許容誤差は「正解」の許容誤差以上にしてください'}), 400

        set_clause = ', '.join(f'{col} = ?' for col in updates)  # updatesのキーは上のホワイトリストのみ
        conn.execute(f'UPDATE app_settings SET {set_clause} WHERE id = 1', tuple(updates.values()))
        conn.commit()
        row = conn.execute(
            'SELECT result_display_mode, signup_enabled, step_hold_general, pass_threshold, '
            'correct_cents, close_cents, verify_mode_direction, verify_mode_bpm, '
            'verify_mode_step_hold, verify_mode_save_history FROM app_settings WHERE id = 1'
        ).fetchone()

    return jsonify(dict(row)), 200

# ===== パスワード変更（本人のみ） =====
@app.route('/api/change-password', methods=['POST'])
@login_required
def change_password():
    data    = request.get_json() or {}
    current = data.get('current_password') or ''
    new     = data.get('new_password') or ''
    if len(new) < 4:
        return jsonify({'error': '新しいパスワードは4文字以上で入力してください'}), 400

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        profile = conn.execute('SELECT * FROM profiles WHERE id = ?', (session['profile_id'],)).fetchone()
        if not check_password_hash(profile['password_hash'], current):
            return jsonify({'error': '現在のパスワードが違います'}), 401
        conn.execute('UPDATE profiles SET password_hash = ? WHERE id = ?',
                     (generate_password_hash(new), profile['id']))
        conn.commit()

    return jsonify({'message': 'updated'}), 200

# ===== プロフィール（アカウント）一覧 =====
# 管理者は全員分、一般ユーザーは自分の分だけを返す
@app.route('/api/profiles', methods=['GET'])
@login_required
def get_profiles():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        if session.get('role') == 'admin':
            rows = conn.execute(
                '''SELECT p.id, p.name, p.role, p.is_subject, p.created_at,
                          (SELECT s.with_practice FROM subject_assignment_steps s
                           WHERE s.profile_id = p.id ORDER BY s.step_order LIMIT 1) AS with_practice
                   FROM profiles p ORDER BY p.id'''
            ).fetchall()
        else:
            rows = conn.execute(
                '''SELECT p.id, p.name, p.role, p.is_subject, p.created_at,
                          (SELECT s.with_practice FROM subject_assignment_steps s
                           WHERE s.profile_id = p.id ORDER BY s.step_order LIMIT 1) AS with_practice
                   FROM profiles p WHERE p.id = ?''', (session['profile_id'],)
            ).fetchall()
    return jsonify([dict(row) for row in rows])

# ===== アカウント新規作成 =====
# 新規登録フォームからは、管理者が「新規アカウント作成」を許可している場合のみ作成可。
# 作成すると同時にログイン状態になる。
# ただし、既に管理者としてログイン中のリクエストは「被験者アカウントの代理作成」とみなし、
# signup_enabledの設定に関係なく常に作成を許可し、管理者自身のログイン状態は変えない
# （作成した被験者アカウントには自動ログインしない）
@app.route('/api/profiles', methods=['POST'])
def create_profile():
    is_admin_request = session.get('role') == 'admin'

    data     = request.get_json() or {}
    name     = (data.get('name') or '').strip()
    password = data.get('password') or ''
    if not name:
        return jsonify({'error': '名前を入力してください'}), 400
    if len(password) < 4:
        return jsonify({'error': 'パスワードは4文字以上で入力してください'}), 400

    if not is_admin_request:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute('SELECT signup_enabled FROM app_settings WHERE id = 1').fetchone()
        if row is not None and row[0] == 'no':
            return jsonify({'error': '新規アカウント作成は現在許可されていません'}), 403

    # 管理者が代理作成する場合は「被験者アカウント」として登録し、決まった練習の
    # 管理者が代理作成する場合のロールと被験者フラグを決める
    # account_type: 'subject'（被験者）/ 'researcher'（研究者）/ 未指定（通常ユーザー）
    account_type = data.get('account_type', 'subject') if is_admin_request else None
    new_role      = 'researcher' if account_type == 'researcher' else 'user'
    new_is_subject = 'yes' if (is_admin_request and account_type != 'researcher') else 'no'

    # 被験者アカウントの場合のみロードマップを組み立てる
    roadmap_steps = None
    if is_admin_request and account_type != 'researcher':
        direction = data.get('direction')
        if direction not in VALID_DIRECTIONS:
            return jsonify({'error': '不正な練習タイプです'}), 400
        try:
            bpm = int(data.get('bpm'))
        except (TypeError, ValueError):
            return jsonify({'error': 'テンポを指定してください'}), 400
        if not (40 <= bpm <= 120):
            return jsonify({'error': 'テンポは40〜120の範囲で指定してください'}), 400

        # アプリ練習あり/なしを受け取る（グループ割り当て）
        with_practice = data.get('with_practice', 'no')
        if with_practice not in ('yes', 'no'):
            return jsonify({'error': 'with_practiceはyesかnoで指定してください'}), 400

        # 4音階（ペア1×2音階 + ペア2×2音階）を受け取る。未指定ならDBから自動選択
        scales_in = data.get('scales')
        if scales_in and isinstance(scales_in, list) and len(scales_in) == 4:
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                validated_scales = []
                for s in scales_in:
                    cat = s.get('category_key') if isinstance(s, dict) else None
                    if cat not in CATEGORY_LABELS:
                        return jsonify({'error': '不正なカテゴリーです'}), 400
                    try:
                        sid = int(s.get('scale_id'))
                    except (TypeError, ValueError):
                        return jsonify({'error': '音階を指定してください'}), 400
                    row = conn.execute(
                        'SELECT id FROM scales WHERE id = ? AND category_key = ?', (sid, cat)
                    ).fetchone()
                    if row is None:
                        return jsonify({'error': '指定された音階が見つかりません'}), 400
                    validated_scales.append({'category_key': cat, 'scale_id': sid})
        else:
            with sqlite3.connect(DB_PATH) as conn:
                conn.row_factory = sqlite3.Row
                scale_rows = conn.execute('SELECT id, category_key FROM scales ORDER BY id').fetchall()
            if not scale_rows:
                return jsonify({'error': '音階が1つも登録されていません。先に「設定」から音階を追加してください'}), 400
            validated_scales = [
                {'category_key': scale_rows[i % len(scale_rows)]['category_key'],
                 'scale_id':     scale_rows[i % len(scale_rows)]['id']}
                for i in range(4)
            ]

        # 16ステップのロードマップを生成（ペア1×4日 + ペア2×4日、with_practiceはグループ共通）
        roadmap_steps = []
        for pair_idx in range(2):
            s1 = validated_scales[pair_idx * 2]
            s2 = validated_scales[pair_idx * 2 + 1]
            for day in range(4):
                is_last = (pair_idx == 1 and day == 3)
                roadmap_steps.append((len(roadmap_steps), s1['category_key'], s1['scale_id'], direction, bpm, with_practice, 'no'))
                se = 'no' if is_last else 'yes'
                roadmap_steps.append((len(roadmap_steps), s2['category_key'], s2['scale_id'], direction, bpm, with_practice, se))

    created_at = datetime.now().strftime('%Y/%m/%d %H:%M')
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cur = conn.execute(
                'INSERT INTO profiles (name, created_at, password_hash, role, is_subject) VALUES (?, ?, ?, ?, ?)',
                (name, created_at, generate_password_hash(password), new_role, new_is_subject)
            )
            profile_id = cur.lastrowid
            if roadmap_steps:
                conn.executemany(
                    'INSERT INTO subject_assignment_steps '
                    '(profile_id, step_order, category_key, scale_id, direction, bpm, with_practice, session_end, updated_at) '
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [(profile_id,) + step + (created_at,) for step in roadmap_steps]
                )
            conn.commit()
    except sqlite3.IntegrityError:
        return jsonify({'error': 'その名前は既に使われています'}), 409

    if not is_admin_request:
        session.clear()
        session.permanent = True
        session['profile_id'] = profile_id
        session['role']       = 'user'
    return jsonify({
        'id': profile_id, 'name': name, 'role': new_role, 'created_at': created_at,
        'is_subject': new_is_subject, 'has_seen_tutorial': 'no'
    }), 201

# ===== アカウント削除（本人か管理者のみ） =====
@app.route('/api/profiles/<int:profile_id>', methods=['DELETE'])
@login_required
def delete_profile(profile_id):
    if not can_access_profile(profile_id):
        return jsonify({'error': '権限がありません'}), 403

    # 被験者アカウントは自分では削除できない（研究データを誤って・意図的に消されないように）。
    # 削除が必要な場合は管理者が行う
    is_self_delete = session.get('profile_id') == profile_id
    if is_self_delete and session.get('role') != 'admin':
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute('SELECT is_subject FROM profiles WHERE id = ?', (profile_id,)).fetchone()
        if row and row[0] == 'yes':
            return jsonify({'error': '被験者アカウントは自分では削除できません。管理者に削除を依頼してください'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        count = conn.execute('SELECT COUNT(*) FROM profiles').fetchone()[0]
        if count <= 1:
            return jsonify({'error': '最後のプロフィールは削除できません'}), 400

        conn.execute('''
            DELETE FROM note_results WHERE history_id IN
              (SELECT id FROM history WHERE profile_id = ?)
        ''', (profile_id,))
        conn.execute('DELETE FROM history WHERE profile_id = ?', (profile_id,))
        conn.execute('DELETE FROM profiles WHERE id = ?', (profile_id,))
        conn.commit()

    if session.get('profile_id') == profile_id:
        session.clear()

    return jsonify({'message': 'deleted'}), 200

# ===== 履歴を取得 =====
@app.route('/api/history', methods=['GET'])
@login_required
def get_history():
    profile_id = request.args.get('profile_id', type=int, default=session['profile_id'])
    if not can_access_profile(profile_id):
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT h.*, (COUNT(nr.id) > 0) AS has_note_results
            FROM history h
            LEFT JOIN note_results nr ON nr.history_id = h.id
            WHERE h.profile_id = ?
            GROUP BY h.id
            ORDER BY h.id DESC LIMIT 100
        ''', (profile_id,)).fetchall()
    return jsonify([dict(row) for row in rows])

# ===== 履歴を保存 =====
@app.route('/api/history', methods=['POST'])
@login_required
def save_history():
    data          = request.get_json()
    profile_id    = session['profile_id']  # 他人になりすまして記録できないよう、常に自分のアカウントに保存する
    scale         = data.get('scale')
    direction     = data.get('direction')
    mode          = data.get('mode', 'step')
    bpm           = data.get('bpm')
    notes_correct = data.get('notes_correct', 0)
    notes_total   = data.get('notes_total', 0)
    note_results  = data.get('note_results') or []
    accuracy      = round(notes_correct / notes_total * 100, 1) if notes_total > 0 else 0.0
    practiced_at  = datetime.now().strftime('%Y/%m/%d %H:%M')

    # 被験者の事前演奏・テスト演奏を、通常の練習と区別して記録するためのタグ。
    # 事前演奏(baseline)・テスト演奏(test)以外（自由練習や一般の練習）はすべてpracticeとして扱う
    phase = data.get('phase')
    if phase not in ('baseline', 'test'):
        phase = 'practice'

    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute('''
            INSERT INTO history
              (profile_id, scale, direction, mode, bpm, notes_correct, notes_total, accuracy, practiced_at, phase)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (profile_id, scale, direction, mode, bpm, notes_correct, notes_total, accuracy, practiced_at, phase))
        history_id = cur.lastrowid

        if note_results:
            conn.executemany('''
                INSERT INTO note_results (history_id, note, string, outcome, cents)
                VALUES (?, ?, ?, ?, ?)
            ''', [
                (history_id, r.get('note'), r.get('string'), r.get('outcome'), r.get('cents'))
                for r in note_results
            ])

        conn.commit()

    return jsonify({
        'scale': scale, 'direction': direction, 'mode': mode,
        'bpm': bpm, 'accuracy': accuracy,
        'notes_correct': notes_correct, 'notes_total': notes_total,
        'time': practiced_at, 'phase': phase
    }), 201

# ===== 履歴を全件削除（プロフィール単位。本人か管理者のみ） =====
@app.route('/api/history', methods=['DELETE'])
@login_required
def clear_history():
    profile_id = request.args.get('profile_id', type=int, default=session['profile_id'])
    if not can_access_profile(profile_id):
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            DELETE FROM note_results WHERE history_id IN
              (SELECT id FROM history WHERE profile_id = ?)
        ''', (profile_id,))
        conn.execute('DELETE FROM history WHERE profile_id = ?', (profile_id,))
        conn.commit()
    return jsonify({'message': 'deleted'}), 200

# ===== 全アカウントの履歴一覧（管理者・研究者のみ） =====
@app.route('/api/all-history', methods=['GET'])
@login_required
def get_all_history():
    if session.get('role') not in ('admin', 'researcher'):
        return jsonify({'error': '権限がありません'}), 403

    limit  = request.args.get('limit',  type=int, default=500)
    offset = request.args.get('offset', type=int, default=0)
    profile_filter = request.args.get('profile_id', type=int)

    query  = 'SELECT h.*, p.name AS profile_name FROM history h JOIN profiles p ON h.profile_id = p.id'
    params = []
    if profile_filter:
        query  += ' WHERE h.profile_id = ?'
        params.append(profile_filter)
    query += ' ORDER BY h.id DESC LIMIT ? OFFSET ?'
    params += [limit, offset]

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(query, params).fetchall()
    return jsonify([dict(r) for r in rows])

# ===== 履歴1件を新規作成（管理者・研究者のみ、任意のプロフィールに作成可） =====
@app.route('/api/all-history', methods=['POST'])
@login_required
def create_history_for_profile():
    if session.get('role') not in ('admin', 'researcher'):
        return jsonify({'error': '権限がありません'}), 403
    data = request.get_json() or {}
    profile_id = data.get('profile_id')
    if not profile_id:
        return jsonify({'error': 'profile_id は必須です'}), 400
    with sqlite3.connect(DB_PATH) as conn:
        profile = conn.execute('SELECT id, name FROM profiles WHERE id = ?', (profile_id,)).fetchone()
    if not profile:
        return jsonify({'error': '指定したアカウントが見つかりません'}), 404
    scale         = data.get('scale', '')
    direction     = data.get('direction', 'up')
    mode          = data.get('mode', 'tempo')
    bpm_raw       = data.get('bpm')
    bpm           = int(bpm_raw) if bpm_raw else None
    notes_correct = int(data.get('notes_correct', 0))
    notes_total   = int(data.get('notes_total', 0))
    accuracy      = round(notes_correct / notes_total * 100, 1) if notes_total > 0 else 0.0
    phase         = data.get('phase', 'practice')
    if phase not in ('baseline', 'test', 'practice'):
        phase = 'practice'
    practiced_at  = data.get('practiced_at') or datetime.now().strftime('%Y/%m/%d %H:%M')
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute('''
            INSERT INTO history
              (profile_id, scale, direction, mode, bpm, notes_correct, notes_total, accuracy, practiced_at, phase)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (profile_id, scale, direction, mode, bpm, notes_correct, notes_total, accuracy, practiced_at, phase))
        conn.commit()
    return jsonify({'id': cur.lastrowid, 'profile_name': profile[1], 'message': 'created'}), 201

# ===== 指定日のbaseline記録から不正確な音符を取得 =====
@app.route('/api/history/baseline-wrong-notes', methods=['GET'])
@login_required
def get_baseline_wrong_notes():
    profile_id = request.args.get('profile_id', type=int)
    date_str   = request.args.get('date', '')  # YYYY-MM-DD
    if not profile_id or not date_str:
        return jsonify({'error': 'パラメータが不足しています'}), 400
    if not can_access_profile(profile_id):
        return jsonify({'error': '権限がありません'}), 403

    # DB上の日付フォーマット: "YYYY/MM/DD HH:MM"
    db_date_prefix = date_str.replace('-', '/') + '%'

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute('''
            SELECT id FROM history
            WHERE profile_id = ? AND phase = 'baseline' AND practiced_at LIKE ?
            ORDER BY id DESC LIMIT 1
        ''', (profile_id, db_date_prefix)).fetchone()

        if row is None:
            return jsonify({'error': 'この日の事前計測記録が見つかりません'}), 404

        notes = conn.execute('''
            SELECT note, string, outcome, cents FROM note_results
            WHERE history_id = ? AND outcome != 'correct'
            ORDER BY id
        ''', (row['id'],)).fetchall()

    if not notes:
        return jsonify({'error': '事前計測に不正確な音符がありません（全問正解）'}), 404

    return jsonify({'notes': [dict(n) for n in notes]})

# ===== 履歴1件の音符結果を取得 =====
@app.route('/api/history/<int:history_id>/notes', methods=['GET'])
@login_required
def get_history_notes(history_id):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute('SELECT profile_id FROM history WHERE id = ?', (history_id,)).fetchone()
        if not row or not can_access_profile(row['profile_id']):
            return jsonify({'error': '権限がありません'}), 403
        notes = conn.execute(
            'SELECT note, string, outcome, cents FROM note_results WHERE history_id = ? ORDER BY id',
            (history_id,)
        ).fetchall()
    return jsonify([dict(n) for n in notes])

# ===== 履歴1件を編集（管理者・研究者のみ） =====
@app.route('/api/history/<int:history_id>', methods=['PATCH'])
@login_required
def update_history_record(history_id):
    if session.get('role') not in ('admin', 'researcher'):
        return jsonify({'error': '権限がありません'}), 403

    data = request.get_json() or {}
    allowed = {'scale', 'direction', 'mode', 'bpm', 'notes_correct', 'notes_total', 'practiced_at', 'phase'}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return jsonify({'error': '更新するフィールドがありません'}), 400

    if 'notes_correct' in updates or 'notes_total' in updates:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute('SELECT notes_correct, notes_total FROM history WHERE id = ?', (history_id,)).fetchone()
        if row is None:
            return jsonify({'error': '記録が見つかりません'}), 404
        nc = int(updates.get('notes_correct', row[0]))
        nt = int(updates.get('notes_total',   row[1]))
        updates['notes_correct'] = nc
        updates['notes_total']   = nt
        updates['accuracy']      = round(nc / nt * 100, 1) if nt > 0 else 0.0

    set_clause = ', '.join(f'{k} = ?' for k in updates)
    values     = list(updates.values()) + [history_id]

    with sqlite3.connect(DB_PATH) as conn:
        affected = conn.execute(f'UPDATE history SET {set_clause} WHERE id = ?', values).rowcount
        conn.commit()
    if affected == 0:
        return jsonify({'error': '記録が見つかりません'}), 404
    return jsonify({'message': 'updated'})

# ===== 履歴1件を削除（管理者・研究者のみ） =====
@app.route('/api/history/<int:history_id>', methods=['DELETE'])
@login_required
def delete_history_record(history_id):
    if session.get('role') not in ('admin', 'researcher'):
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        affected = conn.execute('DELETE FROM history WHERE id = ?', (history_id,)).rowcount
        if affected:
            conn.execute('DELETE FROM note_results WHERE history_id = ?', (history_id,))
        conn.commit()
    if affected == 0:
        return jsonify({'error': '記録が見つかりません'}), 404
    return jsonify({'message': 'deleted'})

# ===== グラフ用統計データ =====
@app.route('/api/stats', methods=['GET'])
@login_required
def get_stats():
    profile_id = request.args.get('profile_id', type=int, default=session['profile_id'])
    if not can_access_profile(profile_id):
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        # 日別の練習回数と平均正答率（直近30日）
        # 練習回数は全モード合算、正答率は「1音ずつモード」を除く
        # （1音ずつは正解するまでやり直せる仕様上、正答率が常に100%になり参考にならないため）
        daily = conn.execute('''
            SELECT
                substr(practiced_at, 1, 10) as date,
                COUNT(*) as count,
                ROUND(AVG(CASE WHEN mode = 'tempo' THEN accuracy END), 1) as avg_accuracy
            FROM history
            WHERE profile_id = ?
            GROUP BY date
            ORDER BY date DESC
            LIMIT 30
        ''', (profile_id,)).fetchall()

        # 調ごとの平均正答率（テンポモードのみ集計。理由は上記と同じ）
        by_scale = conn.execute('''
            SELECT
                scale,
                COUNT(*) as count,
                ROUND(AVG(accuracy), 1) as avg_accuracy
            FROM history
            WHERE profile_id = ? AND mode = 'tempo'
            GROUP BY scale
            ORDER BY avg_accuracy DESC
        ''', (profile_id,)).fetchall()

        # 練習カレンダー用：練習した日付（モード問わず）。dailyの30件制限とは別に、
        # カレンダーで月をまたいでも表示できるよう、直近400日分の日付を返す
        practiced_dates = conn.execute('''
            SELECT DISTINCT substr(practiced_at, 1, 10) as date
            FROM history
            WHERE profile_id = ?
            ORDER BY date DESC
            LIMIT 400
        ''', (profile_id,)).fetchall()

    return jsonify({
        'daily': [dict(r) for r in daily],
        'by_scale': [dict(r) for r in by_scale],
        'practiced_dates': [r['date'] for r in practiced_dates]
    })

# ===== 音ごとの苦手分析 =====
@app.route('/api/stats/notes', methods=['GET'])
@login_required
def get_note_stats():
    profile_id = request.args.get('profile_id', type=int, default=session['profile_id'])
    if not can_access_profile(profile_id):
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        # 音名ごとの正解率（「1音ずつ」のやり直しと「テンポ」の不正解を、
        # どちらも"つまずき"として合算する。最低2回は弾いていないと参考にならないため除外）
        by_note = conn.execute('''
            SELECT
                nr.note,
                COUNT(*) as attempts,
                SUM(CASE WHEN nr.outcome != 'correct' THEN 1 ELSE 0 END) as misses,
                ROUND(100.0 * SUM(CASE WHEN nr.outcome = 'correct' THEN 1 ELSE 0 END) / COUNT(*), 1) as accuracy
            FROM note_results nr
            JOIN history h ON h.id = nr.history_id
            WHERE h.profile_id = ?
            GROUP BY nr.note
            HAVING attempts >= 2
            ORDER BY accuracy ASC, attempts DESC
            LIMIT 15
        ''', (profile_id,)).fetchall()

        # 弦ごとの正解率
        by_string = conn.execute('''
            SELECT
                nr.string,
                COUNT(*) as attempts,
                SUM(CASE WHEN nr.outcome != 'correct' THEN 1 ELSE 0 END) as misses,
                ROUND(100.0 * SUM(CASE WHEN nr.outcome = 'correct' THEN 1 ELSE 0 END) / COUNT(*), 1) as accuracy
            FROM note_results nr
            JOIN history h ON h.id = nr.history_id
            WHERE h.profile_id = ?
            GROUP BY nr.string
            ORDER BY nr.string
        ''', (profile_id,)).fetchall()

    return jsonify({
        'by_note':   [dict(r) for r in by_note],
        'by_string': [dict(r) for r in by_string]
    })

# ===== 被験者アカウントに割り当てられた練習ロードマップ（音階SUBJECT_ROADMAP_LENGTH個のステップ）を取得 =====
# 被験者本人、または管理者（他人の分も含む）が閲覧できる。
# 現在どのステップまで進んでいるか（current_step）もあわせて返す
@app.route('/api/subject-assignment', methods=['GET'])
@login_required
def get_subject_assignment():
    profile_id = request.args.get('profile_id', type=int, default=session['profile_id'])
    if not can_access_profile(profile_id):
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        steps = conn.execute(
            'SELECT step_order, category_key, scale_id, direction, bpm, with_practice, session_end FROM subject_assignment_steps '
            'WHERE profile_id = ? ORDER BY step_order',
            (profile_id,)
        ).fetchall()
        profile_row = conn.execute(
            'SELECT subject_step_index, subject_stage_phase FROM profiles WHERE id = ?', (profile_id,)
        ).fetchone()

    if not steps:
        return jsonify({'error': '練習内容が割り当てられていません'}), 404
    return jsonify({
        'steps': [dict(s) for s in steps],
        'current_step': profile_row[0] if profile_row else 0,
        'stage_phase': profile_row[1] if profile_row else 'baseline'
    })

# ===== 被験者の練習ロードマップ（音階6つ）を管理者が変更する =====
# 音階はまだ研究用に決まっていないため、作成時は仮のものを割り当てている。
# ここから、各ステップの音階（カテゴリー・調）と、6ステップ共通の方向・テンポを変更できる。
# 内容が変わるため、進捗（現在のステップ）は0に戻す
@app.route('/api/subject-assignment/<int:profile_id>', methods=['PUT'])
@login_required
def update_subject_assignment(profile_id):
    if session.get('role') != 'admin':
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        profile = conn.execute('SELECT is_subject FROM profiles WHERE id = ?', (profile_id,)).fetchone()
    if profile is None:
        return jsonify({'error': '指定されたアカウントが見つかりません'}), 404
    if profile['is_subject'] != 'yes':
        return jsonify({'error': '被験者アカウントではありません'}), 400

    data      = request.get_json() or {}
    direction = data.get('direction')
    if direction not in VALID_DIRECTIONS:
        return jsonify({'error': '不正な練習タイプです'}), 400
    try:
        bpm = int(data.get('bpm'))
    except (TypeError, ValueError):
        return jsonify({'error': 'テンポを指定してください'}), 400
    if not (40 <= bpm <= 120):
        return jsonify({'error': 'テンポは40〜120の範囲で指定してください'}), 400

    steps_in = data.get('steps')
    if not isinstance(steps_in, list) or not (1 <= len(steps_in) <= MAX_ROADMAP_STEPS):
        return jsonify({'error': f'音階は1〜{MAX_ROADMAP_STEPS}個で指定してください'}), 400

    validated_steps = []
    with sqlite3.connect(DB_PATH) as conn:
        for step in steps_in:
            category_key = step.get('category_key') if isinstance(step, dict) else None
            if category_key not in CATEGORY_LABELS:
                return jsonify({'error': '不正なカテゴリーです'}), 400
            try:
                scale_id = int(step.get('scale_id'))
            except (TypeError, ValueError):
                return jsonify({'error': '音階を指定してください'}), 400
            scale_row = conn.execute(
                'SELECT id FROM scales WHERE id = ? AND category_key = ?', (scale_id, category_key)
            ).fetchone()
            if scale_row is None:
                return jsonify({'error': '指定された音階が見つかりません'}), 400
            with_practice = step.get('with_practice', 'yes') if isinstance(step, dict) else 'yes'
            if with_practice not in ('yes', 'no'):
                return jsonify({'error': 'with_practiceはyesかnoで指定してください'}), 400
            session_end = step.get('session_end', 'no') if isinstance(step, dict) else 'no'
            if session_end not in ('yes', 'no'):
                return jsonify({'error': 'session_endはyesかnoで指定してください'}), 400
            validated_steps.append((category_key, scale_id, with_practice, session_end))

    updated_at = datetime.now().strftime('%Y/%m/%d %H:%M')
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('DELETE FROM subject_assignment_steps WHERE profile_id = ?', (profile_id,))
        conn.executemany(
            'INSERT INTO subject_assignment_steps '
            '(profile_id, step_order, category_key, scale_id, direction, bpm, with_practice, session_end, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [(profile_id, i, cat, sid, direction, bpm, wp, se, updated_at)
             for i, (cat, sid, wp, se) in enumerate(validated_steps)]
        )
        conn.execute('UPDATE profiles SET subject_step_index = 0 WHERE id = ?', (profile_id,))
        conn.commit()

    return jsonify({'message': 'updated'}), 200

# ===== 被験者ロードマップを1ステップ進める（現在のステップに合格したとき） =====
# 必ず本人のアカウントに対してのみ進められる（他人の進捗を操作できないように）
@app.route('/api/subject-progress/advance', methods=['POST'])
@login_required
def advance_subject_progress():
    profile_id = session['profile_id']

    with sqlite3.connect(DB_PATH) as conn:
        step_count = conn.execute(
            'SELECT COUNT(*) FROM subject_assignment_steps WHERE profile_id = ?', (profile_id,)
        ).fetchone()[0]
        current = conn.execute(
            'SELECT subject_step_index FROM profiles WHERE id = ?', (profile_id,)
        ).fetchone()[0]
        new_index = min(current + 1, step_count)
        # 次のステージ（音階）に進むので、そのステージのフェーズは必ず事前演奏からやり直す
        conn.execute(
            "UPDATE profiles SET subject_step_index = ?, subject_stage_phase = 'baseline' WHERE id = ?",
            (new_index, profile_id)
        )
        conn.commit()

    return jsonify({'current_step': new_index, 'total_steps': step_count}), 200

# ===== 被験者の今のステージ（音階）内でのフェーズを変更する =====
# baseline（事前演奏）→practice（自由練習）→test（テスト演奏）の間を移動するときに呼ぶ。
# 次のステージに進むとき（baselineへのリセット）は advance_subject_progress が行うので、
# ここでは同じステージ内での移動（baseline→practice、test失敗→practiceなど）だけを扱う
@app.route('/api/subject-progress/phase', methods=['POST'])
@login_required
def set_subject_stage_phase():
    data  = request.get_json() or {}
    phase = data.get('phase')
    if phase not in ('baseline', 'practice', 'test'):
        return jsonify({'error': 'phaseはbaseline・practice・testのいずれかで指定してください'}), 400

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            'UPDATE profiles SET subject_stage_phase = ? WHERE id = ?', (phase, session['profile_id'])
        )
        conn.commit()

    return jsonify({'stage_phase': phase}), 200

# ===== 被験者チュートリアルを既読にする =====
# 必ず本人のアカウントに対してのみ（他人の既読状態を操作できないように）
@app.route('/api/subject-tutorial/seen', methods=['POST'])
@login_required
def mark_subject_tutorial_seen():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "UPDATE profiles SET has_seen_tutorial = 'yes' WHERE id = ?", (session['profile_id'],)
        )
        conn.commit()
    return jsonify({'has_seen_tutorial': 'yes'}), 200

# ===== 検証モードで使う音階ロードマップ（音階6つ）を取得 =====
# 管理者が「検証モード」タブで体験するときに使う、管理者全体で共通の設定。
# 未設定（steps が空）の場合は、フロント側が登録済みの音階から自動で仮の6つを選ぶ
@app.route('/api/verify-mode-scales', methods=['GET'])
@login_required
def get_verify_mode_scales():
    if session.get('role') != 'admin':
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT step_order, category_key, scale_id, with_practice, session_end FROM verify_mode_scale_steps ORDER BY step_order'
        ).fetchall()
    return jsonify({'steps': [dict(r) for r in rows]})

# ===== 検証モードの音階ロードマップを設定する =====
@app.route('/api/verify-mode-scales', methods=['PUT'])
@login_required
def update_verify_mode_scales():
    if session.get('role') != 'admin':
        return jsonify({'error': '権限がありません'}), 403

    data     = request.get_json() or {}
    steps_in = data.get('steps')
    if not isinstance(steps_in, list) or not (1 <= len(steps_in) <= MAX_ROADMAP_STEPS):
        return jsonify({'error': f'音階は1〜{MAX_ROADMAP_STEPS}個で指定してください'}), 400

    validated_steps = []
    with sqlite3.connect(DB_PATH) as conn:
        for step in steps_in:
            category_key = step.get('category_key') if isinstance(step, dict) else None
            if category_key not in CATEGORY_LABELS:
                return jsonify({'error': '不正なカテゴリーです'}), 400
            try:
                scale_id = int(step.get('scale_id'))
            except (TypeError, ValueError):
                return jsonify({'error': '音階を指定してください'}), 400
            scale_row = conn.execute(
                'SELECT id FROM scales WHERE id = ? AND category_key = ?', (scale_id, category_key)
            ).fetchone()
            if scale_row is None:
                return jsonify({'error': '指定された音階が見つかりません'}), 400
            with_practice = step.get('with_practice', 'yes') if isinstance(step, dict) else 'yes'
            if with_practice not in ('yes', 'no'):
                return jsonify({'error': 'with_practiceはyesかnoで指定してください'}), 400
            session_end = step.get('session_end', 'no') if isinstance(step, dict) else 'no'
            if session_end not in ('yes', 'no'):
                return jsonify({'error': 'session_endはyesかnoで指定してください'}), 400
            validated_steps.append((category_key, scale_id, with_practice, session_end))

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('DELETE FROM verify_mode_scale_steps')
        conn.executemany(
            'INSERT INTO verify_mode_scale_steps (step_order, category_key, scale_id, with_practice, session_end) VALUES (?, ?, ?, ?, ?)',
            [(i, cat, sid, wp, se) for i, (cat, sid, wp, se) in enumerate(validated_steps)]
        )
        conn.commit()

    return jsonify({'message': 'updated'}), 200

# ===== 検証モードの音階ロードマップを未設定（自動選択）に戻す =====
@app.route('/api/verify-mode-scales', methods=['DELETE'])
@login_required
def reset_verify_mode_scales():
    if session.get('role') != 'admin':
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('DELETE FROM verify_mode_scale_steps')
        conn.commit()
    return jsonify({'message': 'reset'}), 200

# ===== 音階（調）一覧を取得 =====
# 練習画面のセレクトボックスに使うため、誰でも読める（ログイン不要）
@app.route('/api/scales', methods=['GET'])
def get_scales():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM scales ORDER BY category_key, id').fetchall()

    categories = {key: {'label': label, 'scales': {}} for key, label in CATEGORY_LABELS.items()}
    for row in rows:
        if row['category_key'] not in categories:
            continue
        categories[row['category_key']]['scales'][str(row['id'])] = {
            'name':     row['name'],
            'notes':    json.loads(row['notes_json']),
            'arpeggio': json.loads(row['arpeggio_json']) if row['arpeggio_json'] else None,
            'key_sig':  json.loads(row['key_sig_json'])  if row['key_sig_json']  else {},
        }
    return jsonify({'categories': categories})

# 音階の登録・更新に共通のバリデーション。
# 問題なければ (category_key, name, notes, arpeggio) を返し、問題があれば (None, None, None, None, エラー文言) を返す
def validate_scale_payload(data):
    category_key = data.get('category_key')
    name         = (data.get('name') or '').strip()
    notes        = data.get('notes')
    arpeggio     = data.get('arpeggio')  # 任意。無ければnull

    if category_key not in CATEGORY_LABELS:
        return None, None, None, None, '不正なカテゴリーです'
    if not name:
        return None, None, None, None, '調の名前を入力してください'

    valid_notes = get_valid_note_keys()

    def validate_note_list(note_list, label):
        if not isinstance(note_list, list) or len(note_list) < 2:
            return f'{label}は2音以上で入力してください'
        for n in note_list:
            if not isinstance(n, dict):
                return f'{label}のデータ形式が不正です'
            if n.get('note') not in valid_notes:
                return f'{label}に存在しない音名が含まれています: {n.get("note")}'
            if n.get('string') not in VALID_STRINGS:
                return f'{label}の弦の指定が不正です: {n.get("string")}'
            if not (n.get('position') or '').strip():
                return f'{label}に指の情報が入力されていない音があります'
        return None

    error = validate_note_list(notes, '音階')
    if error:
        return None, None, None, None, error

    if arpeggio is not None:
        error = validate_note_list(arpeggio, 'アルペジオ')
        if error:
            return None, None, None, None, error

    return category_key, name, notes, arpeggio, None

# ===== 音階（調）を新規追加（管理者のみ） =====
# 管理画面の五線譜クリック入力から送られてくる、音符の並び（と任意でアルペジオ）を登録する
@app.route('/api/scales', methods=['POST'])
@login_required
def create_scale():
    if session.get('role') != 'admin':
        return jsonify({'error': '権限がありません'}), 403

    data = request.get_json() or {}
    category_key, name, notes, arpeggio, error = validate_scale_payload(data)
    if error:
        return jsonify({'error': error}), 400

    key_sig = data.get('key_sig') or {}
    created_at = datetime.now().strftime('%Y/%m/%d %H:%M')
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            'INSERT INTO scales (category_key, name, notes_json, arpeggio_json, key_sig_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            (
                category_key, name,
                json.dumps(notes, ensure_ascii=False),
                json.dumps(arpeggio, ensure_ascii=False) if arpeggio else None,
                json.dumps(key_sig, ensure_ascii=False) if key_sig else None,
                created_at,
            )
        )
        conn.commit()
        scale_id = cur.lastrowid

    return jsonify({'id': scale_id, 'category_key': category_key, 'name': name}), 201

# ===== 音階（調）を修正（管理者のみ） =====
@app.route('/api/scales/<int:scale_id>', methods=['PUT'])
@login_required
def update_scale(scale_id):
    if session.get('role') != 'admin':
        return jsonify({'error': '権限がありません'}), 403

    data = request.get_json() or {}
    category_key, name, notes, arpeggio, error = validate_scale_payload(data)
    if error:
        return jsonify({'error': error}), 400

    key_sig = data.get('key_sig') or {}
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            'UPDATE scales SET category_key = ?, name = ?, notes_json = ?, arpeggio_json = ?, key_sig_json = ? WHERE id = ?',
            (
                category_key, name,
                json.dumps(notes, ensure_ascii=False),
                json.dumps(arpeggio, ensure_ascii=False) if arpeggio else None,
                json.dumps(key_sig, ensure_ascii=False) if key_sig else None,
                scale_id,
            )
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'error': '指定された音階が見つかりません'}), 404

    return jsonify({'id': scale_id, 'category_key': category_key, 'name': name}), 200

# ===== 音階（調）を削除（管理者のみ） =====
# 過去の練習記録は音階名を文字列としてそのまま保持しているため、削除しても記録には影響しない
@app.route('/api/scales/<int:scale_id>', methods=['DELETE'])
@login_required
def delete_scale(scale_id):
    if session.get('role') != 'admin':
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute('DELETE FROM scales WHERE id = ?', (scale_id,))
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'error': '指定された音階が見つかりません'}), 404

    return jsonify({'deleted': True}), 200

# ===== 研究分析データ（管理者・研究者用） =====
# 被験者全員の事前/事後計測記録を、被験者・音階・日番号ごとに集計して返す
@app.route('/api/research-analysis', methods=['GET'])
@login_required
def research_analysis():
    if session.get('role') not in ('admin', 'researcher'):
        return jsonify({'error': '権限がありません'}), 403

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT h.profile_id, p.name AS subject_name,
                   h.scale, h.phase, h.accuracy, h.notes_correct, h.notes_total, h.practiced_at
            FROM history h
            JOIN profiles p ON p.id = h.profile_id
            WHERE p.is_subject = 'yes'
              AND h.phase IN ('baseline', 'test')
              AND h.mode = 'tempo'
            ORDER BY h.profile_id, h.scale, h.practiced_at
        ''').fetchall()

    # 被験者・音階ごとに日番号（1,2,3,4）を割り当てる
    from collections import defaultdict
    day_tracker = defaultdict(int)   # (profile_id, scale) → day番号
    result = []
    for r in rows:
        key = (r['profile_id'], r['scale'], r['phase'])
        day_tracker[key] += 1
        day_num = day_tracker[(r['profile_id'], r['scale'], 'baseline')] if r['phase'] == 'baseline' \
                  else day_tracker[(r['profile_id'], r['scale'], 'baseline')]
        result.append({
            'subject':     r['subject_name'],
            'profile_id':  r['profile_id'],
            'scale':       r['scale'],
            'phase':       r['phase'],
            'day':         day_tracker[(r['profile_id'], r['scale'], r['phase'])],
            'accuracy':    r['accuracy'],
            'practiced_at': r['practiced_at'],
        })

    return jsonify(result)


VIEWER_ROLES = ('viewer', 'admin', 'researcher')

# ===== 閲覧用API =====

@app.route('/api/viewer/subjects', methods=['GET'])
@login_required
def viewer_subjects():
    if session.get('role') not in VIEWER_ROLES:
        return jsonify({'error': '権限がありません'}), 403
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        profiles = conn.execute(
            "SELECT id, name, subject_step_index FROM profiles WHERE is_subject='yes' ORDER BY id"
        ).fetchall()
        result = []
        for p in profiles:
            steps = conn.execute(
                'SELECT step_order, scale_id FROM subject_assignment_steps WHERE profile_id=? ORDER BY step_order LIMIT 4',
                (p['id'],)
            ).fetchall()
            # phase1: steps 0-7 (scale_ids at steps 0,1), phase2: steps 8-15 (scale_ids at steps 8,9)
            scale_ids = {s['step_order']: s['scale_id'] for s in steps}
            scale_names = {}
            for sid in set(scale_ids.values()):
                row = conn.execute('SELECT name FROM scales WHERE id=?', (sid,)).fetchone()
                if row:
                    scale_names[sid] = row['name']
            phase1 = [scale_names.get(scale_ids.get(0, 0), ''), scale_names.get(scale_ids.get(1, 0), '')]
            # get phase2 scale ids (steps 8,9)
            steps2 = conn.execute(
                'SELECT step_order, scale_id FROM subject_assignment_steps WHERE profile_id=? AND step_order IN (8,9)',
                (p['id'],)
            ).fetchall()
            scale_ids2 = {s['step_order']: s['scale_id'] for s in steps2}
            for sid in set(scale_ids2.values()):
                row = conn.execute('SELECT name FROM scales WHERE id=?', (sid,)).fetchone()
                if row:
                    scale_names[sid] = row['name']
            phase2 = [scale_names.get(scale_ids2.get(8, 0), ''), scale_names.get(scale_ids2.get(9, 0), '')]
            wp_row = conn.execute(
                'SELECT with_practice FROM subject_assignment_steps WHERE profile_id=? ORDER BY step_order LIMIT 1',
                (p['id'],)
            ).fetchone()
            result.append({
                'id': p['id'],
                'name': p['name'],
                'step_index': p['subject_step_index'],
                'phase1_scales': [s for s in phase1 if s],
                'phase2_scales': [s for s in phase2 if s],
                'with_practice': wp_row['with_practice'] if wp_row else 'no',
            })
    return jsonify(result)


@app.route('/api/viewer/subject/<int:pid>/timeline', methods=['GET'])
@login_required
def viewer_subject_timeline(pid):
    if session.get('role') not in VIEWER_ROLES:
        return jsonify({'error': '権限がありません'}), 403
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT phase, scale, direction, practiced_at, accuracy, notes_correct, notes_total, mode, bpm
            FROM history
            WHERE profile_id=?
            ORDER BY id
        ''', (pid,)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/viewer/group-stats', methods=['GET'])
@login_required
def viewer_group_stats():
    if session.get('role') not in VIEWER_ROLES:
        return jsonify({'error': '権限がありません'}), 403
    scale = request.args.get('scale', '')
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        scale_cond = 'AND h.scale = ?' if scale else ''
        params = [scale] if scale else []
        # 被験者ごとのbaseline/test平均 + アプリ練習有無
        subject_rows = conn.execute(f'''
            SELECT p.id, p.name,
                   AVG(CASE WHEN h.phase='baseline' THEN h.accuracy END) as baseline_avg,
                   AVG(CASE WHEN h.phase='test'     THEN h.accuracy END) as test_avg,
                   (SELECT s.with_practice FROM subject_assignment_steps s
                    WHERE s.profile_id = p.id ORDER BY s.step_order LIMIT 1) as with_practice
            FROM profiles p
            JOIN history h ON h.profile_id = p.id
            WHERE p.is_subject='yes' AND h.phase IN ('baseline','test') {scale_cond}
            GROUP BY p.id
            ORDER BY p.id
        ''', params).fetchall()
        # 音階別baseline/test平均（常に全音階）
        scale_rows = conn.execute('''
            SELECT h.scale,
                   AVG(CASE WHEN h.phase='baseline' THEN h.accuracy END) as baseline_avg,
                   AVG(CASE WHEN h.phase='test'     THEN h.accuracy END) as test_avg,
                   COUNT(*) as count
            FROM history h
            JOIN profiles p ON p.id = h.profile_id
            WHERE p.is_subject='yes' AND h.mode='tempo' AND h.phase IN ('baseline','test')
            GROUP BY h.scale
            ORDER BY h.scale
        ''').fetchall()

    subjects = []
    improvements = []
    for r in subject_rows:
        b = round(r['baseline_avg'] or 0, 1)
        t = round(r['test_avg'] or 0, 1)
        imp = round(t - b, 1)
        improvements.append(imp)
        subjects.append({'id': r['id'], 'name': r['name'],
                         'baseline_avg': b, 'test_avg': t, 'improvement': imp,
                         'with_practice': (r['with_practice'] or 'no') == 'yes'})

    overall = round(sum(improvements) / len(improvements), 1) if improvements else 0
    by_scale = [{'scale': r['scale'],
                 'baseline_avg': round(r['baseline_avg'] or 0, 1),
                 'test_avg':     round(r['test_avg'] or 0, 1),
                 'count':        r['count']} for r in scale_rows]
    return jsonify({'subjects': subjects, 'by_scale': by_scale, 'overall_improvement': overall})


@app.route('/api/viewer/group-timeline', methods=['GET'])
@login_required
def viewer_group_timeline():
    if session.get('role') not in VIEWER_ROLES:
        return jsonify({'error': '権限がありません'}), 403
    scale = request.args.get('scale', '')
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        profiles = conn.execute(
            "SELECT id, name FROM profiles WHERE is_subject='yes' ORDER BY id"
        ).fetchall()
        result = []
        for p in profiles:
            scale_cond = 'AND scale = ?' if scale else ''
            params = (p['id'], scale) if scale else (p['id'],)
            rows = conn.execute(f'''
                SELECT phase, practiced_at, AVG(accuracy) as accuracy
                FROM history
                WHERE profile_id=? AND phase IN ('baseline','test') {scale_cond}
                GROUP BY phase, substr(practiced_at,1,10)
                ORDER BY practiced_at
            ''', params).fetchall()
            wp_row = conn.execute(
                'SELECT with_practice FROM subject_assignment_steps WHERE profile_id=? ORDER BY step_order LIMIT 1',
                (p['id'],)
            ).fetchone()
            with_practice = (wp_row['with_practice'] if wp_row else 'no') == 'yes'
            # 日付→index(Day1...)
            dates = sorted(set(r['practiced_at'][:10] for r in rows))
            day_map = {d: i+1 for i, d in enumerate(dates)}
            days = {}
            for r in rows:
                d = r['practiced_at'][:10]
                day = day_map[d]
                if day not in days:
                    days[day] = {'day': day, 'date': d}
                days[day][r['phase']] = round(r['accuracy'], 1)
            result.append({
                'id': p['id'], 'name': p['name'], 'with_practice': with_practice,
                'days': sorted(days.values(), key=lambda x: x['day'])
            })
    return jsonify(result)


@app.route('/api/viewer/note-heatmap', methods=['GET'])
@login_required
def viewer_note_heatmap():
    if session.get('role') not in VIEWER_ROLES:
        return jsonify({'error': '権限がありません'}), 403
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT nr.note,
                   COUNT(*) as attempts,
                   ROUND(100.0 * SUM(CASE WHEN nr.outcome='correct' THEN 1 ELSE 0 END) / COUNT(*), 1) as accuracy
            FROM note_results nr
            JOIN history h ON h.id = nr.history_id
            JOIN profiles p ON p.id = h.profile_id
            WHERE p.is_subject='yes' AND h.phase IN ('baseline','test')
            GROUP BY nr.note
            HAVING attempts >= 2
            ORDER BY accuracy ASC
            LIMIT 20
        ''').fetchall()
    return jsonify([dict(r) for r in rows])


if __name__ == '__main__':
    init_db()
    app.run(debug=True)
