from flask import Flask, render_template, request, jsonify, session
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import os
import secrets
from datetime import datetime, timedelta

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), 'database', 'history.db')
SECRET_KEY_PATH = os.path.join(os.path.dirname(__file__), 'database', 'secret.key')
DEFAULT_PROFILE_NAME = 'デフォルト'

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
                signup_enabled      TEXT NOT NULL DEFAULT 'yes'
            )
        ''')
        existing_settings_cols = {row[1] for row in conn.execute('PRAGMA table_info(app_settings)')}
        if 'result_display_mode' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN result_display_mode TEXT NOT NULL DEFAULT 'accuracy'")
        if 'signup_enabled' not in existing_settings_cols:
            conn.execute("ALTER TABLE app_settings ADD COLUMN signup_enabled TEXT NOT NULL DEFAULT 'yes'")
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

        conn.commit()

# ===== 認証まわりのヘルパー =====
def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'profile_id' not in session:
            return jsonify({'error': 'ログインが必要です'}), 401
        return f(*args, **kwargs)
    return wrapper

# 自分のデータか、管理者かどうかを判定する
# （管理者は他人のデータを閲覧できるが、practicing/書き込みは常に自分のアカウントに対してのみ行う）
def can_access_profile(profile_id):
    return session.get('role') == 'admin' or session.get('profile_id') == profile_id

# ===== ページ =====
@app.route('/')
def home():
    return render_template('index.html')

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
    return jsonify({'id': profile['id'], 'name': profile['name'], 'role': profile['role']}), 200

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
    return jsonify({'id': profile['id'], 'name': profile['name'], 'role': profile['role']}), 200

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
            'SELECT id, name, role FROM profiles WHERE id = ?', (session['profile_id'],)
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
            'SELECT result_display_mode, signup_enabled FROM app_settings WHERE id = 1'
        ).fetchone()
    if row is None:
        return jsonify({'result_display_mode': 'accuracy', 'signup_enabled': 'yes'})
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

    if not updates:
        return jsonify({'error': '更新する項目がありません'}), 400

    with sqlite3.connect(DB_PATH) as conn:
        set_clause = ', '.join(f'{col} = ?' for col in updates)  # updatesのキーは上のホワイトリストのみ
        conn.execute(f'UPDATE app_settings SET {set_clause} WHERE id = 1', tuple(updates.values()))
        conn.commit()
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            'SELECT result_display_mode, signup_enabled FROM app_settings WHERE id = 1'
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
            rows = conn.execute('SELECT id, name, role, created_at FROM profiles ORDER BY id').fetchall()
        else:
            rows = conn.execute(
                'SELECT id, name, role, created_at FROM profiles WHERE id = ?', (session['profile_id'],)
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

    created_at = datetime.now().strftime('%Y/%m/%d %H:%M')
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cur = conn.execute(
                'INSERT INTO profiles (name, created_at, password_hash, role) VALUES (?, ?, ?, ?)',
                (name, created_at, generate_password_hash(password), 'user')
            )
            conn.commit()
            profile_id = cur.lastrowid
    except sqlite3.IntegrityError:
        return jsonify({'error': 'その名前は既に使われています'}), 409

    if not is_admin_request:
        session.clear()
        session.permanent = True
        session['profile_id'] = profile_id
        session['role']       = 'user'
    return jsonify({'id': profile_id, 'name': name, 'role': 'user', 'created_at': created_at}), 201

# ===== アカウント削除（本人か管理者のみ） =====
@app.route('/api/profiles/<int:profile_id>', methods=['DELETE'])
@login_required
def delete_profile(profile_id):
    if not can_access_profile(profile_id):
        return jsonify({'error': '権限がありません'}), 403

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
        rows = conn.execute(
            'SELECT * FROM history WHERE profile_id = ? ORDER BY id DESC LIMIT 100',
            (profile_id,)
        ).fetchall()
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

    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute('''
            INSERT INTO history
              (profile_id, scale, direction, mode, bpm, notes_correct, notes_total, accuracy, practiced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (profile_id, scale, direction, mode, bpm, notes_correct, notes_total, accuracy, practiced_at))
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
        'time': practiced_at
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

    return jsonify({
        'daily': [dict(r) for r in daily],
        'by_scale': [dict(r) for r in by_scale]
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

if __name__ == '__main__':
    init_db()
    app.run(debug=True)
