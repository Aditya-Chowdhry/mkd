import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

let app, page, temporary;
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
test.beforeEach(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'mkd-test-'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${temporary}`] });
  page = await app.firstWindow();
  await expect(page.locator('#preview h1')).toHaveText('A little space for big ideas.');
});
test.afterEach(async () => {
  // Avoid a real native unsaved-changes dialog during test teardown.
  if (app) {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await app.close();
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
async function edit(text) {
  if (await page.locator('#editor-panel').isHidden()) await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Raw Markdown', exact: true });
  await editor.click();
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.insertText(text);
}
async function preview() { await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click(); }
async function mockSave(target) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, target);
}
async function mockOpen(target) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, target);
}

test('starts in preview and renders Mermaid without a network connection', async () => {
  await expect(page.locator('#editor-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit Markdown', exact: true })).toBeVisible();
  await expect(page.locator('.diagram-canvas svg')).toBeVisible();
  await expect(page.locator('.diagram-canvas')).toContainText('An idea');
  await expect(page.locator('#outline button')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/preview-light.png', fullPage: true });
  await page.locator('.diagram').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/mermaid.png', fullPage: true });
});

test('edits raw Markdown, preserves it across mode switches, and supports undo', async () => {
  await edit('# My document\n\nHello **world**.\n\n```mermaid\nsequenceDiagram\nAlice->>Bob: Hello\n```');
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  await preview();
  await expect(page.locator('#preview h1')).toHaveText('My document');
  await expect(page.locator('#preview strong')).toHaveText('world');
  await expect(page.locator('.diagram-canvas svg')).toBeVisible();
  await page.keyboard.press(`${modifier}+e`);
  await expect(page.locator('#editor-panel')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Raw Markdown' })).toContainText('sequenceDiagram');
  await page.keyboard.press(`${modifier}+End`);
  await page.keyboard.insertText('extra');
  await page.keyboard.press(`${modifier}+z`);
  await expect(page.getByRole('textbox', { name: 'Raw Markdown' })).not.toContainText('extra');
  await page.screenshot({ path: 'test-results/editor.png', fullPage: true });
});

test('invalid diagrams show a useful error and subsequent valid diagrams still render', async () => {
  await edit('# Diagram errors\n\n```mermaid\nnot a diagram\n```\n\n```mermaid\nflowchart LR\n A --> B\n```');
  await preview();
  await expect(page.locator('.diagram-error')).toContainText('This diagram needs a small fix');
  await expect(page.locator('.diagram-source')).toContainText('not a diagram');
  await expect(page.locator('.diagram-canvas svg')).toBeVisible();
});

test('sanitizes untrusted Markdown and keeps Node out of the renderer', async () => {
  await edit('# Safe\n\n<script>window.pwned = true</script>\n\n<img src=x onerror="window.pwned=true">\n\n[bad](javascript:window.pwned=true)\n\n<iframe src="https://example.com"></iframe>');
  await preview();
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(await page.evaluate(() => typeof require)).toBe('undefined');
  await expect(page.locator('#preview script, #preview iframe, #preview [onerror], #preview a[href^="javascript:"]')).toHaveCount(0);
});

test('saves, reopens, and saves as a separate Markdown file', async () => {
  const original = path.join(temporary, 'hello.md');
  const copy = path.join(temporary, 'copy.md');
  const text = '# Saved document\n\nUnicode: café, 你好, ✨\n';
  await edit(text);
  await mockSave(original);
  await page.keyboard.press(`${modifier}+s`);
  await expect(page.locator('#filename')).toHaveText('hello.md');
  await expect(page.locator('#save-status')).toHaveText('All changes saved');
  expect(await readFile(original, 'utf8')).toBe(text);
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page.locator('.empty-state')).toBeVisible();
  await mockOpen(original);
  await page.getByRole('button', { name: /Open a document/ }).click();
  await expect(page.locator('#preview h1')).toHaveText('Saved document');
  await expect(page.locator('#editor-panel')).toBeHidden();
  await mockSave(copy);
  await page.keyboard.press(`${modifier}+Shift+s`);
  await expect(page.locator('#filename')).toHaveText('copy.md');
  expect(await readFile(copy, 'utf8')).toBe(text);
});

test('canceling unsaved changes protects the document on new, open, and close', async () => {
  await edit('# Keep my draft');
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); });
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Raw Markdown' })).toContainText('Keep my draft');
  await page.getByRole('button', { name: /Open a document/ }).click();
  await expect(page.getByRole('textbox', { name: 'Raw Markdown' })).toContainText('Keep my draft');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.locator('#editor-panel')).toBeVisible();
});

test('opening a bad file preserves the current document and reports the error', async () => {
  const binary = path.join(temporary, 'binary.md');
  await writeFile(binary, Buffer.from([0, 1, 2, 3]));
  await mockOpen(binary);
  await app.evaluate(({ dialog }) => {
    global.lastError = null;
    dialog.showMessageBox = async (_, options) => { global.lastError = options; return { response: 0 }; };
  });
  await page.getByRole('button', { name: /Open a document/ }).click();
  await expect.poll(() => app.evaluate(() => global.lastError?.detail)).toContain('binary');
  await expect(page.locator('#preview h1')).toHaveText('A little space for big ideas.');
});

test('outline, search, dark theme, and small windows remain usable', async () => {
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('body')).toHaveClass(/dark/);
  await expect(page.locator('.diagram-canvas svg')).toBeVisible();
  await page.screenshot({ path: 'test-results/preview-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle outline', exact: true }).click();
  await expect(page.locator('#sidebar')).toBeHidden();
  await page.keyboard.press(`${modifier}+f`);
  await expect(page.locator('.cm-search')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(680, 520));
  await expect(page.getByRole('button', { name: 'Preview Markdown', exact: true })).toBeVisible();
});

test('canceling Save As keeps an unsaved draft, and failed saves do not discard it', async () => {
  await edit('# Important draft');
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
    dialog.showMessageBox = async () => ({ response: 0 });
  });
  await page.getByRole('button', { name: 'New document', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Raw Markdown' })).toContainText('Important draft');
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  await mockSave(path.join(temporary, 'missing-directory', 'draft.md'));
  await app.evaluate(({ dialog }) => {
    global.saveError = null;
    dialog.showMessageBox = async (_, options) => { global.saveError = options; return { response: 0 }; };
  });
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await expect.poll(() => app.evaluate(() => global.saveError?.type)).toBe('error');
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  await expect(page.getByRole('textbox', { name: 'Raw Markdown' })).toContainText('Important draft');
});

test('loads local images relative to the Markdown document', async () => {
  const file = path.join(temporary, 'images.md');
  await writeFile(path.join(temporary, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS0cAAAAASUVORK5CYII=', 'base64'));
  await writeFile(file, '# Local image\n\n![A pixel](pixel.png)');
  await mockOpen(file);
  await page.getByRole('button', { name: /Open a document/ }).click();
  await expect(page.locator('#preview h1')).toHaveText('Local image');
  await expect.poll(() => page.getByAltText('A pixel').evaluate(image => image.naturalWidth)).toBe(1);
});

test('a second CLI invocation opens the requested file in the existing window', async () => {
  const target = path.join(temporary, 'CLI notes');
  await writeFile(target, '# From the command line');
  await promisify(execFile)(app.process().spawnfile,
    ['.', `--user-data-dir=${temporary}`, '--open-file', target], { timeout: 10000 });
  await expect(page.locator('#preview h1')).toHaveText('From the command line');
  await expect(page.locator('#editor-panel')).toBeHidden();
  expect(app.windows()).toHaveLength(1);
});

test('opening a file recreates a closed macOS window', async () => {
  test.skip(process.platform !== 'darwin', 'Only macOS keeps the app running without windows');
  const target = path.join(temporary, 'reopened.md');
  await writeFile(target, '# Reopened from CLI');
  // Chromium's debugging connection closes with its last target. A hidden
  // helper window keeps Playwright attached while the real document closes.
  await app.evaluate(async ({ BrowserWindow }) => {
    global.keepAlive = new BrowserWindow({ show: false });
    await global.keepAlive.loadURL('about:blank');
  });
  const closed = page.waitForEvent('close');
  const documentWindow = await app.browserWindow(page);
  await documentWindow.evaluate(window => window.close());
  await closed;
  const nextWindow = app.waitForEvent('window');
  await app.evaluate(({ app }, target) => {
    app.emit('open-file', { preventDefault() {} }, target);
  }, target);
  page = await nextWindow;
  await expect(page.locator('#preview h1')).toHaveText('Reopened from CLI');
});

test('preview zoom enlarges the document without resizing navigation or changing content', async () => {
  const heading = page.locator('#preview h1');
  const originalHeight = (await heading.boundingBox()).height;
  const toolbarHeight = (await page.locator('.titlebar').boundingBox()).height;
  const original = await page.evaluate(() => window.desktop.getDocument());
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('#zoom-level')).toHaveText('110%');
  expect((await heading.boundingBox()).height).toBeGreaterThan(originalHeight * 1.05);
  expect((await page.locator('.titlebar').boundingBox()).height).toBe(toolbarHeight);
  expect(await page.evaluate(() => window.desktop.getDocument())).toEqual(original);
  await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  expect((await heading.boundingBox()).height).toBeCloseTo(originalHeight, 0);
});

test('zoom shortcuts, menus, limits, and persistence work in preview and edit modes', async () => {
  await page.keyboard.press(`${modifier}+=`);
  await expect(page.locator('#zoom-level')).toHaveText('110%');
  await page.keyboard.down(modifier);
  await page.keyboard.press('+');
  await page.keyboard.up(modifier);
  await expect(page.locator('#zoom-level')).toHaveText('125%');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === 'View').submenu.items.find(item => item.label === 'Zoom In').click());
  await expect(page.locator('#zoom-level')).toHaveText('150%');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mkd-zoom'))).toBe('150');
  await page.reload();
  await expect(page.locator('#zoom-level')).toHaveText('150%');
  await expect(page.locator('.diagram-canvas svg')).toBeVisible();
  await page.screenshot({ path: 'test-results/preview-zoom.png', fullPage: true });
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  const before = await page.evaluate(() => window.desktop.getDocument());
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '19.5px');
  await page.keyboard.press(`${modifier}+-`);
  await expect(page.locator('#zoom-level')).toHaveText('125%');
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '16.25px');
  expect(await page.evaluate(() => window.desktop.getDocument())).toEqual(before);
  await page.keyboard.press(`${modifier}+0`);
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  for (let count = 0; count < 15; count++) await page.keyboard.press(`${modifier}+=`);
  await expect(page.locator('#zoom-level')).toHaveText('300%');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
  for (let count = 0; count < 15; count++) await page.keyboard.press(`${modifier}+-`);
  await expect(page.locator('#zoom-level')).toHaveText('50%');
  await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
});

test('Ctrl-scroll zooms the preview while ordinary scrolling leaves zoom unchanged', async () => {
  await page.locator('#preview').hover({ position: { x: 150, y: 120 } });
  await page.mouse.wheel(0, 120);
  await expect.poll(() => page.locator('#preview-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('#zoom-level')).toHaveText('100%');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -60);
  await page.keyboard.up('Control');
  await expect.poll(() => page.locator('#zoom-level').textContent()).not.toBe('100%');
  expect(Number((await page.locator('#zoom-level').textContent()).replace('%', ''))).toBeGreaterThan(100);
  await page.keyboard.press(`${modifier}+0`);
  await expect(page.locator('#zoom-level')).toHaveText('100%');
});
