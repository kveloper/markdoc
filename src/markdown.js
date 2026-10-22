import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(source, baseURL) {
  const cleaned = DOMPurify.sanitize(marked.parse(source), {
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button', 'textarea', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'id', 'name', 'srcset'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
  const container = document.createElement('div');
  container.innerHTML = cleaned;
  for (const image of container.querySelectorAll('img')) {
    try {
      const target = new URL(image.getAttribute('src') || '', baseURL);
      if (!['https:', 'http:', 'file:'].includes(target.protocol)) { image.remove(); continue; }
      image.src = target.href;
      // HTML width="15%" remains a percentage; do not override it with pixels.
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
    } catch { image.remove(); }
  }
  return container.innerHTML;
}
