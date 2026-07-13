// 画像の入口3系統（ファイル選択 / ドラッグ&ドロップ / ペースト）をここに集約する。
export function setupImageInputs(onBlob: (blob: Blob) => void): void {
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;
  const overlay = document.getElementById('dropOverlay')!;

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) onBlob(f);
    fileInput.value = '';
  });

  const hasFile = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (hasFile(e)) {
      depth++;
      overlay.hidden = false;
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--depth <= 0) {
      depth = 0;
      overlay.hidden = true;
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) onBlob(f);
  });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          e.preventDefault();
          onBlob(f);
          return;
        }
      }
    }
  });
}
