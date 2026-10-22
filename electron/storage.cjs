const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const defaults = Object.freeze({ dark: false, autosave: true, livePreview: true, previewPosition: 'right', paper: 'A4', recent: [] });
const typographyDefaults = Object.freeze({ body: 12, h1: 26, h2: 22, h3: 19, h4: 17, h5: 15, h6: 13, lineHeight: 1.7 });
function typography(input = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(typographyDefaults)) {
    const value = Number(input?.[key]);
    result[key] = Number.isFinite(value) ? Math.min(key === 'lineHeight' ? 3 : 72, Math.max(key === 'lineHeight' ? 1 : 8, value)) : fallback;
  }
  return result;
}
function preferences(input = {}) {
  const position = input.previewPosition ?? input.preview_position;
  return {
    dark: typeof input.dark === 'boolean' ? input.dark : defaults.dark,
    autosave: typeof input.autosave === 'boolean' ? input.autosave : defaults.autosave,
    livePreview: typeof (input.livePreview ?? input.live_preview) === 'boolean' ? (input.livePreview ?? input.live_preview) : true,
    previewPosition: ['left', 'right', 'top', 'bottom'].includes(position) ? position : 'right',
    paper: input.paper === 'Letter' ? 'Letter' : 'A4',
    language: input.language === 'en' ? 'en' : 'ko',
    explorerVisible: input.explorerVisible !== false,
    explorerRoot: typeof input.explorerRoot === 'string' ? input.explorerRoot : null,
    typography: typography(input.typography),
    recent: Array.isArray(input.recent) ? [...new Set(input.recent.filter(item => typeof item === 'string'))].slice(0, 10) : [],
  };
}
async function atomicWrite(target, text) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try { await fs.writeFile(temporary, text, 'utf8'); await fs.rename(temporary, target); }
  finally { await fs.rm(temporary, { force: true }); }
}
module.exports = { defaults, preferences, typography, typographyDefaults, atomicWrite };
