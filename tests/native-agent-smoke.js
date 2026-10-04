// Explicit opt-in only: this makes a REAL request using Studio's own sign-in.
// Reports contain scene/tool results, never tokens or provider reasoning data.
(async () => {
  if (window.__studioAgentSmokeStarted) return;
  window.__studioAgentSmokeStarted = true;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const publish = report => window.__TAURI__.core.invoke('native_smoke_report', { report });
  let report = { native: !!window.__TAURI_INTERNALS__ };
  try {
    let frame;
    for (let i = 0; i < 300; i++) {
      frame = document.querySelector('iframe')?.contentWindow;
      if (frame?.__studio?.ready && window.studioTestAgent) break;
      await delay(200);
    }
    if (!frame?.__studio?.ready || !window.studioTestAgent) throw new Error('Scene/agent interface did not load.');
    let signedIn = false;
    for (let i = 0; i < 300; i++) {
      const status = await window.__TAURI__.core.invoke('chatgpt_status');
      signedIn = status.status === 'signed_in';
      if (signedIn && document.querySelector('select[aria-label="ChatGPT model"]')?.value) break;
      if (!signedIn && i === 0) await publish({ ...report, state: 'needs_sign_in', message: 'Sign in with ChatGPT in Studio to run the real cone test.' });
      await delay(1000);
    }
    if (!signedIn) { await publish({ ...report, state: 'needs_sign_in', ok: false }); return; }
    const scene = frame.__scene, studio = frame.__studio;
    const before = {
      ids: scene.environment.props.map(p => p.id),
      cameras: JSON.stringify(scene.cameras), shots: JSON.stringify(studio.cameraEdit.shots),
      performances: JSON.stringify(studio.timeline.items),
    };
    await publish({ ...report, state: 'running' });
    const activities = await window.studioTestAgent('Add exactly one traffic cone from the library in the camera foreground. Use the Rixse place_asset action to put it in the current scene. Leave all existing objects, cameras and performances intact.');
    const additions = scene.environment.props.filter(p => !before.ids.includes(p.id));
    const edited = activities?.find(a => a.name === 'apply_action' && a.args.type === 'place_asset' && a.result.ok);
    if (!edited || additions.length !== 1 || additions[0].type !== 'cone') throw new Error('The real agent did not add exactly one cone. ' + (document.querySelector('.error')?.textContent ?? ''));
    if (before.ids.some(id => !scene.environment.props.some(p => p.id === id)) || JSON.stringify(scene.cameras) !== before.cameras || JSON.stringify(studio.cameraEdit.shots) !== before.shots || JSON.stringify(studio.timeline.items) !== before.performances) throw new Error('An unrelated scene/timeline element changed.');
    report = { ...report, state: 'completed', ok: true, rixse: true, cone: { id: additions[0].id, position: additions[0].position },
      activities: activities.map(a => ({ name: a.name, args: a.args, result: a.result })),
      undoAuthor: studio.history.past.at(-1).store.log.at(-1).author };
  } catch (error) { report = { ...report, state: 'failed', ok: false, error: String(error) }; }
  await publish(report);
})();
