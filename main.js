/*
 * Block Drag & Drop Plugin for Obsidian
 * Enables Notion-style drag and drop for text blocks within notes
 */

const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    showHandleOnHover: true
};

class BlockDndPlugin extends obsidian.Plugin {
    settings = DEFAULT_SETTINGS;
    dragState = null;
    activeView = null;
    handlesContainer = null;
    dropIndicator = null;
    lineObserver = null;
    debounceTimeout = null;
    isMobile = false;
    longPressTimeout = null;
    blocks = [];
    handleWrappers = new Map();
    hideTimeouts = new Map();
    isHovering = false;
    
    // Mobile-specific
    selectedBlockIndex = null;
    mobileGlobalTapHandler = null;
    
    // Store references for cleanup
    blockEventCleanups = [];

    async onload() {
        await this.loadSettings();
        
        this.isMobile = obsidian.Platform.isMobile;
        
        this.addSettingTab(new BlockDndSettingTab(this.app, this));
        this.addStyles();
        
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.cleanup();
                setTimeout(() => this.setup(), 100);
            })
        );
        
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.resetDragState();
                setTimeout(() => this.setup(), 100);
            })
        );
        
        this.app.workspace.onLayoutReady(() => {
            setTimeout(() => this.setup(), 300);
        });
    }

    onunload() {
        this.cleanup();
        this.removeStyles();
    }

    async loadSettings() {
        const data = await this.loadData();
        this.settings = { ...DEFAULT_SETTINGS, ...data };
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    addStyles() {
        const styleEl = document.createElement('style');
        styleEl.id = 'block-dnd-styles';
        
        const handleSize = this.isMobile ? 28 : 20;
        const wrapperSize = this.isMobile ? 32 : 28;
        const iconSize = this.isMobile ? 16 : 14;
        
        styleEl.textContent = `
            .block-dnd-handles-container {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                pointer-events: none;
                z-index: 1000;
            }
            
            .block-dnd-handle-wrapper {
                position: absolute;
                width: ${wrapperSize}px;
                height: ${wrapperSize}px;
                display: flex;
                align-items: center;
                justify-content: center;
                pointer-events: auto;
                opacity: 0;
                transition: opacity 0.15s ease, transform 0.15s ease;
                -webkit-tap-highlight-color: transparent;
                transform: scale(0.8);
                z-index: 1001;
            }
            
            .block-dnd-handle-wrapper.visible {
                opacity: 1;
                transform: scale(1);
            }
            
            .block-dnd-handle {
                width: ${handleSize}px;
                height: ${handleSize}px;
                border-radius: 6px;
                cursor: grab;
                display: flex;
                align-items: center;
                justify-content: center;
                background: var(--background-secondary);
                border: 1px solid var(--background-modifier-border);
                transition: all 0.15s ease;
                touch-action: manipulation;
                -webkit-user-select: none;
                user-select: none;
                -webkit-touch-callout: none;
            }
            
            .block-dnd-handle:hover {
                background: var(--background-modifier-hover);
            }
            
            .block-dnd-handle:active,
            .block-dnd-handle.active {
                cursor: grabbing;
                background: var(--interactive-accent);
                border-color: var(--interactive-accent);
                transform: scale(1.1);
            }
            
            .block-dnd-handle:active svg,
            .block-dnd-handle.active svg {
                color: var(--text-on-accent);
            }
            
            .block-dnd-handle svg {
                width: ${iconSize}px;
                height: ${iconSize}px;
                color: var(--text-muted);
                pointer-events: none;
            }
            
            .block-dnd-drop-indicator {
                position: fixed;
                height: 3px;
                background: var(--interactive-accent);
                border-radius: 2px;
                pointer-events: none;
                z-index: 10000;
                display: none;
                box-shadow: 0 0 8px var(--interactive-accent);
            }
            
            .block-dnd-drop-indicator.visible {
                display: block;
            }
            
            .block-dnd-dragging {
                opacity: 0.3 !important;
                background: var(--background-modifier-active-hover) !important;
            }
            
            .block-dnd-editor-wrapper {
                position: relative;
            }
            
            .block-dnd-dragging-active {
                -webkit-user-select: none;
                user-select: none;
            }
            
            /* Mobile: selected block highlight */
            .block-dnd-selected {
                background: var(--background-modifier-hover) !important;
                border-radius: 4px;
            }
            
            ${this.isMobile ? `
                .block-dnd-handle {
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                }
            ` : ''}
        `;
        document.head.appendChild(styleEl);
    }

    removeStyles() {
        const styleEl = document.getElementById('block-dnd-styles');
        if (styleEl) styleEl.remove();
    }
    
    resetDragState() {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
            this.longPressTimeout = null;
        }
        
        this.dragState = null;
        
        if (this.dropIndicator) {
            this.dropIndicator.classList.remove('visible');
        }
        
        document.querySelectorAll('.block-dnd-dragging').forEach(el => {
            el.classList.remove('block-dnd-dragging');
        });
        document.querySelectorAll('.block-dnd-handle.active').forEach(el => {
            el.classList.remove('active');
        });
        document.body.classList.remove('block-dnd-dragging-active');
        
        document.removeEventListener('mousemove', this.onDrag);
        document.removeEventListener('mouseup', this.endDrag);
        document.removeEventListener('touchmove', this.globalTouchMove);
        document.removeEventListener('touchend', this.globalTouchEnd);
        document.removeEventListener('touchcancel', this.globalTouchEnd);
    }

    setup() {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (!view) return;
        
        this.activeView = view;
        
        const cmEditor = view.contentEl.querySelector('.cm-editor');
        const cmScroller = view.contentEl.querySelector('.cm-scroller');
        const cmContent = view.contentEl.querySelector('.cm-content');
        
        if (!cmEditor || !cmScroller || !cmContent) return;
        
        this.cmContent = cmContent;
        this.cmScroller = cmScroller;
        
        cmEditor.classList.add('block-dnd-editor-wrapper');
        
        this.handlesContainer = document.createElement('div');
        this.handlesContainer.className = 'block-dnd-handles-container';
        cmScroller.insertBefore(this.handlesContainer, cmScroller.firstChild);
        
        this.dropIndicator = document.createElement('div');
        this.dropIndicator.className = 'block-dnd-drop-indicator';
        document.body.appendChild(this.dropIndicator);
        
        this.setupObservers(cmContent, cmScroller);
        this.renderHandles();
        
        if (this.isMobile) {
            this.setupMobileTapToSelect();
            this.setupGlobalTouchListeners();
        }
    }
    
    // Get current text selection as line range
    getSelectionLineRange() {
        const editor = this.activeView?.editor;
        if (!editor) return null;
        
        const from = editor.getCursor('from');
        const to = editor.getCursor('to');
        
        // No selection (just cursor)
        if (from.line === to.line && from.ch === to.ch) {
            return null;
        }
        
        return {
            fromLine: Math.min(from.line, to.line),
            toLine: Math.max(from.line, to.line)
        };
    }
    
    setupGlobalTouchListeners() {
        this.globalTouchMove = (e) => {
            if (this.dragState) {
                e.preventDefault();
                const touch = e.touches[0];
                if (touch) {
                    this.updateIndicator(touch.clientY);
                }
            }
        };
        
        this.globalTouchEnd = (e) => {
            if (this.longPressTimeout) {
                clearTimeout(this.longPressTimeout);
                this.longPressTimeout = null;
            }
            
            document.querySelectorAll('.block-dnd-handle.active').forEach(h => h.classList.remove('active'));
            
            if (this.dragState) {
                this.endDrag();
            }
        };
        
        document.addEventListener('touchmove', this.globalTouchMove, { passive: false });
        document.addEventListener('touchend', this.globalTouchEnd, { passive: true });
        document.addEventListener('touchcancel', this.globalTouchEnd, { passive: true });
    }

    cleanup() {
        this.resetDragState();
        
        if (this.lineObserver) {
            this.lineObserver.disconnect();
            this.lineObserver = null;
        }
        
        this.hideTimeouts.forEach(timeout => clearTimeout(timeout));
        this.hideTimeouts.clear();
        this.handleWrappers.clear();
        
        this.cleanupBlockEvents();
        this.cleanupMobileTapHandler();
        
        if (this.globalTouchMove) {
            document.removeEventListener('touchmove', this.globalTouchMove);
            this.globalTouchMove = null;
        }
        if (this.globalTouchEnd) {
            document.removeEventListener('touchend', this.globalTouchEnd);
            document.removeEventListener('touchcancel', this.globalTouchEnd);
            this.globalTouchEnd = null;
        }
        
        if (this.handlesContainer) {
            this.handlesContainer.remove();
            this.handlesContainer = null;
        }
        
        if (this.dropIndicator) {
            this.dropIndicator.remove();
            this.dropIndicator = null;
        }
        
        document.querySelectorAll('.block-dnd-editor-wrapper').forEach(el => {
            el.classList.remove('block-dnd-editor-wrapper');
        });
        
        document.querySelectorAll('.block-dnd-selected').forEach(el => {
            el.classList.remove('block-dnd-selected');
        });
        
        this.blocks = [];
        this.isHovering = false;
        this.selectedBlockIndex = null;
    }
    
    cleanupBlockEvents() {
        this.blockEventCleanups.forEach(cleanup => cleanup());
        this.blockEventCleanups = [];
    }
    
    cleanupMobileTapHandler() {
        if (this.mobileGlobalTapHandler && this.cmScroller) {
            this.cmScroller.removeEventListener('touchstart', this.mobileGlobalTapHandler);
            this.mobileGlobalTapHandler = null;
        }
    }
    
    setupMobileTapToSelect() {
        if (!this.cmScroller) return;
        
        this.mobileGlobalTapHandler = (e) => {
            if (this.dragState) return;
            
            const target = e.target;
            if (target.closest('.block-dnd-handle') || target.closest('.block-dnd-handle-wrapper')) {
                return;
            }
            
            const lineEl = target.closest('.cm-line');
            if (!lineEl) {
                this.deselectBlock();
                return;
            }
            
            let tappedBlockIndex = null;
            for (let i = 0; i < this.blocks.length; i++) {
                const block = this.blocks[i];
                if (block.elements.includes(lineEl)) {
                    tappedBlockIndex = i;
                    break;
                }
            }
            
            if (tappedBlockIndex !== null && !this.blocks[tappedBlockIndex].isEmpty) {
                if (this.selectedBlockIndex === tappedBlockIndex) {
                    this.deselectBlock();
                } else {
                    this.selectBlock(tappedBlockIndex);
                }
            } else {
                this.deselectBlock();
            }
        };
        
        this.cmScroller.addEventListener('touchstart', this.mobileGlobalTapHandler, { passive: true });
    }
    
    selectBlock(blockIndex) {
        this.deselectBlock();
        
        this.selectedBlockIndex = blockIndex;
        const block = this.blocks[blockIndex];
        
        if (!block) return;
        
        block.elements.forEach(el => {
            if (el?.classList) el.classList.add('block-dnd-selected');
        });
        
        const wrapper = this.handleWrappers.get(blockIndex);
        if (wrapper) {
            wrapper.classList.add('visible');
        }
    }
    
    deselectBlock() {
        if (this.selectedBlockIndex !== null) {
            const block = this.blocks[this.selectedBlockIndex];
            if (block) {
                block.elements.forEach(el => {
                    if (el?.classList) el.classList.remove('block-dnd-selected');
                });
            }
            
            const wrapper = this.handleWrappers.get(this.selectedBlockIndex);
            if (wrapper) {
                wrapper.classList.remove('visible');
            }
        }
        
        this.selectedBlockIndex = null;
    }

    setupObservers(cmContent, cmScroller) {
        this.lineObserver = new MutationObserver(() => {
            if (!this.dragState) {
                this.debounceRender();
            }
        });
        
        this.lineObserver.observe(cmContent, {
            childList: true,
            subtree: true,
            characterData: true
        });
        
        cmScroller.addEventListener('scroll', () => {
            if (!this.dragState) {
                this.debounceRender();
            }
        });
    }

    debounceRender() {
        if (this.debounceTimeout) clearTimeout(this.debounceTimeout);
        this.debounceTimeout = setTimeout(() => {
            if (!this.dragState) {
                this.renderHandles();
            }
        }, 100);
    }
    
    forceRender() {
        if (this.debounceTimeout) clearTimeout(this.debounceTimeout);
        this.isHovering = false;
        this.selectedBlockIndex = null;
        this.renderHandles();
    }

    getBlockType(lineEl) {
        if (!lineEl) return 'unknown';
        
        if (lineEl.querySelector('.internal-embed, .cm-embed-block, .dataview')) return 'embed';
        
        const classes = lineEl.className || '';
        
        if (classes.includes('HyperMD-callout') || lineEl.querySelector('.callout')) return 'callout';
        if (classes.includes('HyperMD-codeblock')) return 'code';
        if (classes.includes('HyperMD-table-row')) return 'table';
        if (classes.includes('HyperMD-list-line')) return 'list';
        if (classes.includes('HyperMD-header') || lineEl.querySelector('.cm-header')) return 'heading';
        if (classes.includes('HyperMD-quote')) return 'quote';
        if (classes.includes('HyperMD-hr')) return 'hr';
        
        return 'paragraph';
    }

    isSameBlock(type1, type2) {
        if (type1 === 'code' && type2 === 'code') return true;
        if (type1 === 'table' && type2 === 'table') return true;
        if (type1 === 'callout' && (type2 === 'callout' || type2 === 'quote')) return true;
        if (type1 === 'quote' && type2 === 'quote') return true;
        return false;
    }

    parseBlocksFromDOM() {
        if (!this.cmContent) return [];
        
        const lineEls = Array.from(this.cmContent.querySelectorAll('.cm-line'));
        const blocks = [];
        
        let i = 0;
        while (i < lineEls.length) {
            const lineEl = lineEls[i];
            if (!lineEl) {
                i++;
                continue;
            }
            
            const text = lineEl.textContent || '';
            const hasWidget = lineEl.querySelector('.internal-embed, .cm-embed-block, .dataview, .cm-widget');
            const isEmpty = text.trim() === '' && !hasWidget;
            
            const type = isEmpty ? 'empty' : this.getBlockType(lineEl);
            const startIdx = i;
            let endIdx = i;
            
            if (!isEmpty) {
                while (endIdx + 1 < lineEls.length) {
                    const nextEl = lineEls[endIdx + 1];
                    if (!nextEl) break;
                    
                    const nextText = nextEl.textContent || '';
                    const nextHasWidget = nextEl.querySelector('.internal-embed, .cm-embed-block, .dataview, .cm-widget');
                    const nextIsEmpty = nextText.trim() === '' && !nextHasWidget;
                    
                    if (nextIsEmpty) break;
                    
                    const nextType = this.getBlockType(nextEl);
                    if (this.isSameBlock(type, nextType)) {
                        endIdx++;
                    } else {
                        break;
                    }
                }
            }
            
            const elements = lineEls.slice(startIdx, endIdx + 1).filter(el => el != null);
            
            if (elements.length > 0) {
                blocks.push({
                    startIdx,
                    endIdx,
                    type,
                    isEmpty,
                    elements,
                    firstLineEl: elements[0]
                });
            }
            
            i = endIdx + 1;
        }
        
        return blocks;
    }

    renderHandles() {
        if (!this.handlesContainer || !this.activeView || !this.cmContent || !this.cmScroller) return;
        
        this.hideTimeouts.forEach(timeout => clearTimeout(timeout));
        this.hideTimeouts.clear();
        
        this.cleanupBlockEvents();
        
        document.querySelectorAll('.block-dnd-selected').forEach(el => {
            el.classList.remove('block-dnd-selected');
        });
        
        this.handlesContainer.innerHTML = '';
        this.handleWrappers.clear();
        
        const editor = this.activeView.editor;
        if (!editor) return;
        
        this.blocks = this.parseBlocksFromDOM();
        
        const scrollerRect = this.cmScroller.getBoundingClientRect();
        const scrollTop = this.cmScroller.scrollTop;
        
        const handleOffset = this.isMobile ? -8 : 30;
        
        this.blocks.forEach((block, blockIndex) => {
            if (block.isEmpty) return;
            
            const lineEl = block.firstLineEl;
            if (!lineEl || !lineEl.isConnected) return;
            
            const lineRect = lineEl.getBoundingClientRect();
            
            if (lineRect.bottom < scrollerRect.top || lineRect.top > scrollerRect.bottom) {
                return;
            }
            
            const top = lineRect.top - scrollerRect.top + scrollTop;
            
            let left;
            if (this.isMobile) {
                left = -4;
            } else {
                left = lineRect.left - scrollerRect.left - handleOffset;
            }
            
            const wrapper = document.createElement('div');
            wrapper.className = 'block-dnd-handle-wrapper';
            wrapper.style.top = `${top}px`;
            wrapper.style.left = `${left}px`;
            
            const handle = document.createElement('div');
            handle.className = 'block-dnd-handle';
            handle.innerHTML = this.getHandleIcon();
            handle.dataset.blockIndex = blockIndex;
            
            if (this.isMobile) {
                const handleTouchStart = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    const currentBlock = this.blocks[blockIndex];
                    if (currentBlock) {
                        this.onMobileHandleTouchStart(e, currentBlock, blockIndex, handle, wrapper);
                    }
                };
                
                handle.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
                wrapper.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
            } else {
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const currentBlock = this.blocks[blockIndex];
                    if (currentBlock) {
                        this.startDrag(e, currentBlock, blockIndex);
                    }
                });
                
                const showHandle = () => {
                    this.isHovering = true;
                    const timeout = this.hideTimeouts.get(blockIndex);
                    if (timeout) {
                        clearTimeout(timeout);
                        this.hideTimeouts.delete(blockIndex);
                    }
                    wrapper.classList.add('visible');
                };
                
                const hideHandle = () => {
                    const timeout = setTimeout(() => {
                        wrapper.classList.remove('visible');
                        this.hideTimeouts.delete(blockIndex);
                        const anyVisible = document.querySelector('.block-dnd-handle-wrapper.visible');
                        if (!anyVisible) {
                            this.isHovering = false;
                        }
                    }, 200);
                    this.hideTimeouts.set(blockIndex, timeout);
                };
                
                wrapper.addEventListener('mouseenter', showHandle);
                wrapper.addEventListener('mouseleave', hideHandle);
                
                block.elements.forEach(el => {
                    if (el?.addEventListener) {
                        const enterHandler = () => showHandle();
                        const leaveHandler = () => hideHandle();
                        
                        el.addEventListener('mouseenter', enterHandler);
                        el.addEventListener('mouseleave', leaveHandler);
                        
                        this.blockEventCleanups.push(() => {
                            el.removeEventListener('mouseenter', enterHandler);
                            el.removeEventListener('mouseleave', leaveHandler);
                        });
                    }
                });
            }
            
            wrapper.appendChild(handle);
            this.handlesContainer.appendChild(wrapper);
            this.handleWrappers.set(blockIndex, wrapper);
        });
        
        if (this.isMobile && this.selectedBlockIndex !== null && this.blocks[this.selectedBlockIndex]) {
            this.selectBlock(this.selectedBlockIndex);
        }
    }

    getHandleIcon() {
        return `<svg viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5"/>
            <circle cx="15" cy="6" r="1.5"/>
            <circle cx="9" cy="12" r="1.5"/>
            <circle cx="15" cy="12" r="1.5"/>
            <circle cx="9" cy="18" r="1.5"/>
            <circle cx="15" cy="18" r="1.5"/>
        </svg>`;
    }
    
    onMobileHandleTouchStart(e, block, blockIndex, handle, wrapper) {
        const touch = e.touches[0];
        this.touchStartPos = { x: touch.clientX, y: touch.clientY };
        
        handle.classList.add('active');
        
        this.longPressTimeout = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(50);
            const currentBlock = this.blocks[blockIndex];
            if (currentBlock) {
                this.startDrag(e, currentBlock, blockIndex, true);
            }
        }, 150);
    }

    startDrag(e, block, blockIndex, isTouch = false) {
        const editor = this.activeView?.editor;
        if (!editor) {
            this.resetDragState();
            return;
        }
        
        if (!block.elements || block.elements.length === 0) {
            this.resetDragState();
            return;
        }
        
        const firstEl = block.elements[0];
        const lastEl = block.elements[block.elements.length - 1];
        
        if (!firstEl?.isConnected || !lastEl?.isConnected) {
            this.resetDragState();
            this.forceRender();
            return;
        }
        
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        
        const cmView = editor.cm;
        let blockStartLine = null, blockEndLine = null;
        
        if (cmView) {
            try {
                blockStartLine = cmView.state.doc.lineAt(cmView.posAtDOM(firstEl)).number - 1;
                blockEndLine = cmView.state.doc.lineAt(cmView.posAtDOM(lastEl)).number - 1;
            } catch (err) {
                this.resetDragState();
                this.forceRender();
                return;
            }
        }
        
        if (blockStartLine === null || blockEndLine === null) {
            this.resetDragState();
            return;
        }
        
        // Check if there's a text selection that includes this block
        const selection = this.getSelectionLineRange();
        let startLine = blockStartLine;
        let endLine = blockEndLine;
        let elementsToMark = block.elements;
        
        if (selection) {
            // Check if the block's first line is within the selection
            if (blockStartLine >= selection.fromLine && blockStartLine <= selection.toLine) {
                // Use the full selection range
                startLine = selection.fromLine;
                endLine = selection.toLine;
                
                // Mark all lines in selection as dragging
                const lineEls = this.cmContent.querySelectorAll('.cm-line');
                elementsToMark = [];
                for (let i = startLine; i <= endLine && i < lineEls.length; i++) {
                    elementsToMark.push(lineEls[i]);
                }
            }
        }
        
        this.hideTimeouts.forEach(timeout => clearTimeout(timeout));
        this.hideTimeouts.clear();
        
        this.isHovering = false;
        
        if (this.isMobile) {
            this.deselectBlock();
        }
        
        this.dragState = {
            block: { elements: elementsToMark },
            blockIndex,
            editor,
            startY: clientY,
            isTouch,
            startLine,
            endLine
        };
        
        elementsToMark.forEach(el => {
            if (el?.classList && el.isConnected) {
                el.classList.add('block-dnd-dragging');
            }
        });
        
        document.querySelectorAll('.block-dnd-handle-wrapper').forEach(w => {
            w.classList.remove('visible');
        });
        
        document.body.classList.add('block-dnd-dragging-active');
        this.dropIndicator.classList.add('visible');
        
        if (!isTouch) {
            document.addEventListener('mousemove', this.onDrag);
            document.addEventListener('mouseup', this.endDrag);
        }
        
        this.updateIndicator(clientY);
    }

    onDrag = (e) => {
        if (!this.dragState) return;
        e.preventDefault();
        this.updateIndicator(e.clientY);
    }

    updateIndicator(clientY) {
        if (!this.dragState || !this.dropIndicator) return;
        
        const { startLine, endLine } = this.dragState;
        
        const lineEls = Array.from(this.cmContent.querySelectorAll('.cm-line'));
        
        let targetLine = 0;
        let indicatorY = 0;
        let indicatorLeft = 0;
        let indicatorWidth = 0;
        
        for (let i = 0; i < lineEls.length; i++) {
            const lineEl = lineEls[i];
            if (!lineEl?.getBoundingClientRect || !lineEl.isConnected) continue;
            
            const rect = lineEl.getBoundingClientRect();
            const midY = (rect.top + rect.bottom) / 2;
            
            if (clientY < midY) {
                targetLine = i;
                indicatorY = rect.top;
                indicatorLeft = rect.left;
                indicatorWidth = rect.width;
                break;
            }
            
            targetLine = i + 1;
            indicatorY = rect.bottom;
            indicatorLeft = rect.left;
            indicatorWidth = rect.width;
        }
        
        this.dragState.targetLine = targetLine;
        
        this.dropIndicator.style.top = `${indicatorY - 1}px`;
        this.dropIndicator.style.left = `${indicatorLeft}px`;
        this.dropIndicator.style.width = `${indicatorWidth}px`;
    }

    endDrag = () => {
        if (!this.dragState) {
            this.resetDragState();
            return;
        }
        
        const { block, editor, startLine, endLine, targetLine } = this.dragState;
        
        block.elements?.forEach(el => {
            if (el?.classList && el.isConnected) {
                el.classList.remove('block-dnd-dragging');
            }
        });
        
        document.body.classList.remove('block-dnd-dragging-active');
        
        if (this.dropIndicator) {
            this.dropIndicator.classList.remove('visible');
        }
        
        document.removeEventListener('mousemove', this.onDrag);
        document.removeEventListener('mouseup', this.endDrag);
        
        // Check if we should move - don't move inside the dragged range
        const shouldMove = targetLine !== undefined && 
            (targetLine < startLine || targetLine > endLine + 1);
        
        this.dragState = null;
        
        if (shouldMove) {
            try {
                this.moveLines(editor, startLine, endLine, targetLine);
            } catch (err) {
                console.error('[BlockDnD] Move error:', err);
                this.forceRender();
            }
        } else {
            this.forceRender();
        }
    }

    moveLines(editor, startLine, endLine, targetLine) {
        const cmView = editor.cm;
        if (!cmView) {
            this.forceRender();
            return;
        }
        
        const lineCount = endLine - startLine + 1;
        const movingDown = targetLine > endLine;
        
        const lines = editor.getValue().split('\n');
        const blockLines = lines.splice(startLine, lineCount);
        
        let insertAt = targetLine;
        if (movingDown) {
            insertAt = targetLine - lineCount;
        }
        
        lines.splice(insertAt, 0, ...blockLines);
        
        const newContent = lines.join('\n');
        const doc = cmView.state.doc;
        
        cmView.dispatch({
            changes: {
                from: 0,
                to: doc.length,
                insert: newContent
            },
            selection: { anchor: cmView.state.doc.line(insertAt + 1).from },
            userEvent: 'block.move'
        });
        
        setTimeout(() => {
            this.forceRender();
        }, 50);
        
        if (this.isMobile && navigator.vibrate) {
            navigator.vibrate(30);
        }
    }
}

class BlockDndSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        
        containerEl.createEl('h2', { text: 'Block Drag & Drop' });
        
        new obsidian.Setting(containerEl)
            .setName('Show handle on hover')
            .setDesc('Display drag handle when hovering (desktop only)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showHandleOnHover)
                .onChange(async (value) => {
                    this.plugin.settings.showHandleOnHover = value;
                    await this.plugin.saveSettings();
                }));
    }
}

module.exports = BlockDndPlugin;
