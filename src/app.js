import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { openSearchPanel } from '@codemirror/search';
import { renderMarkdown } from './render.js';
import { setupZoom } from './zoom.js';

const $ = id => document.getElementById(id);
const api = window.desktop;
const isMac = api?.platform === 'darwin';
document.body.classList.toggle('mac', isMac);
$('mode-shortcut').textContent = isMac ? '⌘ E' : 'Ctrl E';
let source = '';
let currentDocument = {};
let editing = false;
let editor;
let revision = 0;
let toastTimeout;
let observer;
const zoom = setupZoom({ preview: $('preview'), editor: $('editor'), onChange: () => editor?.requestMeasure() });
const editorTheme = new Compartment();
let dark = localStorage.getItem('mkd-theme') === 'dark' || (!localStorage.getItem('mkd-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
let outlineVisible = localStorage.getItem('mkd-outline') !== 'hidden';
document.body.classList.toggle('dark', dark);
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 2800);
}
function updateStats() {
  const words = source.trim() ? source.trim().split(/\s+/u).length : 0;
  $('word-count').textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
  $('read-time').textContent = `${Math.max(1, Math.ceil(words / 220))} min read`;
}
function updateStatus(isDirty) {
  currentDocument.dirty = isDirty;
  $('dirty-dot').hidden = !isDirty;
  $('save-status').textContent = isDirty ? 'Unsaved changes' : currentDocument.filePath ? 'All changes saved' : 'Ready to write';
}
function makeEditor() {
  editor = new EditorView({
    parent: $('editor'),
    state: EditorState.create({ doc: source, extensions: [
      basicSetup, markdown(), EditorView.lineWrapping,
      editorTheme.of(dark ? oneDark : []),
      EditorView.contentAttributes.of({ 'aria-label': 'Raw Markdown', spellcheck: 'false' }),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        source = update.state.doc.toString();
        updateStats();
        updateStatus(true);
        const sent = ++revision;
        api?.update(source).then(status => { if (sent === revision) updateStatus(status.dirty); })
          .catch(() => toast('Could not update the document. Please copy your changes before closing.'));
      }),
    ] }),
  });
}
function setOutline(headings) {
  observer?.disconnect();
  $('heading-count').textContent = headings.length;
  $('outline').replaceChildren();
  if (!headings.length) {
    const hint = document.createElement('p'); hint.className = 'outline-empty';
    hint.textContent = 'Add a heading to give your ideas a little structure.';
    $('outline').append(hint);
  }
  for (const [index, heading] of headings.entries()) {
    const button = document.createElement('button');
    button.textContent = heading.text; button.title = heading.text;
    button.dataset.level = Math.min(heading.level, 3);
    button.dataset.target = heading.id;
    if (!index) button.classList.add('active');
    button.addEventListener('click', () => {
      if (editing) setMode(false);
      document.getElementById(heading.id)?.scrollIntoView({ block: 'start' });
      $('outline').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    });
    $('outline').append(button);
  }
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      $('outline').querySelectorAll('button').forEach(item => item.classList.toggle('active', item.dataset.target === entry.target.id));
      break;
    }
  }, { root: $('preview-scroll'), rootMargin: '0px 0px -65% 0px' });
  headings.forEach(heading => { const element = document.getElementById(heading.id); if (element) observer.observe(element); });
}
async function preview() {
  if (!source.trim()) {
    await renderMarkdown($('preview'), '', { onHeadings: setOutline });
    $('preview').innerHTML = '<div class="empty-state"><div class="empty-mark">m↓</div><h1>Every idea starts somewhere.</h1><p>A fresh page, just for you. Make your first mark.</p><button class="primary-button" id="start-writing">Start writing <span>↗</span></button></div>';
    $('start-writing').addEventListener('click', () => setMode(true));
    return;
  }
  try { await renderMarkdown($('preview'), source, { dark, baseURL: currentDocument.baseURL, onHeadings: setOutline }); }
  catch { toast('The preview could not be rendered. Your Markdown is still available in Edit.'); }
}
function setMode(value) {
  editing = value;
  $('preview-scroll').hidden = editing;
  $('editor-panel').hidden = !editing;
  $('mode-toggle').querySelector('span').textContent = editing ? 'Preview' : 'Edit';
  $('mode-toggle').setAttribute('aria-label', editing ? 'Preview Markdown' : 'Edit Markdown');
  $('mode-toggle').querySelector('svg').innerHTML = editing
    ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="m16 3 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7Z"/>';
  $('view-label').textContent = editing ? 'Writing view' : 'Reading view';
  $('mode-status').textContent = editing ? 'EDITING' : 'PREVIEW';
  $('format-label').textContent = editing ? 'RAW MARKDOWN' : 'MARKDOWN';
  if (editing) { if (!editor) makeEditor(); editor.requestMeasure(); editor.focus(); }
  else void preview();
}
function applyDocument(document) {
  currentDocument = document;
  $('filename').textContent = document.name;
  $('filename').title = document.filePath || document.name;
  if (document.reason !== 'save') {
    source = document.content;
    revision++;
    if (editor) { editor.destroy(); editor = null; }
    setMode(false);
    $('preview-scroll').scrollTop = 0;
  }
  updateStatus(document.dirty);
  updateStats();
  if (document.reason === 'save') { toast('Document saved'); if (!editing) void preview(); }
}
async function action(name) {
  try { await api?.action(name); }
  catch { toast('Something went wrong. Your document is still here.'); }
}
function toggleOutline() {
  outlineVisible = !outlineVisible;
  updateOutlineVisibility();
  localStorage.setItem('mkd-outline', outlineVisible ? 'visible' : 'hidden');
}
function updateOutlineVisibility() {
  $('sidebar').hidden = !outlineVisible;
  $('outline-toggle').setAttribute('aria-expanded', String(outlineVisible));
}
function updateThemeLabel() {
  $('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}
$('mode-toggle').addEventListener('click', () => setMode(!editing));
$('open').addEventListener('click', () => action('open'));
$('new').addEventListener('click', () => action('new'));
$('save').addEventListener('click', () => action('save'));
$('outline-toggle').addEventListener('click', toggleOutline);
$('theme-toggle').addEventListener('click', () => {
  dark = !dark; document.body.classList.toggle('dark', dark);
  localStorage.setItem('mkd-theme', dark ? 'dark' : 'light');
  editor?.dispatch({ effects: editorTheme.reconfigure(dark ? oneDark : []) });
  updateThemeLabel(); if (!editing) void preview();
});
$('preview').addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {
    try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' }); } catch { /* malformed anchor */ }
  } else if (/^(https?:|mailto:)/i.test(href)) void api?.openExternal(href);
  else toast('Use Open a document to follow a local file link.');
});
api?.onDocument(applyDocument);
api?.onCommand(name => {
  if (zoom.command(name)) return;
  if (name === 'toggle-mode') setMode(!editing);
  if (name === 'toggle-outline') toggleOutline();
  if (name === 'find') { setMode(true); openSearchPanel(editor); }
});
// Handle shortcuts in the document too, including when an editor has focus.
// Native menus remain available for mouse and OS-level menu commands.
document.addEventListener('keydown', event => {
  if (!(isMac ? event.metaKey : event.ctrlKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  const zoomCommand = { '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset' }[key];
  if (zoomCommand) {
    event.preventDefault(); event.stopPropagation();
    zoom.command(zoomCommand);
    return;
  }
  if (!['e', 's', 'o', 'n', 'f', '\\'].includes(key)) return;
  event.preventDefault(); event.stopPropagation();
  if (key === 'e') setMode(!editing);
  if (key === 's') void action(event.shiftKey ? 'save-as' : 'save');
  if (key === 'o') void action('open');
  if (key === 'n') void action('new');
  if (key === '\\') toggleOutline();
  if (key === 'f') { setMode(true); openSearchPanel(editor); }
}, true);
updateOutlineVisibility(); updateThemeLabel();
if (api) api.getDocument().then(applyDocument).catch(() => toast('Could not load your document. Please reopen the app.'));
else applyDocument({ name: 'Untitled.md', content: '# Welcome to Mkd\n\nOpen the desktop app to get started.', dirty: false });
