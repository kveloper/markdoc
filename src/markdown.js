import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { mathMarkdown } from './math';

marked.setOptions({ gfm: true, breaks: false });
marked.use({ extensions: mathMarkdown });

export function renderMarkdown(source, baseURL) {
  // YAML front matter is metadata, not a thematic break and Setext heading.
  // Keep its delimiters as editable text so Markdown saves stay compatible.
  const frontMatter = source.match(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/);
  let prefix = '';
  if (frontMatter) {
    const code = document.createElement('code');
    code.textContent = frontMatter[0].replace(/^\uFEFF/, '');
    prefix = `<pre data-frontmatter="true">${code.outerHTML}</pre>`;
    source = source.slice(frontMatter[0].length);
  }
  const cleaned = DOMPurify.sanitize(prefix + marked.parse(source), {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'textarea', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'id', 'name', 'srcset'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
  const container = document.createElement('div');
  container.innerHTML = cleaned;
  for (const image of container.querySelectorAll('img')) {
    try {
      const original = image.getAttribute('src') || '';
      const target = new URL(original, baseURL);
      if (!['https:', 'http:', 'file:'].includes(target.protocol)) { image.remove(); continue; }
      image.src = target.href;
      if (original && !/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(original)) image.setAttribute('data-markdown-src', original);
      else image.removeAttribute('data-markdown-src');
      // HTML width="15%" remains a percentage; do not override it with pixels.
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
    } catch { image.remove(); }
  }
  return container.innerHTML;
}
