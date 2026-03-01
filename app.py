from flask import Flask, render_template, request, jsonify
import os
import datetime

app = Flask(__name__)

# 預設根目錄（可透過 query param 覆蓋）
DEFAULT_ROOT = os.path.expanduser("~")


def safe_path(root, path):
    """確保路徑在根目錄內，防止目錄遍歷攻擊"""
    abs_root = os.path.abspath(root)
    abs_path = os.path.abspath(path)
    if not abs_path.startswith(abs_root):
        return None
    return abs_path


def scan_tree(directory):
    """遞迴掃描資料夾，回傳只含 .md 檔案的樹狀結構"""
    tree = []
    try:
        entries = sorted(os.listdir(directory), key=lambda x: (not os.path.isdir(os.path.join(directory, x)), x.lower()))
    except PermissionError:
        return tree

    for entry in entries:
        full_path = os.path.join(directory, entry)
        if os.path.isdir(full_path):
            # 跳過隱藏資料夾和常見的非內容目錄
            if entry.startswith('.') or entry in ('node_modules', '__pycache__', '.git', '.venv', 'venv'):
                continue
            children = scan_tree(full_path)
            if children:  # 只顯示含有 .md 檔案的資料夾
                tree.append({
                    'name': entry,
                    'type': 'directory',
                    'path': full_path.replace('\\', '/'),
                    'children': children
                })
        elif entry.lower().endswith('.md'):
            tree.append({
                'name': entry,
                'type': 'file',
                'path': full_path.replace('\\', '/')
            })
    return tree


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/tree')
def api_tree():
    root = request.args.get('root', DEFAULT_ROOT)
    if not os.path.isdir(root):
        return jsonify({'error': '目錄不存在'}), 400
    tree = scan_tree(root)
    return jsonify({'root': root.replace('\\', '/'), 'tree': tree})


@app.route('/api/file')
def api_file():
    path = request.args.get('path', '')
    if not path or not os.path.isfile(path):
        return jsonify({'error': '檔案不存在'}), 400

    try:
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    stat = os.stat(path)
    mod_time = datetime.datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
    lines = content.count('\n') + (1 if content and not content.endswith('\n') else 0)
    # 字數：中文按字元計算，英文按空格分詞
    word_count = len(content) - content.count('\n') - content.count('\r') - content.count(' ')

    return jsonify({
        'content': content,
        'wordCount': word_count,
        'lineCount': lines,
        'modifiedTime': mod_time,
        'fileName': os.path.basename(path)
    })


@app.route('/api/search')
def api_search():
    root = request.args.get('root', DEFAULT_ROOT)
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'results': []})

    results = []
    query_lower = query.lower()

    def search_dir(directory):
        try:
            entries = os.listdir(directory)
        except PermissionError:
            return
        for entry in entries:
            full_path = os.path.join(directory, entry)
            if os.path.isdir(full_path):
                if entry.startswith('.') or entry in ('node_modules', '__pycache__', '.git', '.venv', 'venv'):
                    continue
                search_dir(full_path)
            elif entry.lower().endswith('.md'):
                try:
                    with open(full_path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                    matches = []
                    for i, line in enumerate(lines, 1):
                        if query_lower in line.lower():
                            matches.append({'line': i, 'text': line.strip()[:200]})
                    if matches:
                        results.append({
                            'path': full_path.replace('\\', '/'),
                            'name': entry,
                            'matches': matches[:10]  # 每檔最多回傳 10 筆
                        })
                except Exception:
                    pass

    search_dir(root)
    return jsonify({'results': results[:50]})  # 最多回傳 50 個檔案


if __name__ == '__main__':
    app.run(debug=True, port=12017)
