// Desktop downloads go through a native save dialog; browser previews keep
// their normal download behaviour. Imported files still use the file picker.
const native = window.parent.__TAURI__?.core;
if (native) document.addEventListener('click', async event => {
  const link = event.target.closest('a[download]');
  if (!link || !link.href.startsWith('blob:')) return;
  event.preventDefault();
  try {
    const blob = await (await fetch(link.href)).blob();
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read the export.'));
      reader.readAsDataURL(blob);
    });
    const saved = await native.invoke('save_export', { name: link.download, data });
    window.studioNotice?.(saved ? 'Export saved.' : 'Save cancelled. Your export is still available.');
  } catch (error) { window.studioNotice?.(`Could not save: ${error}`); }
});
