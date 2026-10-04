// Runs only when explicitly requested in a debug build. No sign-in or API call.
(async () => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let report = {};
  try {
    let frame;
    for (let i = 0; i < 200; i++) {
      frame = document.querySelector('iframe')?.contentWindow;
      if (frame?.__studio?.ready) break;
      await delay(200);
    }
    if (!frame?.__studio?.ready) throw new Error('Bundled scene did not load in the native webview.');
    const studio = frame.__studio;
    report.native = !!window.__TAURI_INTERNALS__;
    report.ready = studio.ready;
    report.models = Object.keys(studio.actors).length;
    report.canvasStream = !!studio.renderer.domElement.captureStream;
    report.mp4 = !!frame.MediaRecorder?.isTypeSupported('video/mp4');
    report.webm = !!frame.MediaRecorder?.isTypeSupported('video/webm');
    // A short export through the actual editor controls, then decode it.
    studio.cameraEdit.shots[0].length = 0.6;
    studio.cameraEdit.shots[0].spec = structuredClone(frame.__scene.cameras[2]);
    studio.cameraEdit.syncEnd();
    frame.document.getElementById('rec').click();
    frame.document.getElementById('export-quality').value = 'low';
    frame.document.getElementById('start-export').click();
    const video = frame.document.getElementById('playback');
    for (let i = 0; i < 150; i++) {
      if (frame.__exports.length && video.readyState >= 2) break;
      await delay(200);
    }
    if (!frame.__exports.length || video.readyState < 2) throw new Error('Native video export did not decode.');
    video.pause();
    const canvas = frame.document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 160, 90);
    const pixels = ctx.getImageData(0, 0, 160, 90).data;
    report.litPixels = [...pixels].filter((v, i) => i % 4 !== 3 && v > 15).length;
    if (report.litPixels < 100) throw new Error('Native video export contains black frames.');
    report.video = { width: video.videoWidth, height: video.videoHeight, bytes: frame.__exports[0].bytes, format: frame.__exports[0].format };
    frame.document.getElementById('close-playback').click();
    report.ok = true;
  } catch (error) { report.error = String(error); report.ok = false; }
  await window.__TAURI__.core.invoke('native_smoke_report', { report });
})();
