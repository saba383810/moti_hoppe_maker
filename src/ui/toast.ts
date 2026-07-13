export function showToast(msg: string, ms = 2600): void {
  const area = document.getElementById('toastArea');
  if (!area) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  area.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => {
    el.classList.remove('show');
    window.setTimeout(() => el.remove(), 300);
  }, ms);
}
