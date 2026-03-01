# MD Viewer - Markdown 檔案檢視器

## 📋 項目概述

**MD Viewer** 是一個現代化的 Markdown 檢視器應用，提供便捷的 Markdown 文件瀏覽、編輯和管理功能。該應用採用 Web 技術開發，支持深色/淺色主題、即時搜索、PDF 匯出等豐富功能。

## ✨ 核心功能

### 1. **檔案管理與導覽**
   - 遞迴掃描指定目錄，構建檔案樹狀結構
   - 僅顯示 `.md` 檔案及其所在資料夾
   - 支持自訂根目錄，默認為用戶主目錄
   - 自動過濾隱藏資料夾（`.git`、`node_modules`、`.venv` 等）

### 2. **Markdown 渲染**
   - 使用 **Marked.js** 進行 Markdown 解析與轉換
   - 支持 GFM（GitHub Flavored Markdown）語法
   - 集成 **Highlight.js** 進行代碼語法高亮
   - 支持 **Mermaid** 圖表（流程圖、序列圖等）
   - 自動目錄（TOC）生成與導覽

### 3. **多標籤編輯**
   - 支持同時打開多個檔案，以標籤頁形式管理
   - 快速切換標籤頁面
   - 標籤狀態自動保存

### 4. **搜索功能**
   - 快捷鍵 `Ctrl+K` 快速打開搜索面板
   - 即時搜索檔案內容（防抖查詢）
   - 搜索結果高亮顯示
   - 支持多檔案搜索

### 5. **主題支持**
   - 雙主題設計（深色/淺色）
   - 主題偏好設置自動保存
   - 深色主題採用 GitHub 深色風格
   - 流暢的主題切換動畫

### 6. **PDF 匯出**
   - 將當前 Markdown 文檔匯出為 PDF
   - 使用 **html2pdf.js** 處理轉換
   - 自動保留文檔格式和樣式

### 7. **最近檔案追蹤**
   - 記錄最近開啟的檔案（最多 20 個）
   - 快速訪問最近檔案列表
   - 最近資料夾記錄（最多 10 個）

### 8. **狀態欄**
   - 實時顯示當前檔案名稱
   - 字數統計（中英文混合計算）
   - 行數統計
   - 最後修改時間

## 🏗️ 技術棧

### **後端**
- **框架**：Flask（輕量級 Python Web 框架）
- **Python 版本**：3.x
- **依賴**：Flask

### **前端**
- **語言**：HTML5、CSS3、JavaScript (ES6+)
- **UI 庫**：
  - Marked.js - Markdown 解析
  - Highlight.js - 代碼高亮
  - Mermaid - 圖表渲染
  - html2pdf.js - PDF 匯出
- **字體**：Google Fonts (Inter, JetBrains Mono)
- **設計風格**：現代化扁平設計

## 📁 項目結構

```
MDviewer/
├── app.py                 # Flask 應用主文件
├── requirements.txt       # Python 依賴列表
├── run.bat               # Windows 批次檔（啟動應用）
├── README.md             # 本文件
│
├── templates/
│   └── index.html        # 主 HTML 模板
│
└── static/
    ├── css/
    │   └── style.css     # 樣式表（1400+ 行）
    └── js/
        └── main.js       # 前端應用邏輯（1000+ 行）
```

## 🔌 API 端點

### 1. `GET /`
**作用**：主頁面
- 返回主 HTML 模板

### 2. `GET /api/tree?root={path}`
**作用**：獲取檔案樹結構
- **參數**：
  - `root`（可選）：指定根目錄路徑，默認為用戶主目錄
- **返回**：
  ```json
  {
    "root": "/path/to/root",
    "tree": [
      {
        "name": "folder_name",
        "type": "directory",
        "path": "/path/to/folder",
        "children": [...]
      },
      {
        "name": "file.md",
        "type": "file",
        "path": "/path/to/file.md"
      }
    ]
  }
  ```

### 3. `GET /api/file?path={path}`
**作用**：讀取 Markdown 檔案內容
- **參數**：
  - `path`：檔案完整路徑
- **返回**：
  ```json
  {
    "content": "# Markdown Content...",
    "wordCount": 250,
    "lineCount": 15,
    "modifiedTime": "2026-03-01 10:30:45",
    "fileName": "example.md"
  }
  ```
