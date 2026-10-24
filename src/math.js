import { Node } from '@tiptap/core';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { MathfieldElement } from 'mathlive';

MathfieldElement.fontsDirectory = import.meta.env.DEV ? '/node_modules/mathlive/fonts' : new URL('./mathlive/fonts', document.baseURI).href;
MathfieldElement.soundsDirectory = null;

function createMathfield() {
  const field = new MathfieldElement();
  field.mathVirtualKeyboardPolicy = 'manual';
  field.setAttribute('aria-label', '수식 편집');
  return field;
}

export function renderFormula(element, tex, display = true) {
  katex.render(tex, element, { displayMode: display, throwOnError: true, trust: false, maxExpand: 1000, output: 'htmlAndMathml' });
}

export const MathFormula = Node.create({
  name: 'mathFormula', group: 'inline', inline: true, atom: true,
  addAttributes() {
    return {
      tex: { default: '', parseHTML: el => el.getAttribute('data-tex'), renderHTML: attrs => ({ 'data-tex': attrs.tex }) },
      display: { default: true, parseHTML: el => el.getAttribute('data-display') !== 'false', renderHTML: attrs => ({ 'data-display': String(attrs.display) }) },
    };
  },
  parseHTML() { return [{ tag: 'span[data-type="mathFormula"]' }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', { ...HTMLAttributes, 'data-type': 'mathFormula', class: 'math-formula' }, node.attrs.tex]; },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span'); dom.className = 'math-formula'; dom.contentEditable = 'false';
      let current = node, field = null;
      const render = current => {
        dom.dataset.tex = current.attrs.tex; dom.dataset.display = String(current.attrs.display);
        try { renderFormula(dom, current.attrs.tex, current.attrs.display); }
        catch { dom.textContent = current.attrs.tex; }
      };
      render(node);
      const sync = () => {
        if (!field || editor.isDestroyed) return;
        const tex = field.value;
        try { renderFormula(document.createElement('span'), tex, current.attrs.display); } catch { return; }
        const pos = getPos();
        if (typeof pos === 'number' && tex !== current.attrs.tex) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, tex }));
      };
      const finish = () => {
        if (!field) return;
        sync();
        field = null; dom.classList.remove('editing'); render(current);
      };
      dom.addEventListener('click', () => {
        if (field || !editor.isEditable) return;
        field = createMathfield(); field.value = current.attrs.tex;
        dom.classList.add('editing'); dom.replaceChildren(field); field.resetUndo(); field.focus();
        field.addEventListener('input', sync);
        field.addEventListener('change', sync);
        field.addEventListener('keydown', event => {
          if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
            event.preventDefault(); event.stopPropagation(); field.executeCommand(event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo'); sync();
          } else if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); const pos = getPos(); finish();
            if (typeof pos === 'number') editor.commands.focus(pos + 1);
          }
        }, true);
        field.addEventListener('blur', finish);
      });
      return {
        dom,
        stopEvent: event => Boolean(field && event.target === field),
        ignoreMutation: () => true,
        update(next) {
          if (next.type.name !== 'mathFormula') return false;
          current = next;
          if (field) { dom.dataset.tex = next.attrs.tex; if (field.value !== next.attrs.tex) field.setValue(next.attrs.tex, { silenceNotifications: true }); }
          else render(next);
          return true;
        },
      };
    };
  },
});

// Marked extensions protect TeX from Markdown's backslash and underscore rules.
export const mathMarkdown = [
  { name: 'mathBlock', level: 'block', start: src => src.indexOf('$$'),
    tokenizer(src) { const match = /^\$\$[ \t]*\n?([\s\S]+?)\n?\$\$(?:\n|$)/.exec(src); if (match) return { type: 'mathBlock', raw: match[0], tex: match[1], display: true }; },
    renderer: token => `<p>${formulaHTML(token.tex, true)}</p>\n` },
  { name: 'mathInline', level: 'inline', start: src => src.indexOf('$'),
    tokenizer(src) { const match = /^\$(?!\$)((?:\\[^\n]|[^$\n\\])+)\$(?!\$)/.exec(src); if (match) return { type: 'mathInline', raw: match[0], tex: match[1] }; },
    renderer: token => formulaHTML(token.tex, false) },
];

function formulaHTML(tex, display) {
  const span = document.createElement('span'); span.dataset.type = 'mathFormula'; span.dataset.tex = tex; span.dataset.display = String(display);
  return span.outerHTML;
}

