from flask import Flask, render_template, request, jsonify
import sqlite3
import os
from datetime import datetime

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), 'database', 'history.db')

# ===== DB初期化 =====
def init_db():
    with sqlite3.connect(DB_PATH) as conn:
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

        # 旧スキーマ（mode/bpm等の列がない）のDBを移行
        existing_cols = {row[1] for row in conn.execute('PRAGMA table_info(history)')}
        migrations = {
            'mode':          "ALTER TABLE history ADD COLUMN mode TEXT NOT NULL DEFAULT 'step'",
            'bpm':           "ALTER TABLE history ADD COLUMN bpm INTEGER",
            'notes_correct': "ALTER TABLE history ADD COLUMN notes_correct INTEGER NOT NULL DEFAULT 0",
            'notes_total':   "ALTER TABLE history ADD COLUMN notes_total INTEGER NOT NULL DEFAULT 0",
            'accuracy':      "ALTER TABLE history ADD COLUMN accuracy REAL NOT NULL DEFAULT 0.0",
        }
        for col, ddl in migrations.items():
            if col not in existing_cols:
                conn.execute(ddl)

        conn.commit()

# ===== ページ =====
@app.route('/')
def home():
    return render_template('index.html')

# ===== 履歴を取得 =====
@app.route('/api/history', methods=['GET'])
def get_history():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT * FROM history ORDER BY id DESC LIMIT 100'
        ).fetchall()
    return jsonify([dict(row) for row in rows])

# ===== 履歴を保存 =====
@app.route('/api/history', methods=['POST'])
def save_history():
    data         = request.get_json()
    scale        = data.get('scale')
    direction    = data.get('direction')
    mode         = data.get('mode', 'step')
    bpm          = data.get('bpm')
    notes_correct= data.get('notes_correct', 0)
    notes_total  = data.get('notes_total', 0)
    accuracy     = round(notes_correct / notes_total * 100, 1) if notes_total > 0 else 0.0
    practiced_at = datetime.now().strftime('%Y/%m/%d %H:%M')

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('''
            INSERT INTO history
              (scale, direction, mode, bpm, notes_correct, notes_total, accuracy, practiced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (scale, direction, mode, bpm, notes_correct, notes_total, accuracy, practiced_at))
        conn.commit()

    return jsonify({
        'scale': scale, 'direction': direction, 'mode': mode,
        'bpm': bpm, 'accuracy': accuracy,
        'notes_correct': notes_correct, 'notes_total': notes_total,
        'time': practiced_at
    }), 201

# ===== 履歴を全件削除 =====
@app.route('/api/history', methods=['DELETE'])
def clear_history():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute('DELETE FROM history')
        conn.commit()
    return jsonify({'message': 'deleted'}), 200

# ===== グラフ用統計データ =====
@app.route('/api/stats', methods=['GET'])
def get_stats():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        # 日別の練習回数と平均正答率（直近30日）
        daily = conn.execute('''
            SELECT
                substr(practiced_at, 1, 10) as date,
                COUNT(*) as count,
                ROUND(AVG(accuracy), 1) as avg_accuracy
            FROM history
            GROUP BY date
            ORDER BY date DESC
            LIMIT 30
        ''').fetchall()

        # 調ごとの平均正答率
        by_scale = conn.execute('''
            SELECT
                scale,
                COUNT(*) as count,
                ROUND(AVG(accuracy), 1) as avg_accuracy
            FROM history
            GROUP BY scale
            ORDER BY avg_accuracy DESC
        ''').fetchall()

    return jsonify({
        'daily': [dict(r) for r in daily],
        'by_scale': [dict(r) for r in by_scale]
    })

if __name__ == '__main__':
    init_db()
    app.run(debug=True)