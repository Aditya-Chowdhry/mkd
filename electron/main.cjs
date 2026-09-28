const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { welcome } = require('./welcome.cjs');
const { documentFromArguments } = require('./arguments.cjs');
app.setName('Mkd');

let window;
let filePath = null;
let content = welcome;
let savedContent = welcome;
let busy = false;
let closing = false;
let quitting = false;
let pendingFile = documentFromArguments(process.argv.slice(process.defaultApp ? 2 : 1));
const ownsInstance = app.requestSingleInstanceLock({ file: pendingFile });
if (!ownsInstance) app.quit();
const filters = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }];
const dirty = () => content !== savedContent;
const snapshot = () => ({ content, name: filePath ? path.basename(filePath) : 'Untitled.md',
  filePath, baseURL: filePath ? pathToFileURL(path.dirname(filePath) + path.sep).href : null,
  dirty: dirty() });

function updateTitle() {
  if (!window || window.isDestroyed()) return;
  window.setTitle(`${dirty() ? '● ' : ''}${snapshot().name} — Mkd`);
  window.setDocumentEdited(dirty());
  if (process.platform === 'darwin') window.setRepresentedFilename(filePath || '');
}
function publish(reason = 'replace') {
  updateTitle();
  window.webContents.send('document:loaded', { ...snapshot(), reason });
}
async function save(as = false) {
  let destination = filePath;
  if (!destination || as) {
    const result = await dialog.showSaveDialog(window, { defaultPath: destination || 'Untitled.md', filters });
    if (result.canceled || !result.filePath) return false;
    destination = result.filePath;
  }
  const saving = content;
  // Preserve the original until the complete replacement has been written.
  const temporary = `${destination}.mkd-${process.pid}.tmp`;
  try {
    let mode;
    try { mode = (await fs.stat(destination)).mode; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.writeFile(temporary, saving, { encoding: 'utf8', mode });
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  filePath = destination;
  savedContent = saving;
  app.addRecentDocument(destination);
  publish('save');
  return true;
}
async function canReplace() {
  if (!dirty()) return true;
  const { response } = await dialog.showMessageBox(window, {
    type: 'question', buttons: ['Save changes', 'Discard changes', 'Cancel'],
    defaultId: 0, cancelId: 2, message: `Save changes to ${snapshot().name}?`,
    detail: 'Your unsaved changes will be lost if you discard them.',
  });
  return response === 1 || (response === 0 && await save());
}
async function loadFile(target) {
  // Read first, so a failed open never replaces the current document.
  const bytes = await fs.readFile(target);
  if (bytes.includes(0)) throw new Error('This file appears to be binary. Please choose a Markdown or text file.');
  content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  savedContent = content;
  filePath = path.resolve(target);
  app.addRecentDocument(filePath);
  publish();
}
async function action(name, target) {
  if (busy) return false;
  busy = true;
  try {
    if (name === 'save' || name === 'save-as') return await save(name === 'save-as');
    if (name === 'open') {
      if (!(await canReplace())) return false;
      if (!target) {
        const result = await dialog.showOpenDialog(window, { filters, properties: ['openFile'] });
        if (result.canceled) return false;
        target = result.filePaths[0];
      }
      await loadFile(target);
    } else if (name === 'new') {
      if (!(await canReplace())) return false;
      content = ''; savedContent = ''; filePath = null;
      publish();
    } else if (name === 'close') {
      if (!(await canReplace())) return false;
      content = savedContent;
      closing = true;
      window.close();
      if (quitting) app.quit();
    }
    return true;
  } catch (error) {
    await dialog.showMessageBox(window, { type: 'error', message: 'The document could not be updated', detail: error.message });
    return false;
  } finally { busy = false; }
}
function createMenu() {
  const run = name => () => void action(name);
  const command = name => () => window?.webContents.send('command', name);
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New', accelerator: 'CmdOrCtrl+N', click: run('new') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: run('open') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: run('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: run('save-as') },
      { type: 'separator' }, { role: 'close' },
      ...(process.platform !== 'darwin' ? [{ role: 'quit' }] : []),
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { label: 'Find in Markdown', accelerator: 'CmdOrCtrl+F', click: command('find') }] },
    { label: 'View', submenu: [
      { label: 'Toggle Edit / Preview', accelerator: 'CmdOrCtrl+E', click: command('toggle-mode') },
      { label: 'Toggle Outline', accelerator: 'CmdOrCtrl+\\', click: command('toggle-outline') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function createWindow() {
  closing = false;
  window = new BrowserWindow({
    width: 1180, height: 820, minWidth: 640, minHeight: 480,
    title: 'Mkd', backgroundColor: '#faf9f6', show: false,
    icon: path.join(__dirname, '../assets/icon.png'),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 23 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  window.on('close', event => {
    if (!closing && dirty()) { event.preventDefault(); void action('close'); }
  });
  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, '../dist/index.html'));
  updateTitle();
  createMenu();
}
function openRequestedFile(target) {
  if (!app.isReady()) { pendingFile = target; return; }
  if (!window || window.isDestroyed()) createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (target) void action('open', target);
}
app.on('open-file', (event, target) => {
  event.preventDefault();
  openRequestedFile(target);
});
app.on('second-instance', (_, argv, cwd, data) => {
  const target = typeof data?.file === 'string' ? data.file : documentFromArguments(argv.slice(1), cwd);
  openRequestedFile(target);
});
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  createWindow();
  const trusted = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Untrusted request');
  };
  ipcMain.handle('document:get', event => { trusted(event); return snapshot(); });
  ipcMain.handle('document:update', (event, text) => {
    trusted(event);
    if (typeof text !== 'string') throw new Error('Invalid document');
    content = text; updateTitle(); return { dirty: dirty() };
  });
  ipcMain.handle('document:action', (event, name) => {
    trusted(event);
    if (!['new', 'open', 'save', 'save-as'].includes(name)) throw new Error('Unknown action');
    return action(name);
  });
  ipcMain.handle('link:open', async (event, url) => {
    trusted(event);
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) await shell.openExternal(url);
  });
  if (pendingFile) { await action('open', pendingFile); pendingFile = null; }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (window && !window.isDestroyed() && dirty() && !closing) {
    event.preventDefault();
    quitting = true;
    void action('close').then(completed => { if (!completed) quitting = false; });
  }
});