export function setupMathDialog(editor, modal, t) {
  const dialog = document.querySelector('#math-dialog'), input = document.querySelector('#math-tex');
  const preview = document.querySelector('#math-preview'), error = document.querySelector('#math-error');
  const insert = document.querySelector('#math-insert'), display = document.querySelector('#math-display');
  const visual = createMathfield(); preview.append(visual);
  const undo = document.querySelector('#math-undo'), redo = document.querySelector('#math-redo');
  let visualFocused = false;
  visual.addEventListener('focus', () => { visualFocused = true; });
  input.addEventListener('focus', () => { visualFocused = false; });
  let history = [], historyIndex = -1;
  const snapshot = () => ({ tex: input.value, display: display.checked, start: input.selectionStart, end: input.selectionEnd });
  function record() {
    const next = snapshot(), previous = history[historyIndex];
    if (previous && previous.tex === next.tex && previous.display === next.display) return;
    history.splice(historyIndex + 1); history.push(next); historyIndex = history.length - 1;
    update();
  }
  function travel(delta) {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    historyIndex = next;
    const state = history[next]; input.value = state.tex; display.checked = state.display;
    input.setSelectionRange(state.start, state.end); update();
  }
  undo.addEventListener('click', () => travel(-1)); redo.addEventListener('click', () => travel(1));
  dialog.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || !['z', 'y'].includes(event.key.toLowerCase())) return;
    event.preventDefault(); event.stopPropagation();
    travel(event.key.toLowerCase() === 'y' || event.shiftKey ? 1 : -1);
  }, true);
  const groups = [
    ['구조', [['분수', '\\frac{a}{b}'], ['위 첨자', 'x^{2}'], ['아래 첨자', 'x_{i}'], ['제곱근', '\\sqrt{x}'], ['n제곱근', '\\sqrt[n]{x}'], ['괄호', '\\left( x \\right)']]],
    ['미적분', [['합', '\\sum_{i=1}^{n} i'], ['곱', '\\prod_{i=1}^{n} x_i'], ['적분', '\\int_{a}^{b} f(x)\\,dx'], ['극한', '\\lim_{x \\to 0} f(x)'], ['미분', '\\frac{dy}{dx}']]],
    ['기호', [['α', '\\alpha'], ['β', '\\beta'], ['θ', '\\theta'], ['π', '\\pi'], ['∞', '\\infty'], ['×', '\\times'], ['±', '\\pm'], ['≤', '\\leq'], ['≥', '\\geq'], ['≠', '\\neq'], ['→', '\\to']]],
    ['행렬·함수', [['행렬', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'], ['경우 나누기', 'f(x)=\\begin{cases} x & x \\geq 0 \\\\ -x & x < 0 \\end{cases}'], ['sin', '\\sin{x}'], ['cos', '\\cos{x}'], ['log', '\\log{x}']]],
  ];
  for (const [title, items] of groups) {
    const group = document.createElement('fieldset'), legend = document.createElement('legend'); legend.dataset.i18n = title; legend.textContent = t(title); group.append(legend);
    for (const [label, tex] of items) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.i18n = label; button.textContent = t(label); button.title = tex;
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        if (visualFocused) { visual.insert(tex); input.value = visual.value; visual.focus(); record(); }
        else { const start = input.selectionStart; input.setRangeText(tex, start, input.selectionEnd, 'select'); input.focus(); record(); }
      });
      group.append(button);
    }
    document.querySelector('#math-elements').append(group);
  }
  function update() {
    error.textContent = ''; insert.disabled = !input.value.trim();
    if (visual.value !== input.value) visual.setValue(input.value, { silenceNotifications: true });
    try { renderFormula(document.createElement('span'), input.value, display.checked); }
    catch (err) { error.textContent = t('수식을 확인하세요: {message}', { message: err.message }); insert.disabled = true; }
    undo.disabled = historyIndex <= 0; redo.disabled = historyIndex >= history.length - 1;
  }
  input.addEventListener('input', record); display.addEventListener('change', record);
  visual.addEventListener('input', () => { input.value = visual.value; record(); });
  return async () => {
    const { from, to } = editor.state.selection;
    const selected = editor.state.selection.node;
    const existing = selected?.type.name === 'mathFormula' ? selected : null;
    input.value = existing?.attrs.tex || ''; display.checked = existing ? existing.attrs.display : true;
    history = []; historyIndex = -1; record();
    const result = modal('#math-dialog'); input.focus();
    if (await result === 'insert' && !insert.disabled) {
      editor.chain().focus().insertContentAt({ from, to }, { type: 'mathFormula', attrs: { tex: input.value.trim(), display: display.checked } }).run();
    } else editor.commands.focus();
  };
}
