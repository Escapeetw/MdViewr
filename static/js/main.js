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

        $$('.tree-item.active').forEach(el => el.classList.remove('active'));
        const treeItem = $(`.tree-item[data-path="${CSS.escape(tab.path)}"]`);
        if (treeItem) treeItem.classList.add('active');

        renderTabs();
        saveSettings();
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
    }

    function closeAllTabs() {
        tabs = [];
        activeTabId = null;
        showWelcome();
        clearStatusBar();
        renderTabs();
        saveSettings();
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
        markdownBody.innerHTML = marked.parse(content);

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

    init();

})();
