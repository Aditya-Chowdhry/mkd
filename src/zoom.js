const steps = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300];
const minimum = steps[0];
const maximum = steps.at(-1);

export function setupZoom({ preview, editor, onChange = () => {} }) {
  const out = document.getElementById('zoom-out');
  const reset = document.getElementById('zoom-reset');
  const inside = document.getElementById('zoom-in');
  const label = document.getElementById('zoom-level');
  const stored = Number(localStorage.getItem('mkd-zoom') ?? 100);
  let percent = 100;
  let saveTimer;

  function set(value, persist = true) {
    percent = Math.max(minimum, Math.min(maximum, Math.round(Number.isFinite(value) ? value : 100)));
    // Scale the document, keeping navigation and the toolbar at their normal size.
    preview.style.zoom = String(percent / 100);
    editor.style.setProperty('--editor-font-size', `${13 * percent / 100}px`);
    label.textContent = `${percent}%`;
    out.disabled = percent === minimum;
    inside.disabled = percent === maximum;
    onChange();
    if (persist) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => localStorage.setItem('mkd-zoom', String(percent)), 120);
    }
  }
  function command(name) {
    if (name === 'zoom-in') set(steps.find(step => step > percent) ?? maximum);
    else if (name === 'zoom-out') set(steps.findLast(step => step < percent) ?? minimum);
    else if (name === 'zoom-reset') set(100);
    else return false;
    return true;
  }
  out.addEventListener('click', () => command('zoom-out'));
  inside.addEventListener('click', () => command('zoom-in'));
  reset.addEventListener('click', () => command('zoom-reset'));
  // Chromium reports a trackpad pinch as a wheel event with ctrlKey set.
  preview.parentElement.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? preview.parentElement.clientHeight : 1;
    set(percent * Math.exp(-event.deltaY * unit * 0.005));
  }, { passive: false });
  set(stored, false);
  return { command };
}
