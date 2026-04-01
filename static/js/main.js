/* ============================================
   MD Viewer — Core Application Logic
   File Tree, Markdown Rendering, Tabs, TOC,
   Search, Theme Toggle, Code Copy, Status Bar,
   Mermaid Diagrams, PDF Export, Recent Files,
   Settings Persistence
   ============================================ */

(() => {
    'use strict';

    // ========================
    //  Settings Manager (localStorage persistence)
    // ========================
    const STORAGE_KEY = 'md-viewer-settings';
    const defaultSettings = {
        theme: 'dark',
        root: '',
        sidebarWidth: 260,
        tocWidth: 240,
        recentFiles: [],     // [{path, name, time}]
        recentFolders: [],   // [path]
        openTabs: [],        // [{path, name}]
        activeTabPath: '',
    };

    function loadSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                return { ...defaultSettings, ...JSON.parse(raw) };
            }
        } catch (e) { /* ignore */ }
        return { ...defaultSettings };
    }

    function saveSettings() {
        try {
            const s = {
                theme: document.documentElement.getAttribute('data-theme') || 'dark',
                root: currentRoot,
                sidebarWidth: sidebar.getBoundingClientRect().width,
                tocWidth: tocSidebar.getBoundingClientRect().width,
                recentFiles: recentFiles.slice(0, 20),
                recentFolders: recentFolders.slice(0, 10),
                openTabs: tabs.map(t => ({ path: t.path, name: t.name })),
                activeTabPath: activeTabId ? (tabs.find(t => t.id === activeTabId)?.path || '') : '',
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        } catch (e) { /* ignore */ }
    }

    const settings = loadSettings();

    // ========================
    //  State
    // ========================
    let currentRoot = settings.root || '';
    let tabs = [];          // { id, path, name, content, wordCount, lineCount, modifiedTime }
    let activeTabId = null;
    let searchDebounce = null;
    let recentFiles = settings.recentFiles || [];
    let recentFolders = settings.recentFolders || [];
    let currentScrollSpy = null; // track IntersectionObserver

    // ========================
    //  DOM References
    // ========================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const fileTree = $('#fileTree');
    const tabList = $('#tabList');
    const previewContainer = $('#previewContainer');
    const markdownBody = $('#markdownBody');
    const welcomeScreen = $('#welcomeScreen');
    const tocNav = $('#tocNav');
    const searchInput = $('#searchInput');
    const searchPanel = $('#searchPanel');
    const searchResults = $('#searchResults');
    const closeSearchPanel = $('#closeSearchPanel');

    // Status bar
    const statusFile = $('#statusFile');
    const statusWords = $('#statusWords');
    const statusWordCount = $('#statusWordCount');
    const statusLines = $('#statusLines');
    const statusLineCount = $('#statusLineCount');
    const statusModified = $('#statusModified');
    const statusModTime = $('#statusModTime');

    // Modal
    const folderModal = $('#folderModal');
    const folderPathInput = $('#folderPathInput');
    const openFolderBtn = $('#openFolderBtn');
    const confirmFolderBtn = $('#confirmFolderBtn');
    const cancelFolderBtn = $('#cancelFolderBtn');
    const closeFolderModal = $('#closeFolderModal');

    // Theme
    const themeToggle = $('#themeToggle');
    const themeIconDark = $('#themeIconDark');
    const themeIconLight = $('#themeIconLight');
    const hljsThemeLink = $('#hljs-theme');

    // Resizers
    const sidebar = $('#sidebar');
    const tocSidebar = $('#tocSidebar');
    const sidebarResizer = $('#sidebarResizer');
    const tocResizer = $('#tocResizer');

    // New elements
    const exportPdfBtn = $('#exportPdfBtn');
    const recentFilesBtn = $('#recentFilesBtn');
    const recentPanel = $('#recentPanel');
    const recentList = $('#recentList');
    const clearRecentBtn = $('#clearRecentBtn');
    const closeAllTabsBtn = $('#closeAllTabsBtn');
    const tocSearchInput = $('#tocSearchInput');
    const welcomeRecent = $('#welcomeRecent');
    const welcomeRecentList = $('#welcomeRecentList');
    const recentFoldersEl = $('#recentFolders');
    const recentFolderListEl = $('#recentFolderList');

    // ========================
    //  Mermaid Initialization
    // ========================
    mermaid.initialize({
        startOnLoad: false,
        theme: settings.theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
        flowchart: { useMaxWidth: true },
    });

    // ========================
    //  Marked.js Configuration
    // ========================
    const renderer = new marked.Renderer();

    // Add anchors to headings
    let headingCounter = 0;
    renderer.heading = function (text, level) {
        const rawText = typeof text === 'object' ? text.text : text;
        const actualLevel = typeof text === 'object' ? text.depth : level;
        const slug = 'heading-' + (headingCounter++);
        return `<h${actualLevel} id="${slug}">${rawText}</h${actualLevel}>`;
    };

    // Wrap code blocks — detect mermaid blocks for diagram rendering
    renderer.code = function (code, language) {
        let codeText, lang;
        if (typeof code === 'object') {
            codeText = code.text;
            lang = code.lang || '';
        } else {
            codeText = code;
            lang = language || '';
        }

        // Mermaid diagram
        if (lang === 'mermaid') {
            const id = 'mermaid-' + Math.random().toString(36).substr(2, 8);
            return `<div class="mermaid-block" data-mermaid-id="${id}">${escapeHtml(codeText)}</div>`;
        }

        const escaped = escapeHtml(codeText);
        let highlighted = escaped;
        if (lang && hljs.getLanguage(lang)) {
            try {
                highlighted = hljs.highlight(codeText, { language: lang }).value;
            } catch (e) { /* fallback */ }
        } else {
            try {
                highlighted = hljs.highlightAuto(codeText).value;
            } catch (e) { /* fallback */ }
        }
        const langLabel = lang ? `<span class="code-lang-label">${escapeHtml(lang)}</span>` : '';
        return `<div class="code-block-wrapper">${langLabel}<button class="copy-code-btn" onclick="copyCodeBlock(this)">複製</button><pre><code class="hljs language-${lang}">${highlighted}</code></pre></div>`;
    };

    marked.setOptions({
        renderer: renderer,
        gfm: true,
        breaks: true,
    });

    // ========================
    //  Utilities
    // ========================
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function generateId() {
        return 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    }

    // ========================
    //  Theme Toggle
    // ========================
    function initTheme() {
        setTheme(settings.theme || 'dark');
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        // v2: 同步 CodeMirror 主題
        if (typeof setEditorTheme === 'function') setEditorTheme(theme);
        if (theme === 'dark') {
            themeIconDark.style.display = '';
            themeIconLight.style.display = 'none';
            hljsThemeLink.href = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css';
        } else {
            themeIconDark.style.display = 'none';
            themeIconLight.style.display = '';
            hljsThemeLink.href = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css';
        }
        // Update mermaid theme
        try {
            mermaid.initialize({
                theme: theme === 'dark' ? 'dark' : 'default',
            });
        } catch (e) { /* ignore */ }
        saveSettings();
    }

    themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        setTheme(current === 'dark' ? 'light' : 'dark');
        // Re-render current tab to update mermaid diagrams
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) renderMarkdown(tab.content);
    });

    // ========================
    //  Recent Files
    // ========================
    function addRecentFile(path, name) {
        // Remove if exists, then prepend
        recentFiles = recentFiles.filter(f => f.path !== path);
        recentFiles.unshift({ path, name, time: Date.now() });
        if (recentFiles.length > 20) recentFiles = recentFiles.slice(0, 20);
        saveSettings();
    }

    function addRecentFolder(path) {
        recentFolders = recentFolders.filter(f => f !== path);
        recentFolders.unshift(path);
        if (recentFolders.length > 10) recentFolders = recentFolders.slice(0, 10);
        saveSettings();
    }

    function renderRecentPanel() {
        if (recentFiles.length === 0) {
            recentList.innerHTML = '<div class="dropdown-empty">尚無最近開啟的檔案</div>';
            return;
        }
        recentList.innerHTML = '';
        recentFiles.forEach(f => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            const ago = timeAgo(f.time);
            item.innerHTML = `
                <span class="dropdown-item-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                </span>
                <span class="dropdown-item-text">${escapeHtml(f.name)}</span>
                <span class="dropdown-item-time">${ago}</span>
            `;
            item.title = f.path;
            item.addEventListener('click', () => {
                openFile(f.path, f.name);
                recentPanel.style.display = 'none';
            });
            recentList.appendChild(item);
        });
    }

    function renderWelcomeRecent() {
        if (recentFiles.length === 0) {
            welcomeRecent.style.display = 'none';
            return;
        }
        welcomeRecent.style.display = '';
        welcomeRecentList.innerHTML = '';
        recentFiles.slice(0, 8).forEach(f => {
            const item = document.createElement('div');
            item.className = 'welcome-recent-item';
            item.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                <span>${escapeHtml(f.name)}</span>
            `;
            item.title = f.path;
            item.addEventListener('click', () => openFile(f.path, f.name));
            welcomeRecentList.appendChild(item);
        });
    }

    function renderRecentFolders() {
        if (recentFolders.length === 0) {
            recentFoldersEl.style.display = 'none';
            return;
        }
        recentFoldersEl.style.display = '';
        recentFolderListEl.innerHTML = '';
        recentFolders.forEach(path => {
            const item = document.createElement('div');
            item.className = 'recent-folder-item';
            item.textContent = path;
            item.addEventListener('click', () => {
                folderPathInput.value = path;
                confirmFolderBtn.click();
            });
            recentFolderListEl.appendChild(item);
        });
    }

    function timeAgo(ts) {
        const diff = Date.now() - ts;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return '剛才';
        if (mins < 60) return `${mins} 分鐘前`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs} 小時前`;
        const days = Math.floor(hrs / 24);
        return `${days} 天前`;
    }

    // Toggle recent panel
    recentFilesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (recentPanel.style.display === 'none') {
            renderRecentPanel();
            recentPanel.style.display = '';
            // Position below button
            const rect = recentFilesBtn.getBoundingClientRect();
            recentPanel.style.top = rect.bottom + 4 + 'px';
            recentPanel.style.right = (window.innerWidth - rect.right) + 'px';
        } else {
            recentPanel.style.display = 'none';
        }
    });

    clearRecentBtn.addEventListener('click', () => {
        recentFiles = [];
        saveSettings();
        renderRecentPanel();
        renderWelcomeRecent();
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!recentPanel.contains(e.target) && e.target !== recentFilesBtn) {
            recentPanel.style.display = 'none';
        }
    });

    // ========================
    //  PDF Export
    // ========================
    exportPdfBtn.addEventListener('click', async () => {
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) {
            alert('請先開啟一個檔案');
            return;
        }

        exportPdfBtn.disabled = true;
        exportPdfBtn.style.opacity = '0.5';

        try {
            const element = markdownBody.cloneNode(true);
            element.style.display = 'block';
            element.style.padding = '20px';
            element.style.maxWidth = '800px';

            // 注入完整的淺色樣式覆寫，確保 PDF 文字可讀
            const pdfStyle = document.createElement('style');
            pdfStyle.textContent = `
                * { color: #1f2328 !important; }
                h1, h2, h3, h4, h5, h6 { color: #1f2328 !important; border-color: #d0d7de !important; }
                a { color: #0969da !important; }
                code { color: #1f2328 !important; background: #f6f8fa !important; }
                pre { background: #f6f8fa !important; border-color: #d0d7de !important; }
                pre code { color: #1f2328 !important; background: #f6f8fa !important; }
                blockquote { color: #656d76 !important; background: #f6f8fa !important; border-color: #0969da !important; }
                table, th, td { border-color: #d0d7de !important; }
                th { background: #f6f8fa !important; color: #1f2328 !important; }
                tr:nth-child(even) { background: #f6f8fa !important; }
                .code-lang-label { color: #656d76 !important; background: #e8ecf0 !important; border-color: #d0d7de !important; }
                .copy-code-btn { display: none !important; }
                .mermaid-block { background: #ffffff !important; border-color: #d0d7de !important; }
                .hljs { background: #f6f8fa !important; color: #1f2328 !important; }
                mark { background: rgba(255,213,79,0.4) !important; color: #1f2328 !important; }
                strong { color: #1f2328 !important; }
                hr { border-color: #d0d7de !important; }

                /* 防止分頁截斷內容 */
                h1, h2, h3, h4, h5, h6 { page-break-after: avoid !important; break-after: avoid !important; }
                p, li, blockquote { page-break-inside: avoid !important; break-inside: avoid !important; }
                pre, .code-block-wrapper { page-break-inside: avoid !important; break-inside: avoid !important; }
                table { page-break-inside: avoid !important; break-inside: avoid !important; }
                tr { page-break-inside: avoid !important; break-inside: avoid !important; }
                thead { display: table-header-group !important; }
                img { page-break-inside: avoid !important; break-inside: avoid !important; }
                .mermaid-block { page-break-inside: avoid !important; break-inside: avoid !important; }
            `;
            element.prepend(pdfStyle);
            element.style.background = '#ffffff';

            const fileName = tab.name.replace(/\.md$/i, '') + '.pdf';

            const opt = {
                margin: [10, 15, 10, 15],
                filename: fileName,
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    letterRendering: true,
                },
                jsPDF: {
                    unit: 'mm',
                    format: 'a4',
                    orientation: 'portrait',
                },
            };

            await html2pdf().set(opt).from(element).save();
        } catch (err) {
            alert('PDF 匯出失敗: ' + err.message);
        } finally {
            exportPdfBtn.disabled = false;
            exportPdfBtn.style.opacity = '';
        }
    });

    // ========================
    //  Folder Open Modal
    // ========================
    function showModal() {
        folderModal.style.display = '';
        folderPathInput.focus();
        renderRecentFolders();
    }

    function hideModal() {
        folderModal.style.display = 'none';
    }

    openFolderBtn.addEventListener('click', showModal);
    cancelFolderBtn.addEventListener('click', hideModal);
    closeFolderModal.addEventListener('click', hideModal);

    confirmFolderBtn.addEventListener('click', () => {
        const path = folderPathInput.value.trim();
        if (path) {
            loadTree(path);
            addRecentFolder(path);
            hideModal();
        }
    });

    folderPathInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmFolderBtn.click();
        } else if (e.key === 'Escape') {
            hideModal();
        }
    });

    folderModal.addEventListener('click', (e) => {
        if (e.target === folderModal) hideModal();
    });

    // ========================
    //  File Tree
    // ========================
    async function loadTree(root) {
        currentRoot = root;
        fileTree.innerHTML = '<div class="tree-empty"><p>載入中…</p></div>';

        try {
            const res = await fetch(`/api/tree?root=${encodeURIComponent(root)}`);
            const data = await res.json();

            if (data.error) {
                fileTree.innerHTML = `<div class="tree-empty"><p>${escapeHtml(data.error)}</p></div>`;
                return;
            }

            if (!data.tree || data.tree.length === 0) {
                fileTree.innerHTML = '<div class="tree-empty"><p>此資料夾中沒有 .md 檔案</p></div>';
                return;
            }

            fileTree.innerHTML = '';
            renderTreeNodes(data.tree, fileTree, 0);
            saveSettings();
            if (typeof refreshAllFiles === 'function') setTimeout(refreshAllFiles, 100);
        } catch (err) {
            fileTree.innerHTML = `<div class="tree-empty"><p>載入失敗: ${escapeHtml(err.message)}</p></div>`;
        }
    }

    function renderTreeNodes(nodes, container, depth) {
        nodes.forEach(node => {
            if (node.type === 'directory') {
                const item = document.createElement('div');
                item.className = 'tree-item';
                item.style.paddingLeft = (12 + depth * 16) + 'px';
                item.innerHTML = `
                    <svg class="tree-chevron expanded" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    <span class="tree-icon folder-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"></path></svg>
                    </span>
                    <span class="tree-label">${escapeHtml(node.name)}</span>
                `;
                container.appendChild(item);

                const children = document.createElement('div');
                children.className = 'tree-children';
                container.appendChild(children);
                renderTreeNodes(node.children, children, depth + 1);

                item.addEventListener('click', () => {
                    const chevron = item.querySelector('.tree-chevron');
                    chevron.classList.toggle('expanded');
                    children.classList.toggle('collapsed');
                });
            } else {
                const item = document.createElement('div');
                item.className = 'tree-item';
                item.style.paddingLeft = (12 + depth * 16 + 20) + 'px';
                item.dataset.path = node.path;
                item.innerHTML = `
                    <span class="tree-icon file-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    </span>
                    <span class="tree-label">${escapeHtml(node.name)}</span>
                `;
                container.appendChild(item);

                item.addEventListener('click', () => {
                    openFile(node.path, node.name);
                });
            }
        });
    }

    // ========================
    //  Tab Management
    // ========================
    function openFile(path, name) {
        const existing = tabs.find(t => t.path === path);
        if (existing) {
            switchTab(existing.id);
            return;
        }
        fetchFile(path, name);
    }

    async function fetchFile(path, name) {
        try {
            const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            if (data.error) {
                alert(data.error);
                return;
            }

            const tab = {
                id: generateId(),
                path: path,
                name: name || data.fileName,
                content: data.content,
                wordCount: data.wordCount,
                lineCount: data.lineCount,
                modifiedTime: data.modifiedTime,
                frontmatter: data.frontmatter || {},
            };

            tabs.push(tab);
            addRecentFile(path, tab.name);
            switchTab(tab.id);
            renderTabs();
            saveSettings();
        } catch (err) {
            alert('載入失敗: ' + err.message);
        }
    }

    function switchTab(tabId) {
        activeTabId = tabId;
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;

        searchPanel.style.display = 'none';
        renderMarkdown(tab.content);
        updateStatusBar(tab);
        if (typeof renderFrontmatterBar === 'function') renderFrontmatterBar(tab.frontmatter || {});

        $$('.tree-item.active').forEach(el => el.classList.remove('active'));
        const treeItem = $(`.tree-item[data-path="${CSS.escape(tab.path)}"]`);
        if (treeItem) treeItem.classList.add('active');

        renderTabs();
        saveSettings();

        // v2: 更新編輯器按鈕 + 同步編輯器內容
        if (typeof updateEditModeBtn === 'function') updateEditModeBtn();
        if (typeof isEditMode !== 'undefined' && isEditMode && typeof cmEditor !== 'undefined' && cmEditor) {
            if (typeof loadEditorContent === 'function') loadEditorContent(tab.content);
        }
    }

    function closeTab(tabId) {
        const idx = tabs.findIndex(t => t.id === tabId);
        if (idx === -1) return;

        tabs.splice(idx, 1);

        if (activeTabId === tabId) {
            if (tabs.length > 0) {
                const newIdx = Math.min(idx, tabs.length - 1);
                switchTab(tabs[newIdx].id);
            } else {
                activeTabId = null;
                showWelcome();
                clearStatusBar();
            }
        }

        renderTabs();
        saveSettings();
        // v2: 更新編輯器按鈕
        if (typeof updateEditModeBtn === 'function') updateEditModeBtn();
    }

    function closeAllTabs() {
        tabs = [];
        activeTabId = null;
        showWelcome();
        clearStatusBar();
        renderTabs();
        saveSettings();
        // v2: 退出編輯模式
        if (typeof exitEditMode === 'function') exitEditMode();
        if (typeof updateEditModeBtn === 'function') updateEditModeBtn();
    }

    closeAllTabsBtn.addEventListener('click', closeAllTabs);

    // Middle-click to close tab
    function renderTabs() {
        tabList.innerHTML = '';
        tabs.forEach(tab => {
            const el = document.createElement('div');
            el.className = 'tab-item' + (tab.id === activeTabId ? ' active' : '');
            el.innerHTML = `
                <span class="tab-label" title="${escapeHtml(tab.path)}">${escapeHtml(tab.name)}</span>
                <span class="tab-close" title="關閉">✕</span>
            `;
            el.querySelector('.tab-label').addEventListener('click', () => switchTab(tab.id));
            el.querySelector('.tab-close').addEventListener('click', (e) => {
                e.stopPropagation();
                closeTab(tab.id);
            });
            // Middle-click to close
            el.addEventListener('mousedown', (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                }
            });
            tabList.appendChild(el);
        });
        // Show/hide close-all button
        closeAllTabsBtn.style.display = tabs.length > 1 ? '' : 'none';
    }

    // Keyboard: Ctrl+W close current tab
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
            e.preventDefault();
            if (activeTabId) closeTab(activeTabId);
        }
    });

    // ========================
    //  Markdown Rendering + Mermaid
    // ========================
    async function renderMarkdown(content) {
        welcomeScreen.style.display = 'none';
        markdownBody.style.display = '';

        headingCounter = 0;
        const processedContent = (typeof preprocessWikilinks === 'function') ? preprocessWikilinks(content) : content;
        markdownBody.innerHTML = marked.parse(processedContent);

        // Render Mermaid diagrams
        await renderMermaidBlocks();

        // Build TOC
        buildTOC();
    }

    async function renderMermaidBlocks() {
        const blocks = markdownBody.querySelectorAll('.mermaid-block');
        for (const block of blocks) {
            const code = block.textContent;
            const id = block.dataset.mermaidId || ('mermaid-' + Math.random().toString(36).substr(2, 8));
            try {
                const { svg } = await mermaid.render(id, code);
                block.innerHTML = svg;
                block.classList.add('mermaid-rendered');
            } catch (err) {
                block.innerHTML = `<div class="mermaid-error">Mermaid 渲染失敗: ${escapeHtml(err.message)}</div>`;
                block.classList.add('mermaid-error-block');
            }
        }
    }

    function showWelcome() {
        welcomeScreen.style.display = '';
        markdownBody.style.display = 'none';
        tocNav.innerHTML = '<div class="tree-empty"><p>尚無大綱</p></div>';
        renderWelcomeRecent();
    }

    // ========================
    //  TOC (Table of Contents) + Filter
    // ========================
    let allTocItems = [];

    function buildTOC() {
        // Clean up previous observer
        if (currentScrollSpy) {
            currentScrollSpy.disconnect();
            currentScrollSpy = null;
        }

        const headings = markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length === 0) {
            tocNav.innerHTML = '<div class="tree-empty"><p>此文件無標題</p></div>';
            allTocItems = [];
            return;
        }

        tocNav.innerHTML = '';
        allTocItems = [];
        tocSearchInput.value = '';

        headings.forEach(h => {
            const level = parseInt(h.tagName[1]);
            const item = document.createElement('a');
            item.className = `toc-item toc-h${level}`;
            item.textContent = h.textContent;
            item.href = '#' + h.id;
            item.dataset.heading = h.textContent.toLowerCase();
            item.addEventListener('click', (e) => {
                e.preventDefault();
                h.scrollIntoView({ behavior: 'smooth', block: 'start' });
                $$('.toc-item.active').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
            });
            tocNav.appendChild(item);
            allTocItems.push(item);
        });

        setupScrollSpy(headings);
    }

    function setupScrollSpy(headings) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.id;
                    $$('.toc-item.active').forEach(el => el.classList.remove('active'));
                    const tocItem = tocNav.querySelector(`a[href="#${id}"]`);
                    if (tocItem) tocItem.classList.add('active');
                }
            });
        }, {
            root: previewContainer,
            rootMargin: '-10% 0px -80% 0px',
        });

        headings.forEach(h => observer.observe(h));
        currentScrollSpy = observer;
    }

    // TOC Search/Filter
    tocSearchInput.addEventListener('input', () => {
        const query = tocSearchInput.value.toLowerCase().trim();
        allTocItems.forEach(item => {
            if (!query || item.dataset.heading.includes(query)) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    });

    // ========================
    //  Code Copy
    // ========================
    window.copyCodeBlock = function (btn) {
        const codeEl = btn.parentElement.querySelector('code');
        const text = codeEl.textContent;
        navigator.clipboard.writeText(text).then(() => {
            btn.textContent = '已複製!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = '複製';
                btn.classList.remove('copied');
            }, 2000);
        }).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            btn.textContent = '已複製!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = '複製';
                btn.classList.remove('copied');
            }, 2000);
        });
    };

    // ========================
    //  Search
    // ========================
    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        const query = searchInput.value.trim();
        if (!query) {
            searchPanel.style.display = 'none';
            return;
        }
        searchDebounce = setTimeout(() => performSearch(query), 400);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            searchPanel.style.display = 'none';
            searchInput.blur();
        }
    });

    closeSearchPanel.addEventListener('click', () => {
        searchPanel.style.display = 'none';
        searchInput.value = '';
    });

    // Ctrl+K shortcut
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    });

    async function performSearch(query) {
        if (!currentRoot) {
            searchResults.innerHTML = '<div class="search-no-results">請先開啟資料夾</div>';
            searchPanel.style.display = '';
            return;
        }

        searchResults.innerHTML = '<div class="search-no-results">搜尋中…</div>';
        searchPanel.style.display = '';

        try {
            const res = await fetch(`/api/search?root=${encodeURIComponent(currentRoot)}&q=${encodeURIComponent(query)}`);
            const data = await res.json();

            if (!data.results || data.results.length === 0) {
                searchResults.innerHTML = '<div class="search-no-results">沒有找到匹配結果</div>';
                return;
            }

            searchResults.innerHTML = '';
            const summary = document.createElement('div');
            summary.className = 'search-summary';
            const totalMatches = data.results.reduce((sum, f) => sum + f.matches.length, 0);
            summary.textContent = `找到 ${totalMatches} 個匹配，${data.results.length} 個檔案`;
            searchResults.appendChild(summary);

            data.results.forEach(file => {
                const fileEl = document.createElement('div');
                fileEl.className = 'search-result-file';
                fileEl.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    ${escapeHtml(file.name)}
                    <span class="search-match-count">${file.matches.length}</span>
                `;
                fileEl.addEventListener('click', () => {
                    openFile(file.path, file.name);
                    searchPanel.style.display = 'none';
                });
                searchResults.appendChild(fileEl);

                file.matches.forEach(match => {
                    const matchEl = document.createElement('div');
                    matchEl.className = 'search-result-match';
                    const highlighted = highlightQuery(match.text, query);
                    matchEl.innerHTML = `
                        <span class="line-num">L${match.line}</span>
                        <span class="line-text">${highlighted}</span>
                    `;
                    matchEl.addEventListener('click', () => {
                        openFile(file.path, file.name);
                        searchPanel.style.display = 'none';
                    });
                    searchResults.appendChild(matchEl);
                });
            });
        } catch (err) {
            searchResults.innerHTML = `<div class="search-no-results">搜尋失敗: ${escapeHtml(err.message)}</div>`;
        }
    }

    function highlightQuery(text, query) {
        const escaped = escapeHtml(text);
        const queryEscaped = escapeHtml(query);
        const regex = new RegExp(`(${queryEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escaped.replace(regex, '<mark>$1</mark>');
    }

    // ========================
    //  Status Bar
    // ========================
    function updateStatusBar(tab) {
        statusFile.textContent = tab.name;
        statusWordCount.textContent = tab.wordCount.toLocaleString();
        statusLineCount.textContent = tab.lineCount.toLocaleString();
        statusModTime.textContent = tab.modifiedTime;
        statusWords.style.display = '';
        statusLines.style.display = '';
        statusModified.style.display = '';
    }

    function clearStatusBar() {
        statusFile.textContent = '未開啟檔案';
        statusWords.style.display = 'none';
        statusLines.style.display = 'none';
        statusModified.style.display = 'none';
    }

    // ========================
    //  Resize Logic (with persistence)
    // ========================
    function setupResizer(resizerEl, targetEl, direction) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizerEl.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = targetEl.getBoundingClientRect().width;
            resizerEl.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            let newWidth;
            if (direction === 'left') {
                newWidth = startWidth + dx;
            } else {
                newWidth = startWidth - dx;
            }
            const min = parseInt(getComputedStyle(targetEl).minWidth) || 160;
            const max = parseInt(getComputedStyle(targetEl).maxWidth) || 500;
            newWidth = Math.max(min, Math.min(max, newWidth));
            targetEl.style.width = newWidth + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizerEl.classList.remove('active');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                saveSettings(); // Persist sidebar width
            }
        });
    }

    setupResizer(sidebarResizer, sidebar, 'left');
    setupResizer(tocResizer, tocSidebar, 'right');

    // ========================
    //  Initialization
    // ========================
    async function init() {
        initTheme();

        // Restore sidebar widths
        if (settings.sidebarWidth) {
            sidebar.style.width = settings.sidebarWidth + 'px';
        }
        if (settings.tocWidth) {
            tocSidebar.style.width = settings.tocWidth + 'px';
        }

        // Restore folder
        if (currentRoot) {
            folderPathInput.value = currentRoot;
            await loadTree(currentRoot);
        }

        // Restore tabs
        if (settings.openTabs && settings.openTabs.length > 0) {
            for (const t of settings.openTabs) {
                try {
                    const res = await fetch(`/api/file?path=${encodeURIComponent(t.path)}`);
                    const data = await res.json();
                    if (!data.error) {
                        tabs.push({
                            id: generateId(),
                            path: t.path,
                            name: t.name || data.fileName,
                            content: data.content,
                            wordCount: data.wordCount,
                            lineCount: data.lineCount,
                            modifiedTime: data.modifiedTime,
                        });
                    }
                } catch (e) { /* skip */ }
            }
            renderTabs();
            // Restore active tab
            if (settings.activeTabPath) {
                const activeTab = tabs.find(t => t.path === settings.activeTabPath);
                if (activeTab) {
                    switchTab(activeTab.id);
                } else if (tabs.length > 0) {
                    switchTab(tabs[0].id);
                }
            } else if (tabs.length > 0) {
                switchTab(tabs[0].id);
            }
        }

        // Show welcome recent files
        renderWelcomeRecent();

        // Auto-save settings periodically
        setInterval(saveSettings, 30000);
    }

    // ========================
    //  Split Layout & Editor (CodeMirror)
    // ========================
    const splitLayout = $('#splitLayout');
    const editorPane = $('#editorPane');
    const splitGutter = $('#splitGutter');
    const cmWrap = $('#cmWrap');
    const editModeBtn = $('#editModeBtn');
    const editModeIconView = $('#editModeIconView');
    const editModeIconEdit = $('#editModeIconEdit');
    const saveStatusEl = $('#saveStatus');

    let isEditMode = false;
    let cmEditor = null;       // CodeMirror instance (shared, reused per tab)
    let saveDebounce = null;
    let editorPaneWidth = 50;  // percent

    function initEditor() {
        if (cmEditor) return;
        const theme = document.documentElement.getAttribute('data-theme');
        cmEditor = CodeMirror(cmWrap, {
            mode: 'markdown',
            theme: theme === 'dark' ? 'material-darker' : 'eclipse',
            lineNumbers: true,
            lineWrapping: true,
            autofocus: false,
            tabSize: 2,
            indentWithTabs: false,
            extraKeys: {
                'Enter': 'newlineAndIndentContinueMarkdownList',
                'Ctrl-S': () => saveCurrentFile(),
                'Ctrl-B': () => insertWrap('**', '**', '粗體文字'),
                'Ctrl-I': () => insertWrap('*', '*', '斜體文字'),
            },
            placeholder: '開始輸入 Markdown…',
        });

        // 即時預覽：內容變更時重新渲染
        cmEditor.on('change', () => {
            const tab = tabs.find(t => t.id === activeTabId);
            if (!tab) return;
            const newContent = cmEditor.getValue();
            tab.content = newContent;
            tab.isDirty = true;
            setSaveStatus('unsaved');

            // Debounce preview update
            clearTimeout(saveDebounce);
            saveDebounce = setTimeout(() => {
                renderMarkdown(newContent);
            }, 300);
        });
    }

    function setEditorTheme(theme) {
        if (!cmEditor) return;
        cmEditor.setOption('theme', theme === 'dark' ? 'material-darker' : 'eclipse');
    }

    function loadEditorContent(content) {
        if (!cmEditor) return;
        cmEditor.setValue(content || '');
        cmEditor.clearHistory();
        setSaveStatus('');
    }

    function setSaveStatus(state) {
        if (!saveStatusEl) return;
        if (state === 'unsaved') {
            saveStatusEl.textContent = '● 未儲存';
            saveStatusEl.className = 'save-status unsaved';
        } else if (state === 'saving') {
            saveStatusEl.textContent = '儲存中…';
            saveStatusEl.className = 'save-status saving';
        } else if (state === 'saved') {
            saveStatusEl.textContent = '✓ 已儲存';
            saveStatusEl.className = 'save-status saved';
            setTimeout(() => setSaveStatus(''), 2500);
        } else {
            saveStatusEl.textContent = '';
            saveStatusEl.className = 'save-status';
        }
    }

    function enterEditMode() {
        if (isEditMode) return;
        initEditor();
        isEditMode = true;
        editorPane.style.display = 'flex';
        splitGutter.style.display = '';
        splitLayout.classList.add('split-active');
        editModeIconView.style.display = 'none';
        editModeIconEdit.style.display = '';
        editModeBtn.classList.add('active');

        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) {
            loadEditorContent(tab.content);
            setTimeout(() => cmEditor.refresh(), 50);
        }
    }

    function exitEditMode() {
        if (!isEditMode) return;
        isEditMode = false;
        editorPane.style.display = 'none';
        splitGutter.style.display = 'none';
        splitLayout.classList.remove('split-active');
        editModeIconView.style.display = '';
        editModeIconEdit.style.display = 'none';
        editModeBtn.classList.remove('active');
    }

    editModeBtn.addEventListener('click', () => {
        if (isEditMode) exitEditMode();
        else enterEditMode();
    });

    // Ctrl+E 切換編輯模式
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            if (activeTabId) {
                e.preventDefault();
                if (isEditMode) exitEditMode();
                else enterEditMode();
            }
        }
    });

    // 工具列按鈕
    const editorToolbarEl = $('#editorToolbar');
    if (editorToolbarEl) {
        editorToolbarEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn || !cmEditor) return;
            const action = btn.dataset.action;
            const actions = {
                bold:      () => insertWrap('**', '**', '粗體文字'),
                italic:    () => insertWrap('*', '*', '斜體文字'),
                code:      () => insertWrap('`', '`', '程式碼'),
                h1:        () => insertLinePrefix('# '),
                h2:        () => insertLinePrefix('## '),
                h3:        () => insertLinePrefix('### '),
                ul:        () => insertLinePrefix('- '),
                ol:        () => insertLinePrefix('1. '),
                quote:     () => insertLinePrefix('> '),
                link:      () => insertTemplate('[連結文字](https://)'),
                codeblock: () => insertTemplate('```\n程式碼\n```'),
            };
            if (actions[action]) actions[action]();
        });
    }

    function insertWrap(before, after, placeholder) {
        if (!cmEditor) return;
        const sel = cmEditor.getSelection();
        cmEditor.replaceSelection(before + (sel || placeholder) + after);
        cmEditor.focus();
    }

    function insertLinePrefix(prefix) {
        if (!cmEditor) return;
        const cursor = cmEditor.getCursor();
        const line = cmEditor.getLine(cursor.line);
        cmEditor.replaceRange(prefix + line, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
        cmEditor.focus();
    }

    function insertTemplate(text) {
        if (!cmEditor) return;
        cmEditor.replaceSelection(text);
        cmEditor.focus();
    }

    // Split gutter drag
    (function setupSplitGutter() {
        let isDragging = false, startX = 0, startW = 0;
        splitGutter.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startW = editorPane.getBoundingClientRect().width;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const totalW = splitLayout.getBoundingClientRect().width;
            const newW = Math.max(200, Math.min(totalW - 300, startW + dx));
            editorPane.style.width = newW + 'px';
            editorPane.style.flex = 'none';
            if (cmEditor) cmEditor.refresh();
        });
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    })();

    // ========================
    //  Save (Ctrl+S)
    // ========================
    async function saveCurrentFile() {
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        if (!isEditMode) return;

        setSaveStatus('saving');
        try {
            const res = await fetch('/api/file/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: tab.path, content: tab.content }),
            });
            const data = await res.json();
            if (data.error) {
                setSaveStatus('');
                alert('儲存失敗: ' + data.error);
                return;
            }
            tab.isDirty = false;
            tab.modifiedTime = data.modifiedTime;
            tab.wordCount = data.wordCount;
            tab.lineCount = data.lineCount;
            updateStatusBar(tab);
            setSaveStatus('saved');
        } catch (err) {
            setSaveStatus('');
            alert('儲存失敗: ' + err.message);
        }
    }

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentFile();
        }
    });

    // ========================
    //  WebSocket 即時監控
    // ========================
    const fileNotification = $('#fileNotification');
    const fileNotificationMsg = $('#fileNotificationMsg');
    const fileNotificationReload = $('#fileNotificationReload');
    const fileNotificationClose = $('#fileNotificationClose');
    const statusWsIndicator = $('#statusWsIndicator');

    let wsConn = null;
    let wsReconnectTimer = null;
    let pendingReloadPath = null;

    function connectWebSocket() {
        if (wsConn && wsConn.readyState < 2) return;
        const wsUrl = `ws://${window.location.host}/ws`;
        try {
            wsConn = new WebSocket(wsUrl);
        } catch (e) {
            return;
        }

        wsConn.onopen = () => {
            if (statusWsIndicator) {
                statusWsIndicator.style.display = '';
                statusWsIndicator.querySelector('.ws-dot').classList.add('connected');
            }
            // Ping to keep alive
            wsConn._pingInterval = setInterval(() => {
                if (wsConn.readyState === 1) wsConn.send('ping');
            }, 20000);
        };

        wsConn.onmessage = (e) => {
            if (e.data === 'pong') return;
            try {
                const msg = JSON.parse(e.data);
                handleWsEvent(msg);
            } catch (ex) { /* ignore */ }
        };

        wsConn.onclose = () => {
            if (statusWsIndicator) {
                statusWsIndicator.querySelector('.ws-dot').classList.remove('connected');
            }
            clearInterval(wsConn._pingInterval);
            wsReconnectTimer = setTimeout(connectWebSocket, 3000);
        };

        wsConn.onerror = () => {
            wsConn.close();
        };
    }

    function handleWsEvent(msg) {
        const { event, path } = msg;

        if (event === 'changed') {
            // Check if changed file is currently open
            const tab = tabs.find(t => t.path === path);
            if (tab) {
                pendingReloadPath = path;
                fileNotificationMsg.textContent = `檔案已在外部變更：${tab.name}`;
                fileNotification.style.display = '';
            }
        } else if (event === 'created' || event === 'deleted') {
            // Refresh file tree silently
            if (currentRoot) {
                fetch(`/api/tree?root=${encodeURIComponent(currentRoot)}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data.tree) {
                            fileTree.innerHTML = '';
                            renderTreeNodes(data.tree, fileTree, 0);
                        }
                    }).catch(() => {});
            }
        }
    }

    fileNotificationReload.addEventListener('click', async () => {
        fileNotification.style.display = 'none';
        if (!pendingReloadPath) return;
        const path = pendingReloadPath;
        pendingReloadPath = null;
        const tab = tabs.find(t => t.path === path);
        if (!tab) return;
        try {
            const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            if (data.error) { alert(data.error); return; }
            tab.content = data.content;
            tab.wordCount = data.wordCount;
            tab.lineCount = data.lineCount;
            tab.modifiedTime = data.modifiedTime;
            if (tab.id === activeTabId) {
                renderMarkdown(tab.content);
                updateStatusBar(tab);
                if (isEditMode && cmEditor) loadEditorContent(tab.content);
            }
        } catch (err) {
            alert('重新載入失敗: ' + err.message);
        }
    });

    fileNotificationClose.addEventListener('click', () => {
        fileNotification.style.display = 'none';
        pendingReloadPath = null;
    });

    // ========================
    //  匯出功能
    // ========================
    const exportBtn = $('#exportBtn');
    const exportPanel = $('#exportPanel');
    const exportHtmlBtn = $('#exportHtmlBtn');
    const exportDocxBtn = $('#exportDocxBtn');

    // 匯出下拉選單切換
    exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = exportPanel.style.display !== 'none';
        exportPanel.style.display = isVisible ? 'none' : '';
        if (!isVisible) {
            const rect = exportBtn.getBoundingClientRect();
            exportPanel.style.top = rect.bottom + 4 + 'px';
            exportPanel.style.right = (window.innerWidth - rect.right) + 'px';
        }
    });

    document.addEventListener('click', (e) => {
        if (!exportPanel.contains(e.target) && e.target !== exportBtn) {
            exportPanel.style.display = 'none';
        }
    });

    // 匯出 PDF（現有功能，移到下拉選單內）
    exportPdfBtn.addEventListener('click', async () => {
        exportPanel.style.display = 'none';
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) { alert('請先開啟一個檔案'); return; }

        exportPdfBtn.disabled = true;
        exportPdfBtn.style.opacity = '0.5';
        try {
            const element = markdownBody.cloneNode(true);
            element.style.display = 'block';
            element.style.padding = '20px';
            element.style.maxWidth = '800px';
            const pdfStyle = document.createElement('style');
            pdfStyle.textContent = `
                * { color: #1f2328 !important; }
                h1, h2, h3, h4, h5, h6 { color: #1f2328 !important; border-color: #d0d7de !important; }
                a { color: #0969da !important; }
                code { color: #1f2328 !important; background: #f6f8fa !important; }
                pre { background: #f6f8fa !important; border-color: #d0d7de !important; }
                pre code { color: #1f2328 !important; background: #f6f8fa !important; }
                blockquote { color: #656d76 !important; background: #f6f8fa !important; border-color: #0969da !important; }
                table, th, td { border-color: #d0d7de !important; }
                th { background: #f6f8fa !important; color: #1f2328 !important; }
                tr:nth-child(even) { background: #f6f8fa !important; }
                .code-lang-label { color: #656d76 !important; background: #e8ecf0 !important; border-color: #d0d7de !important; }
                .copy-code-btn { display: none !important; }
                .mermaid-block { background: #ffffff !important; border-color: #d0d7de !important; }
                .hljs { background: #f6f8fa !important; color: #1f2328 !important; }
                mark { background: rgba(255,213,79,0.4) !important; color: #1f2328 !important; }
                strong { color: #1f2328 !important; }
                hr { border-color: #d0d7de !important; }
                h1,h2,h3,h4,h5,h6 { page-break-after: avoid !important; }
                p, li, blockquote { page-break-inside: avoid !important; }
                pre, .code-block-wrapper { page-break-inside: avoid !important; }
                table, tr { page-break-inside: avoid !important; }
                img { page-break-inside: avoid !important; }
            `;
            element.prepend(pdfStyle);
            element.style.background = '#ffffff';
            const fileName = tab.name.replace(/\.md$/i, '') + '.pdf';
            const opt = {
                margin: [10, 15, 10, 15],
                filename: fileName,
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: { scale: 2, useCORS: true, letterRendering: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            };
            await html2pdf().set(opt).from(element).save();
        } catch (err) {
            alert('PDF 匯出失敗: ' + err.message);
        } finally {
            exportPdfBtn.disabled = false;
            exportPdfBtn.style.opacity = '';
        }
    });

    // 匯出 HTML
    exportHtmlBtn.addEventListener('click', async () => {
        exportPanel.style.display = 'none';
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) { alert('請先開啟一個檔案'); return; }

        try {
            const theme = document.documentElement.getAttribute('data-theme') || 'dark';
            const renderedHtml = markdownBody.innerHTML;
            const cssHref = document.querySelector('link[href*="style.css"]')?.href || '';

            // 內嵌 CSS 變數以確保獨立可用
            const htmlContent = `<!DOCTYPE html>
<html lang="zh-Hant" data-theme="${theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(tab.name.replace(/\.md$/i, ''))}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/${theme === 'dark' ? 'github-dark' : 'github'}.min.css">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
${getInlineCSS()}
</style>
</head>
<body style="margin:0;padding:24px 48px;max-width:900px;margin:0 auto;">
<article class="markdown-body">
${renderedHtml}
</article>
</body>
</html>`;

            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = tab.name.replace(/\.md$/i, '') + '.html';
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            alert('HTML 匯出失敗: ' + err.message);
        }
    });

    function getInlineCSS() {
        // 基本 Markdown Body CSS 供獨立 HTML 使用
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        const isDark = theme === 'dark';
        return `
:root { --bg: ${isDark ? '#0d1117' : '#ffffff'}; --text: ${isDark ? '#e6edf3' : '#1f2328'};
  --heading: ${isDark ? '#f0f6fc' : '#1f2328'}; --link: ${isDark ? '#58a6ff' : '#0969da'};
  --code-bg: ${isDark ? '#1a1f2b' : '#f6f8fa'}; --border: ${isDark ? '#30363d' : '#d0d7de'};
  --blockquote-bg: ${isDark ? '#1c2128' : '#f6f8fa'}; --blockquote-border: ${isDark ? '#3d444d' : '#d0d7de'};
  --table-stripe: ${isDark ? '#161b22' : '#f6f8fa'};
}
body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; }
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6 {
  color: var(--heading); margin-top: 1.5em; margin-bottom: .5em; font-weight: 600; }
.markdown-body h1 { font-size: 2em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
.markdown-body h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: .3em; }
.markdown-body a { color: var(--link); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body code { font-family: 'JetBrains Mono', monospace; background: var(--code-bg);
  padding: .2em .4em; border-radius: 4px; font-size: .9em; }
.markdown-body pre { background: var(--code-bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 16px; overflow-x: auto; }
.markdown-body pre code { background: none; padding: 0; }
.markdown-body blockquote { border-left: 4px solid var(--blockquote-border);
  background: var(--blockquote-bg); margin: 0; padding: .5em 1em; border-radius: 0 6px 6px 0; }
.markdown-body table { border-collapse: collapse; width: 100%; }
.markdown-body th, .markdown-body td { border: 1px solid var(--border); padding: 8px 12px; }
.markdown-body tr:nth-child(even) { background: var(--table-stripe); }
.markdown-body img { max-width: 100%; }
.markdown-body hr { border: none; border-top: 1px solid var(--border); }
.copy-code-btn, .code-lang-label { display: none; }
`;
    }

    // 匯出 DOCX
    exportDocxBtn.addEventListener('click', async () => {
        exportPanel.style.display = 'none';
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) { alert('請先開啟一個檔案'); return; }

        exportDocxBtn.disabled = true;
        try {
            const url = `/api/export/docx?path=${encodeURIComponent(tab.path)}`;
            const res = await fetch(url);
            if (!res.ok) {
                const err = await res.json();
                alert('DOCX 匯出失敗: ' + (err.error || res.statusText));
                return;
            }
            const blob = await res.blob();
            const dlUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = dlUrl;
            a.download = tab.name.replace(/\.md$/i, '') + '.docx';
            a.click();
            URL.revokeObjectURL(dlUrl);
        } catch (err) {
            alert('DOCX 匯出失敗: ' + err.message);
        } finally {
            exportDocxBtn.disabled = false;
        }
    });

    // ========================
    //  搜尋索引
    // ========================
    const rebuildIndexBtn = $('#rebuildIndexBtn');
    const indexStatus = $('#indexStatus');

    rebuildIndexBtn.addEventListener('click', async () => {
        if (!currentRoot) { alert('請先開啟資料夾'); return; }
        rebuildIndexBtn.disabled = true;
        rebuildIndexBtn.textContent = '建立中…';
        indexStatus.style.display = '';
        indexStatus.textContent = '正在建立全文索引，請稍候…';
        indexStatus.className = 'index-status building';
        try {
            const res = await fetch('/api/index/rebuild', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ root: currentRoot }),
            });
            const data = await res.json();
            if (data.error) {
                indexStatus.textContent = '索引建立失敗: ' + data.error;
                indexStatus.className = 'index-status error';
            } else {
                indexStatus.textContent = `⚡ 索引建立完成：共 ${data.count} 個檔案，下次搜尋將使用快速索引`;
                indexStatus.className = 'index-status success';
            }
        } catch (err) {
            indexStatus.textContent = '索引建立失敗: ' + err.message;
            indexStatus.className = 'index-status error';
        } finally {
            rebuildIndexBtn.disabled = false;
            rebuildIndexBtn.textContent = '⚡ 建立索引';
        }
    });

    // ========================
    //  Edit mode button 可見性 (由各操作點呼叫)
    // ========================
    function updateEditModeBtn() {
        const hasTab = tabs.length > 0 && activeTabId;
        editModeBtn.style.display = hasTab ? '' : 'none';
        if (!hasTab && isEditMode) exitEditMode();
    }

    init();

    // Post-init: connect WebSocket
    connectWebSocket();

    // ========================
    //  Flat file list (for Command Palette & wiki-link resolve)
    // ========================
    let allFiles = [];
    function refreshAllFiles() {
        const folder = (typeof currentRoot !== 'undefined' && currentRoot) || '';
        if (!folder) return;
        fetch('/api/tree?root=' + encodeURIComponent(folder))
            .then(r => r.json())
            .then(data => {
                allFiles = [];
                function walk(nodes) {
                    nodes.forEach(n => {
                        if (n.type === 'file') allFiles.push({ name: n.name, path: n.path });
                        if (n.children) walk(n.children);
                    });
                }
                if (data.tree) walk(data.tree);
            })
            .catch(() => {});
    }

    // ========================
    //  Wiki-link preprocessing  [[name]] → <a class="wiki-link">
    // ========================
    function preprocessWikilinks(md) {
        return md.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
            const slug = name.trim();
            const found = allFiles.find(f => f.name === slug + '.md' || f.name === slug);
            if (found) {
                return `[${slug}](wikilink:${encodeURIComponent(found.path)})`;
            }
            return `[${slug}](wikilink-unresolved:${encodeURIComponent(slug)})`;
        });
    }

    // Override marked renderer for wiki-links
    const _markedRenderer = new marked.Renderer();
    const _origLinkRenderer = _markedRenderer.link.bind(_markedRenderer);
    _markedRenderer.link = function(href, title, text) {
        if (href && href.startsWith('wikilink-unresolved:')) {
            const name = decodeURIComponent(href.replace('wikilink-unresolved:', ''));
            return `<a class="wiki-link unresolved" title="找不到: ${name}">${text}</a>`;
        }
        if (href && href.startsWith('wikilink:')) {
            const path = decodeURIComponent(href.replace('wikilink:', ''));
            return `<a class="wiki-link" href="#" data-wiki-path="${path}" onclick="event.preventDefault();window._wikiNav('${path}')">${text}</a>`;
        }
        return _origLinkRenderer(href, title, text);
    };
    marked.setOptions({ renderer: _markedRenderer });
    window._wikiNav = function(path) { fetchFile(path); };

    // ========================
    //  Frontmatter bar
    // ========================
    function renderFrontmatterBar(fm) {
        let bar = document.getElementById('frontmatterBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'frontmatterBar';
            bar.className = 'frontmatter-bar';
            const previewContainer = document.getElementById('previewContainer');
            if (previewContainer) previewContainer.insertBefore(bar, previewContainer.firstChild);
        }
        if (!fm || Object.keys(fm).length === 0) {
            // Still show AI button even without frontmatter
            const tabEmpty = tabs.find(t => t.id === activeTabId);
            if (tabEmpty) {
                bar.style.display = '';
                bar.innerHTML = `<button class="fm-ai-btn" onclick="openAiModal('${tabEmpty.path.replace(/'/g, "\\'")}')">✨ AI 分析</button>`;
            } else {
                bar.innerHTML = '';
                bar.style.display = 'none';
            }
            return;
        }
        bar.style.display = '';
        const tags = fm.tags || [];
        const title = fm.title ? `<span class="fm-title">${fm.title}</span>` : '';
        const tagsHtml = tags.map(t => `<span class="fm-tag" onclick="showTagFilesFromBar('${t}')">#${t}</span>`).join('');
        const extra = Object.entries(fm).filter(([k]) => !['title','tags'].includes(k))
            .map(([k,v]) => `<span class="fm-meta"><b>${k}:</b> ${v}</span>`).join('');
        const tab = tabs.find(t => t.id === activeTabId);
        const aiBtn = tab ? `<button class="fm-ai-btn" onclick="openAiModal('${tab.path.replace(/'/g, "\\'")}')">✨ AI 分析</button>` : '';
        bar.innerHTML = title + tagsHtml + extra + aiBtn;
    }
    window.showTagFilesFromBar = function(tag) {
        const leftTab = document.querySelector('.sidebar-tab[data-view="tags"]');
        if (leftTab) leftTab.click();
        setTimeout(() => showTagFiles(tag), 100);
    };

    // Override fetchFile to handle frontmatter
    const _origFetchFile = fetchFile;
    window.fetchFile = fetchFile;  // already global via IIFE scope? patch via event

    // ========================
    //  Backlinks
    // ========================
    function fetchBacklinks(path) {
        const panel = document.getElementById('backlinksList');
        const section = document.getElementById('backlinksSection');
        if (!panel || !section) return;
        fetch('/api/wikilinks?target=' + encodeURIComponent(path))
            .then(r => r.json())
            .then(data => {
                const links = data.links || [];
                const countEl = document.getElementById('backlinksCount');
                if (countEl) countEl.textContent = links.length;
                section.style.display = links.length > 0 ? '' : 'none';
                if (links.length === 0) { panel.innerHTML = ''; return; }
                panel.innerHTML = links.map(l =>
                    `<div class="backlinks-item" onclick="fetchFile('${l.path}')" title="${l.path}">
                        <span class="backlinks-name">${l.name}</span>
                    </div>`
                ).join('');
            })
            .catch(() => { if (panel) panel.innerHTML = ''; });
    }

    // ========================
    //  TOC sidebar tab switching
    // ========================
    document.querySelectorAll('.toc-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.toc-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            const outlinePanel = document.getElementById('tocOutlinePanel');
            const bookmarksPanel = document.getElementById('tocBookmarksPanel');
            if (outlinePanel) outlinePanel.style.display = view === 'outline' ? '' : 'none';
            if (bookmarksPanel) bookmarksPanel.style.display = view === 'bookmarks' ? '' : 'none';
        });
    });

    // ========================
    //  Bookmarks
    // ========================
    function fetchBookmarks(path) {
        const list = document.getElementById('bookmarksList');
        if (!list) return;
        fetch('/api/bookmarks?path=' + encodeURIComponent(path))
            .then(r => r.json())
            .then(data => {
                const bms = data.bookmarks || [];
                renderBookmarksSidebar(bms);
                applyBookmarkHighlights(bms);
            })
            .catch(() => {});
    }

    function renderBookmarksSidebar(bms) {
        const list = document.getElementById('bookmarksList');
        if (!list) return;
        if (bms.length === 0) { list.innerHTML = '<div class="no-bookmarks">尚無書籤</div>'; return; }
        list.innerHTML = bms.map(b =>
            `<div class="bookmark-item" style="border-left:3px solid ${b.color || 'gold'}" data-id="${b.id}">
                <div class="bookmark-text" onclick="scrollToBookmark(${b.para_idx})">${b.text.substring(0,60)}${b.text.length>60?'…':''}</div>
                ${b.note ? `<div class="bookmark-note">${b.note}</div>` : ''}
                <button class="bookmark-del" onclick="deleteBookmark(${b.id})">✕</button>
            </div>`
        ).join('');
    }

    function applyBookmarkHighlights(bms) {
        document.querySelectorAll('.bookmarkable').forEach(el => el.classList.remove('bookmark-highlighted'));
        bms.forEach(b => {
            const el = document.querySelector(`.bookmarkable[data-para="${b.para_idx}"]`);
            if (el) el.classList.add('bookmark-highlighted');
        });
    }

    function setupBookmarkGutters() {
        const preview = document.getElementById('markdownBody');
        if (!preview) return;
        const paras = preview.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');
        paras.forEach((el, i) => {
            el.classList.add('bookmarkable');
            el.dataset.para = i;
            el.addEventListener('mouseenter', function() {
                if (!this.querySelector('.bookmark-gutter')) {
                    const btn = document.createElement('span');
                    btn.className = 'bookmark-gutter';
                    btn.title = '新增書籤';
                    btn.textContent = '🔖';
                    btn.onclick = (e) => { e.stopPropagation(); toggleBookmark(i, this.textContent.trim()); };
                    this.prepend(btn);
                }
            });
            el.addEventListener('mouseleave', function() {
                const btn = this.querySelector('.bookmark-gutter');
                if (btn) btn.remove();
            });
        });
    }

    window.scrollToBookmark = function(paraIdx) {
        const el = document.querySelector(`.bookmarkable[data-para="${paraIdx}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    window.deleteBookmark = function(id) {
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        fetch('/api/bookmarks/' + id, { method: 'DELETE' })
            .then(() => fetchBookmarks(tab.path));
    };

    function toggleBookmark(paraIdx, text) {
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab) return;
        fetch('/api/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: tab.path, para_idx: paraIdx, text: text.substring(0, 200), color: 'gold' })
        }).then(() => fetchBookmarks(tab.path));
    }

    // Hook into tab activation to load backlinks & bookmarks
    const _origActivateTabFn = window._activateTab;
    document.addEventListener('tab-activated', function(e) {
        const path = e.detail && e.detail.path;
        if (path) {
            fetchBacklinks(path);
            fetchBookmarks(path);
            refreshAllFiles();
        }
    });

    // ========================
    //  Left sidebar tab switching (Files / Tags)
    // ========================
    document.querySelectorAll('.sidebar-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sidebar-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const view = btn.dataset.view;
            const filesView = document.getElementById('fileTree');
            const tagsView = document.getElementById('tagsView');
            if (filesView) filesView.style.display = view === 'files' ? '' : 'none';
            if (tagsView) tagsView.style.display = view === 'tags' ? '' : 'none';
            if (view === 'tags') loadTagsView();
        });
    });

    function loadTagsView() {
        const tagsList = document.getElementById('tagsList');
        if (!tagsList) return;
        fetch('/api/tags')
            .then(r => r.json())
            .then(data => {
                const tags = data.tags || [];
                const hint = document.getElementById('tagsHint');
                if (tags.length === 0) {
                    if (hint) hint.style.display = '';
                    tagsList.style.display = 'none';
                    return;
                }
                if (hint) hint.style.display = 'none';
                tagsList.style.display = '';
                tagsList.innerHTML = tags.map(t =>
                    `<span class="tag-chip" onclick="showTagFiles('${t.tag}')">#${t.tag} <sup>${t.count}</sup></span>`
                ).join('');
            })
            .catch(() => { if (tagsList) tagsList.innerHTML = '載入失敗'; });
    }

    window.showTagFiles = function(tag) {
        const header = document.getElementById('tagFilesTitle');
        const list = document.getElementById('tagFilesList');
        if (!list) return;
        if (header) header.textContent = '#' + tag;
        fetch('/api/tags/files?tag=' + encodeURIComponent(tag))
            .then(r => r.json())
            .then(data => {
                const files = data.files || [];
                list.innerHTML = files.map(f =>
                    `<div class="tag-file-item" onclick="fetchFile('${f.path}')" title="${f.path}">${f.name}</div>`
                ).join('');
                const tagFiles = document.getElementById('tagFiles');
                if (tagFiles) tagFiles.style.display = '';
            })
            .catch(() => {});
    };

    // ========================
    //  Command Palette  (Ctrl+Shift+P)
    // ========================
    const COMMANDS = [
        { label: '新增標籤頁', icon: '＋', action: () => document.getElementById('newTabBtn') && document.getElementById('newTabBtn').click() },
        { label: '關閉目前標籤頁', icon: '✕', action: () => { if (activeTabId) closeTab(activeTabId); } },
        { label: '切換編輯模式', icon: '✏️', action: () => document.getElementById('editModeBtn') && document.getElementById('editModeBtn').click() },
        { label: '建立/重建索引', icon: '⚡', action: () => document.getElementById('rebuildIndexBtn') && document.getElementById('rebuildIndexBtn').click() },
        { label: '匯出 PDF', icon: '📄', action: () => { const tab = tabs.find(t=>t.id===activeTabId); if(tab) window.open('/api/export/pdf?path='+encodeURIComponent(tab.path)); } },
        { label: '匯出 HTML', icon: '🌐', action: () => { const tab = tabs.find(t=>t.id===activeTabId); if(tab) window.open('/api/export/html?path='+encodeURIComponent(tab.path)); } },
        { label: '匯出 DOCX', icon: '📝', action: () => { const tab = tabs.find(t=>t.id===activeTabId); if(tab) window.open('/api/export/docx?path='+encodeURIComponent(tab.path)); } },
        { label: '顯示標籤', icon: '🏷️', action: () => document.querySelector('.sidebar-tab[data-view="tags"]') && document.querySelector('.sidebar-tab[data-view="tags"]').click() },
        { label: '顯示書籤', icon: '🔖', action: () => document.querySelector('.toc-tab[data-view="bookmarks"]') && document.querySelector('.toc-tab[data-view="bookmarks"]').click() },
    ];

    let paletteSelectedIdx = 0;
    let paletteFiltered = [];

    function openPalette() {
        const overlay = document.getElementById('commandPalette');
        const input = document.getElementById('paletteInput');
        if (!overlay || !input) return;
        overlay.style.display = 'flex';
        input.value = '';
        renderPalette('');
        input.focus();
    }

    function closePalette() {
        const overlay = document.getElementById('commandPalette');
        if (overlay) overlay.style.display = 'none';
    }

    function fuzzyMatch(query, str) {
        query = query.toLowerCase();
        str = str.toLowerCase();
        let qi = 0;
        const positions = [];
        for (let i = 0; i < str.length && qi < query.length; i++) {
            if (str[i] === query[qi]) { positions.push(i); qi++; }
        }
        return qi === query.length ? positions : null;
    }

    function highlightFuzzy(str, positions) {
        if (!positions || positions.length === 0) return str;
        let result = '';
        for (let i = 0; i < str.length; i++) {
            if (positions.includes(i)) result += `<mark>${str[i]}</mark>`;
            else result += str[i];
        }
        return result;
    }

    function renderPalette(query) {
        const resultsEl = document.getElementById('paletteResults');
        if (!resultsEl) return;
        let items = [];
        if (query.trim() === '') {
            items = COMMANDS.map(c => ({ ...c, positions: null }));
            allFiles.slice(0, 20).forEach(f => items.push({
                label: f.name, icon: '📄', action: () => fetchFile(f.path), positions: null
            }));
        } else {
            COMMANDS.forEach(c => {
                const pos = fuzzyMatch(query, c.label);
                if (pos) items.push({ ...c, positions: pos });
            });
            allFiles.forEach(f => {
                const pos = fuzzyMatch(query, f.name);
                if (pos) items.push({ label: f.name, icon: '📄', action: () => fetchFile(f.path), positions: pos });
            });
        }
        paletteFiltered = items;
        paletteSelectedIdx = 0;
        resultsEl.innerHTML = items.slice(0, 30).map((item, i) =>
            `<div class="palette-item ${i === 0 ? 'selected' : ''}" data-idx="${i}">
                <span class="palette-icon">${item.icon || '▸'}</span>
                <span class="palette-label">${highlightFuzzy(item.label, item.positions)}</span>
            </div>`
        ).join('');
        resultsEl.querySelectorAll('.palette-item').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const idx = parseInt(el.dataset.idx);
                if (paletteFiltered[idx]) { paletteFiltered[idx].action(); closePalette(); }
            });
            el.addEventListener('mouseover', () => {
                resultsEl.querySelectorAll('.palette-item').forEach(x => x.classList.remove('selected'));
                el.classList.add('selected');
                paletteSelectedIdx = parseInt(el.dataset.idx);
            });
        });
    }

    const paletteOverlay = document.getElementById('commandPalette');
    const paletteInput = document.getElementById('paletteInput');
    if (paletteOverlay) {
        paletteOverlay.addEventListener('click', (e) => { if (e.target === paletteOverlay) closePalette(); });
    }
    if (paletteInput) {
        paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
        paletteInput.addEventListener('keydown', (e) => {
            const resultsEl = document.getElementById('paletteResults');
            const items = resultsEl ? resultsEl.querySelectorAll('.palette-item') : [];
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                paletteSelectedIdx = Math.min(paletteSelectedIdx + 1, paletteFiltered.length - 1);
                items.forEach((el, i) => el.classList.toggle('selected', i === paletteSelectedIdx));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                paletteSelectedIdx = Math.max(paletteSelectedIdx - 1, 0);
                items.forEach((el, i) => el.classList.toggle('selected', i === paletteSelectedIdx));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (paletteFiltered[paletteSelectedIdx]) { paletteFiltered[paletteSelectedIdx].action(); closePalette(); }
            } else if (e.key === 'Escape') {
                closePalette();
            }
        });
    }

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
            e.preventDefault();
            openPalette();
        }
    });

    // ========================
    //  Patch fetchFile to setup gutters & frontmatter after render
    // ========================
    const _origFetchFileLocal = fetchFile;
    const _patchedFetchFile = function(path) {
        return Promise.resolve(_origFetchFileLocal(path)).then(() => {
            // fetchFile is async; hook via MutationObserver on preview
        });
    };

    const _previewEl = document.getElementById('markdownBody');
    if (_previewEl) {
        const _obs = new MutationObserver(() => {
            setupBookmarkGutters();
            const tab = tabs.find(t => t.id === activeTabId);
            if (tab) {
                fetchBacklinks(tab.path);
                fetchBookmarks(tab.path);
            }
        });
        _obs.observe(_previewEl, { childList: true, subtree: false });
    }

    // Initial file list refresh
    setTimeout(refreshAllFiles, 500);

    // ========================
    //  Fix: tagsRebuildBtn → delegate to rebuildIndexBtn
    // ========================
    const tagsRebuildBtn = document.getElementById('tagsRebuildBtn');
    if (tagsRebuildBtn) {
        tagsRebuildBtn.addEventListener('click', () => {
            const rebuildBtn = document.getElementById('rebuildIndexBtn');
            if (rebuildBtn) {
                rebuildBtn.click();
                // After rebuild, reload tags view
                rebuildBtn.addEventListener('click', () => {
                    setTimeout(loadTagsView, 2000);
                }, { once: true });
            }
        });
    }

    // Also reload tags view after main rebuild completes
    const _mainRebuildBtn = document.getElementById('rebuildIndexBtn');
    if (_mainRebuildBtn) {
        _mainRebuildBtn.addEventListener('click', () => {
            setTimeout(() => {
                const tagsView = document.getElementById('tagsView');
                if (tagsView && tagsView.style.display !== 'none') loadTagsView();
            }, 3000);
        });
    }

    // ========================
    //  AI 文件分析
    // ========================
    let aiCurrentTags = [];

    function openAiModal(path) {
        const modal = document.getElementById('aiAnalyzeModal');
        if (!modal) return;
        modal.style.display = 'flex';
        modal.dataset.path = path;
        showAiState('loading');

        fetch('/api/ai/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) { showAiState('error', data.error); return; }
            document.getElementById('aiSummaryInput').value = data.summary || '';
            aiCurrentTags = Array.isArray(data.tags) ? [...data.tags] : [];
            renderAiTags();
            showAiState('result');
        })
        .catch(err => showAiState('error', err.message));
    }

    function showAiState(state, msg) {
        document.getElementById('aiLoadingState').style.display = state === 'loading' ? '' : 'none';
        document.getElementById('aiErrorState').style.display = state === 'error' ? '' : 'none';
        document.getElementById('aiResultState').style.display = state === 'result' ? '' : 'none';
        document.getElementById('aiModalFooter').style.display = state === 'result' ? '' : 'none';
        if (state === 'error') {
            document.getElementById('aiErrorMsg').textContent = msg || '發生錯誤';
        }
    }

    function renderAiTags() {
        const editor = document.getElementById('aiTagsEditor');
        if (!editor) return;
        editor.innerHTML = aiCurrentTags.map((t, i) =>
            `<span class="ai-tag-chip">#${t}<button onclick="removeAiTag(${i})" title="移除">✕</button></span>`
        ).join('');
    }

    window.removeAiTag = function(i) {
        aiCurrentTags.splice(i, 1);
        renderAiTags();
    };

    const aiTagInput = document.getElementById('aiTagInput');
    if (aiTagInput) {
        aiTagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const val = aiTagInput.value.trim().replace(/^#/, '').replace(/,/g, '');
                if (val && !aiCurrentTags.includes(val)) {
                    aiCurrentTags.push(val);
                    renderAiTags();
                }
                aiTagInput.value = '';
            }
        });
    }

    document.getElementById('closeAiModal')?.addEventListener('click', () => {
        document.getElementById('aiAnalyzeModal').style.display = 'none';
    });
    document.getElementById('aiCancelBtn')?.addEventListener('click', () => {
        document.getElementById('aiAnalyzeModal').style.display = 'none';
    });
    document.getElementById('aiAnalyzeModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('aiAnalyzeModal'))
            document.getElementById('aiAnalyzeModal').style.display = 'none';
    });

    document.getElementById('aiSaveBtn')?.addEventListener('click', () => {
        const modal = document.getElementById('aiAnalyzeModal');
        const path = modal.dataset.path;
        const summary = document.getElementById('aiSummaryInput').value.trim();
        const tags = aiCurrentTags;

        fetch('/api/frontmatter/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, summary, tags })
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) { alert('儲存失敗: ' + data.error); return; }
            modal.style.display = 'none';
            // Reload the current file to show updated frontmatter
            const tab = tabs.find(t => t.id === activeTabId);
            if (tab && tab.path === path) {
                // Re-fetch the file
                fetch('/api/file?path=' + encodeURIComponent(path))
                    .then(r => r.json())
                    .then(d => {
                        tab.content = d.content;
                        tab.frontmatter = d.frontmatter || {};
                        renderMarkdown(tab.content);
                        renderFrontmatterBar(tab.frontmatter);
                    });
            }
            // Reload tags view if visible
            const tagsViewEl = document.getElementById('tagsView');
            if (tagsViewEl && tagsViewEl.style.display !== 'none') loadTagsView();
        })
        .catch(err => alert('儲存失敗: ' + err.message));
    });

    // Expose openAiModal globally (called from frontmatter bar button)
    window.openAiModal = openAiModal;

})();
