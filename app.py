from flask import Flask, render_template, request, jsonify
import sqlite3
import os
from datetime import datetime

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), 'database', 'history.db')
DEFAULT_PROFILE_NAME = 'デフォルト'

# ===== DB初期化 =====
def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS profiles (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL UNIQUE,
                created_at TEXT    NOT NULL
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

        # プロフィールが1件もなければ、デフォルトプロフィール（id=1）を作成
        if conn.execute('SELECT COUNT(*) FROM profiles').fetchone()[0] == 0:
            conn.execute(
                'INSERT INTO profiles (name, created_at) VALUES (?, ?)',
                (DEFAULT_PROFILE_NAME, datetime.now().strftime('%Y/%m/%d %H:%M'))
            )

        conn.commit()

# ===== ページ =====
@app.route('/')
def home():
    return render_template('index.html')

# ===== プロフィール一覧 =====
@app.route('/api/profiles', methods=['GET'])
def get_profiles():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM profiles ORDER BY id').fetchall()
    return jsonify([dict(row) for row in rows])

# ===== プロフィール作成 =====
@app.route('/api/profiles', methods=['POST'])
def create_profile():
    name = (request.get_json() or {}).get('name', '').strip()
    if not name:
        return jsonify({'error': '名前を入力してください'}), 400

    created_at = datetime.now().strftime('%Y/%m/%d %H:%M')
    try:
        with sqlite3.connect(DB_PATH) as conn:
            cur = conn.execute(
                'INSERT INTO profiles (name, created_at) VALUES (?, ?)',
                (name, created_at)
            )
            conn.commit()
            profile_id = cur.lastrowid
    except sqlite3.IntegrityError:
        return jsonify({'error': 'その名前は既に使われています'}), 409

    return jsonify({'id': profile_id, 'name': name, 'created_at': created_at}), 201

# ===== プロフィール削除 =====
@app.route('/api/profiles/<int:profile_id>', methods=['DELETE'])
def delete_profile(profile_id):
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

    return jsonify({'message': 'deleted'}), 200

# ===== 履歴を取得 =====
@app.route('/api/history', methods=['GET'])
def get_history():
    profile_id = request.args.get('profile_id', type=int, default=1)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT * FROM history WHERE profile_id = ? ORDER BY id DESC LIMIT 100',
            (profile_id,)
        ).fetchall()
    return jsonify([dict(row) for row in rows])

# ===== 履歴を保存 =====
@app.route('/api/history', methods=['POST'])
def save_history():
    data         = request.get_json()
    profile_id   = data.get('profile_id', 1)
    scale        = data.get('scale')
    direction    = data.get('direction')
    mode         = data.get('mode', 'step')
    bpm          = data.get('bpm')
    notes_correct= data.get('notes_correct', 0)
    notes_total  = data.get('notes_total', 0)
    note_results = data.get('note_results') or []
    accuracy     = round(notes_correct / notes_total * 100, 1) if notes_total > 0 else 0.0
    practiced_at = datetime.now().strftime('%Y/%m/%d %H:%M')

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

# ===== 履歴を全件削除（プロフィール単位） =====
@app.route('/api/history', methods=['DELETE'])
def clear_history():
    profile_id = request.args.get('profile_id', type=int)
    if profile_id is None:
        return jsonify({'error': 'profile_id is required'}), 400

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
def get_stats():
    profile_id = request.args.get('profile_id', type=int, default=1)
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
def get_note_stats():
    profile_id = request.args.get('profile_id', type=int, default=1)
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
