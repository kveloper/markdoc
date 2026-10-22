const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { preferences, atomicWrite } = require('../electron/storage.cjs');

test('Python settings migration and invalid settings normalization', () => {
  assert.equal(preferences({ language: 'en' }).language, 'en');
  assert.equal(preferences({ language: 'invalid' }).language, 'ko');
  assert.equal(preferences({ live_preview: false, preview_position: 'top' }).livePreview, false);
  assert.equal(preferences({ preview_position: 'top' }).previewPosition, 'top');
  assert.equal(preferences({ previewPosition: 'invalid', paper: 'invalid' }).paper, 'A4');
  assert.deepEqual(preferences({ recent: ['a.md', 42, 'a.md', 'b.md'] }).recent, ['a.md', 'b.md']);
});
test('atomic save replaces an existing UTF-8 document without leaving temporary files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'markdoc-storage-'));
  try {
    const file = path.join(folder, '한글.md');
    await atomicWrite(file, 'first');
    await atomicWrite(file, '# 한글\nHello, Markdown!');
    assert.equal(await fs.readFile(file, 'utf8'), '# 한글\nHello, Markdown!');
    assert.deepEqual(await fs.readdir(folder), ['한글.md']);
    await assert.rejects(atomicWrite(path.join(folder, 'missing', 'file.md'), 'x'));
    assert.deepEqual(await fs.readdir(folder), ['한글.md']);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
