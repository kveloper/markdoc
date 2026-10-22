import Image from '@tiptap/extension-image';
import { paperMetrics } from './pagination';

export function resizableImage(getPaper, translate = value => value) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        markdownSrc: { default: null, parseHTML: element => element.getAttribute('data-markdown-src'), renderHTML: attributes => attributes.markdownSrc ? { 'data-markdown-src': attributes.markdownSrc } : {} },
        width: { default: null, parseHTML: element => element.getAttribute('width') },
        height: { default: null, parseHTML: element => element.getAttribute('height') },
      };
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        let current = node;
        const dom = document.createElement('figure');
        dom.className = 'image-block'; dom.contentEditable = 'false';
        const image = document.createElement('img'); image.draggable = false;
        const handle = document.createElement('button');
        handle.className = 'image-resize-handle'; handle.type = 'button';
        const translateHandle = () => { handle.title = translate('드래그해서 크기 조절 (비율 유지)'); handle.setAttribute('aria-label', handle.title); };
        translateHandle();
        dom.append(image, handle);
        const limit = () => {
          const page = paperMetrics(getPaper());
          const ratio = image.naturalWidth / image.naturalHeight || 1;
          return Math.min(page.width - page.margin * 2, (page.height - page.margin * 2 - 12) * ratio);
        };
        const render = () => {
          if (image.getAttribute('src') !== current.attrs.src) image.src = current.attrs.src;
          image.alt = current.attrs.alt || '';
          const width = current.attrs.width;
          dom.style.width = width ? (/^\d+(\.\d+)?%$/.test(String(width)) ? width : `${parseFloat(width)}px`) : '100%';
          dom.style.maxWidth = `${limit()}px`;
          image.style.maxHeight = `${paperMetrics(getPaper()).height - paperMetrics(getPaper()).margin * 2 - 12}px`;
        };
        const loaded = () => { render(); editor.view.dom.dispatchEvent(new Event('paginate')); };
        image.addEventListener('load', loaded); image.addEventListener('error', loaded);
        editor.view.dom.addEventListener('page-metrics', loaded);
        editor.view.dom.addEventListener('ui-language', translateHandle);
        handle.addEventListener('pointerdown', event => {
          event.preventDefault(); event.stopPropagation();
          const original = dom.getBoundingClientRect().width;
          const ratio = image.naturalWidth / image.naturalHeight || original / dom.getBoundingClientRect().height || 1;
          const x = event.clientX, y = event.clientY;
          let width = original;
          handle.setPointerCapture(event.pointerId);
          const move = pointer => {
            const dx = pointer.clientX - x, dy = pointer.clientY - y;
            const delta = (dx + dy / ratio) / (1 + 1 / (ratio * ratio));
            width = Math.max(32, Math.min(limit(), original + delta));
            dom.style.width = `${width}px`;
            editor.view.dom.dispatchEvent(new Event('paginate'));
          };
          const end = () => {
            handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
            const position = getPos();
            if (typeof position === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, width: Math.round(width), height: Math.round(width / ratio) }));
          };
          handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
        });
        render();
        return {
          dom,
          update(next) { if (next.type !== current.type) return false; current = next; render(); return true; },
          selectNode() { dom.classList.add('selected'); }, deselectNode() { dom.classList.remove('selected'); },
          stopEvent(event) { return event.target === handle; },
          ignoreMutation() { return true; },
          destroy() { image.removeEventListener('load', loaded); image.removeEventListener('error', loaded); editor.view.dom.removeEventListener('page-metrics', loaded); editor.view.dom.removeEventListener('ui-language', translateHandle); },
        };
      };
    },
  }).configure({ allowBase64: false });
}