- **安全性**：實現路徑驗證，防止目錄遍歷攻擊

### 4. `GET /api/search?root={root}&q={query}`
**作用**：搜索檔案內容
- **參數**：
  - `root`：搜索根目錄
  - `q`：搜索關鍵詞
- **返回**：包含匹配結果的檔案列表及匹配位置

## 🚀 安裝與使用

### 前置要求
- Python 3.6 或更高版本
- pip（Python 包管理器）

### 安裝步驟

1. **克隆或下載項目**
   ```bash
   cd d:\Projects\MDviewer
   ```

2. **創建虛擬環境（推薦）**
   ```bash
   python -m venv .venv
   # Windows
   .venv\Scripts\activate
   # macOS/Linux
   source .venv/bin/activate
   ```

3. **安裝依賴**
   ```bash
   pip install -r requirements.txt
   ```

4. **運行應用**
   - **Windows**：雙擊 `run.bat`
   - **命令行**：
     ```bash
     python app.py
     ```

5. **打開瀏覽器**
   - 訪問 `http://localhost:5000`

## ⌨️ 快捷鍵

| 快捷鍵 | 功能 |
|--------|------|
| `Ctrl+K` | 打開搜索面板 |
| `Esc` | 關閉搜索面板/模態框 |

## 💾 數據持久化

應用使用 **localStorage** 保存用戶設置，包括：
- 主題偏好（深色/淺色）
- 側邊欄寬度
- 目錄導覽寬度
- 最近打開的檔案列表
- 最近訪問的資料夾
- 當前開啟的標籤頁
- 活動標籤頁

刷新頁面後，這些設置會自動恢復。

## 🔐 安全性

### 實現的安全措施

1. **路徑驗證** - `safe_path()` 函數
   - 驗證所有檔案路徑在指定根目錄內
   - 防止目錄遍歷攻擊（Directory Traversal）

2. **權限處理**
   - 捕捉 `PermissionError` 例外
   - 無法訪問的目錄會被跳過

3. **編碼處理**
   - 檔案讀取使用 UTF-8 編碼
   - 路徑正規化（Windows/Unix 相容）

## 🎨 UI/UX 特性

### 三欄式佈局
- **左側**：檔案總管（可調寬度）
- **中央**：Markdown 預覽區
- **右側**：目錄導覽（可調寬度）

### 響應式設計
- 支持拖拽調整欄寬
- 適應不同屏幕尺寸
- 移動設備友好

### 視覺反饋
- 懸停效果
- 點擊動畫
- 平滑滾動
- 搜索結果高亮

## 📊 統計功能

- **字數統計**：中文按字元計算，英文按空格分詞
- **行數統計**：準確計算檔案行數
- **修改時間**：顯示最後修改時間戳

## 🌐 支持的 Markdown 語法

- 標題（H1-H6）
- 粗體、斜體、刪除線
- 列表（有序、無序、任務列表）
- 代碼塊（含語法高亮）
- 內聯代碼
- 引用
- 表格
- 圖片與連結
- 水平線
- HTML 嵌入
- Mermaid 圖表

## 🐛 已知限制

1. **檔案編輯**：當前為只讀模式，不支持直接編輯
2. **大檔案**：超大 Markdown 文件可能影響渲染性能
3. **實時同步**：不支持檔案系統變化的即時監控

## 🚧 可能的改進方向

- [ ] 新增 Markdown 編輯功能
- [ ] 檔案歷史版本管理
- [ ] 全文索引搜索優化
- [ ] 協作編輯支持
- [ ] 國際化語言支持
- [ ] 暗色模式主題擴展

## 📝 配置說明

### 默認根目錄
在 `app.py` 中修改 `DEFAULT_ROOT` 變數：
```python
DEFAULT_ROOT = os.path.expanduser("~")  # 用戶主目錄
```

可改為：
```python
DEFAULT_ROOT = "D:/Projects"  # 特定專案目錄
```

## 🤝 貢獻指南

歡迎提交 Issue 和 Pull Request 以改進此項目。

## 📄 許可證

本項目遵循相關開源許可證。

## 📮 聯繫方式

如有問題或建議，歡迎通過 Issue 提交反饋。

---

**更新時間**：2026 年 3 月 1 日

**版本**：1.0.0

