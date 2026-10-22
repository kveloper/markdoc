import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const paginationKey = new PluginKey('document-pages');
export const MM = 96 / 25.4;
export const PAGE_GAP = 24;
export function paperMetrics(paper) {
  return { width: (paper === 'Letter' ? 215.9 : 210) * MM, height: (paper === 'Letter' ? 279.4 : 297) * MM, margin: 20 * MM };
}

export function createPagination(getMetrics, onPages) {
  return Extension.create({
    name: 'pagination',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: paginationKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty, signature: '' }),
          apply(tr, previous) {
            const plan = tr.getMeta(paginationKey);
            if (plan) return { decorations: DecorationSet.create(tr.doc, plan.decorations), signature: plan.signature };
            return { ...previous, decorations: previous.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: { decorations: state => paginationKey.getState(state).decorations },
        view(view) {
          let frame, calibrationTimer, destroyed = false, metricKey = '';
          const corrections = new Map();
          const schedule = () => { clearTimeout(frame); clearTimeout(calibrationTimer); frame = setTimeout(measure, 25); };
          function decorationsFor(plan) {
            return plan.map(item => Decoration.widget(item.pos, () => {
              const element = document.createElement('span');
              element.className = 'page-break'; element.contentEditable = 'false';
              element.setAttribute('aria-hidden', 'true'); element.dataset.page = String(item.page);
              element.style.height = `${item.gap}px`;
              if (item.inline) element.dataset.inline = 'true';
              return element;
            }, { side: -1, key: `page-${item.pos}-${item.gap.toFixed(2)}`, ignoreSelection: true }));
          }
          function applyPlan(plan) {
            const signature = plan.map(item => `${item.pos}:${item.gap.toFixed(2)}`).join('|');
            if (paginationKey.getState(view.state).signature !== signature) view.dispatch(view.state.tr.setMeta(paginationKey, { decorations: decorationsFor(plan), signature }).setMeta('addToHistory', false));
          }
          function calibrate(plan, measuredDoc) {
            if (destroyed || view.state.doc !== measuredDoc || view.composing) return;
            const origin = view.dom.getBoundingClientRect().top;
            const widgets = view.dom.querySelectorAll('.page-break');
            const { height } = getMetrics();
            let previousDelta = 0, changed = false;
            const adjusted = plan.map((item, index) => {
              const next = widgets[index]?.nextSibling;
              if (!next) return item;
              let rect;
              if (item.inline || next.nodeType === Node.TEXT_NODE) {
                const range = document.createRange(); range.selectNodeContents(next); rect = range.getClientRects()[0];
              } else rect = next.getBoundingClientRect?.();
              if (!rect) return item;
              const target = (item.page - 1) * (height + PAGE_GAP) + (item.inline ? .5 : 0);
              const delta = target - (rect.top - origin);
              const correction = delta - previousDelta;
              previousDelta = delta;
              if (Math.abs(correction) < .3) return item;
              changed = true;
              corrections.set(item.pos, (corrections.get(item.pos) || 0) + correction);
              return { ...item, gap: Math.max(0, item.gap + correction) };
            });
            if (changed) applyPlan(adjusted);
          }
          function measure() {
            if (destroyed) return;
            if (view.composing) { frame = setTimeout(measure, 80); return; }
            const { height, margin } = getMetrics();
            const style = getComputedStyle(view.dom);
            const metrics = `${height}/${margin}/${style.width}/${style.fontSize}/${style.lineHeight}`;
            if (metrics !== metricKey) { corrections.clear(); metricKey = metrics; }
            const capacity = height - margin * 2;
            const plan = [];
            let cursor = 0, page = 1, previousBottom = 0;
            // Measure the natural flow, without the previous pagination spacers.
            view.dom.classList.add('measuring-pages');
            const origin = view.dom.getBoundingClientRect().top;
            const addBreak = (pos, inline = false) => {
              const gap = Math.max(0, capacity - cursor) + margin * 2 + PAGE_GAP + (corrections.get(pos) || 0);
              const targetPage = page + 1;
              plan.push({ pos, gap, inline, page: targetPage });
              page++; cursor = 0;
            };
            try {
              const blocks = [];
              const collect = (node, position) => {
                if (['bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote'].includes(node.type.name)) node.forEach((child, offset) => collect(child, position + 1 + offset));
                else blocks.push({ node, position });
              };
              view.state.doc.forEach(collect);
              blocks.forEach(({ node, position }) => {
                const element = view.nodeDOM(position);
                if (!(element instanceof HTMLElement)) return;
                let rect = element.getBoundingClientRect();
                // A table taller than a full page is scaled as a unit so rows
                // never disappear into a margin. Ordinary tables keep their size.
                if (node.type.name === 'table') {
                  element.style.zoom = '';
                  rect = element.getBoundingClientRect();
                  if (rect.height > capacity) {
                    element.style.zoom = String(capacity / rect.height);
                    rect = element.getBoundingClientRect();
                  }
                }
                cursor += Math.max(0, rect.top - origin - previousBottom);
                const blockHeight = rect.height;
                if (cursor + blockHeight > capacity + .5) {
                  if (node.isTextblock && node.content.size && blockHeight > capacity) {
                    // Split oversized text/code at visual line starts, keeping
                    // decorations out of the stored document and undo history.
                    let lastTop = null, used = 0;
                    for (let offset = 0; offset <= node.content.size; offset++) {
                      let coords;
                      try { coords = view.coordsAtPos(position + 1 + offset, 1); } catch { continue; }
                      if (lastTop !== null && Math.abs(coords.top - lastTop) < 2) continue;
                      if (lastTop === null) cursor += Math.max(0, coords.top - rect.top);
                      const lineGap = lastTop === null ? 0 : Math.max(0, coords.top - lastTop - used);
                      cursor += lineGap;
                      const lineHeight = coords.bottom - coords.top;
                      if (cursor + lineHeight > capacity + .5 && cursor > 0) {
                        addBreak(offset ? position + 1 + offset : position, offset > 0);
                        cursor = 0;
                      }
                      cursor += lineHeight; lastTop = coords.top; used = lineHeight;
                    }
                    if (lastTop !== null) cursor += Math.max(0, rect.bottom - lastTop - used);
                  } else {
                    if (cursor > .5) addBreak(position);
                    cursor += blockHeight;
                  }
                } else cursor += blockHeight;
                previousBottom = rect.bottom - origin;
              });
            } finally { view.dom.classList.remove('measuring-pages'); }
            applyPlan(plan);
            const measuredDoc = view.state.doc;
            calibrationTimer = setTimeout(() => calibrate(plan, measuredDoc), 0);
            onPages(page);
          }
          view.dom.addEventListener('paginate', schedule);
          const observer = new ResizeObserver(schedule);
          observer.observe(view.dom.parentElement);
          schedule();
          return {
            update(current, previous) { if (!current.state.doc.eq(previous.doc)) { corrections.clear(); schedule(); } },
            destroy() { destroyed = true; clearTimeout(frame); clearTimeout(calibrationTimer); observer.disconnect(); view.dom.removeEventListener('paginate', schedule); },
          };
        },
      })];
    },
  });
}
