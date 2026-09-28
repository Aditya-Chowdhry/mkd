import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

marked.setOptions({ gfm: true, breaks: false });
let serial = 0;
let diagramQueue = Promise.resolve();
export function markdownHTML(source) {
  return DOMPurify.sanitize(marked.parse(source), {
    USE_PROFILES: { html: true }, SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'srcset', 'autofocus'],
  });
}

export async function renderMarkdown(root, source, { dark = false, baseURL = null, onHeadings = () => {} } = {}) {
  const generation = ++serial;
  root.innerHTML = markdownHTML(source);
  root.querySelectorAll('input').forEach(input => { input.disabled = true; });
  root.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (baseURL && src && !/^[a-z][a-z\d+.-]*:/i.test(src)) img.src = new URL(src, baseURL).href;
    img.loading = 'lazy';
  });
  const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((heading, index) => {
    const id = `heading-${index}`;
    heading.id = id;
    return { id, text: heading.textContent, level: Number(heading.tagName[1]) };
  });
  // Resolve conventional Markdown heading links as well as our unique outline IDs.
  const slugs = new Map();
  headings.forEach(heading => {
    const base = heading.text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-');
    let slug = base, suffix = 1;
    while (slugs.has(slug)) slug = `${base}-${suffix++}`;
    slugs.set(slug, heading.id);
  });
  root.querySelectorAll('a[href^="#"]').forEach(link => {
    let hash;
    try { hash = decodeURIComponent(link.getAttribute('href').slice(1)); } catch { return; }
    if (slugs.has(hash)) link.setAttribute('href', `#${slugs.get(hash)}`);
  });
  onHeadings(headings);
  const diagrams = [...root.querySelectorAll('pre > code.language-mermaid')];
  for (let index = 0; index < diagrams.length; index++) {
    const code = diagrams[index];
    const definition = code.textContent;
    const wrapper = document.createElement('figure');
    wrapper.className = 'diagram';
    const label = document.createElement('figcaption');
    label.className = 'diagram-label';
    label.textContent = '◇  MERMAID DIAGRAM';
    const canvas = document.createElement('div');
    canvas.className = 'diagram-canvas';
    canvas.textContent = 'Drawing your diagram…';
    wrapper.append(label, canvas);
    code.parentElement.replaceWith(wrapper);
    const draw = async () => {
      if (generation !== serial) return;
      mermaid.initialize({
        startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
        theme: 'base', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        flowchart: { htmlLabels: false, curve: 'basis', padding: 16 },
        themeVariables: {
          primaryColor: dark ? '#393242' : '#f0ecf5', primaryTextColor: dark ? '#f0e9fa' : '#443452',
          primaryBorderColor: dark ? '#a18bb8' : '#8c799f', lineColor: dark ? '#b4a0ca' : '#77628e',
          secondaryColor: dark ? '#30343b' : '#f0f2ec', tertiaryColor: dark ? '#292a32' : '#f7f5ef',
          background: dark ? '#22232a' : '#fcfbf8', fontSize: '12px',
        },
      });
      try {
        const result = await mermaid.render(`diagram-${generation}-${index}`, definition);
        if (generation !== serial) return;
        canvas.innerHTML = result.svg;
        const svg = canvas.querySelector('svg');
        svg?.setAttribute('role', 'img');
        if (svg && !svg.getAttribute('aria-label') && !svg.getAttribute('aria-labelledby'))
          svg.setAttribute('aria-label', 'Mermaid diagram');
      } catch (error) {
        if (generation !== serial) return;
        canvas.className = 'diagram-error';
        canvas.textContent = `This diagram needs a small fix.\n${String(error.message || error).split('\n').slice(0, 5).join('\n')}`;
        const original = document.createElement('pre');
        original.className = 'diagram-source';
        original.textContent = definition;
        wrapper.append(original);
      }
    };
    diagramQueue = diagramQueue.then(draw, draw);
  }
  await diagramQueue;
}
