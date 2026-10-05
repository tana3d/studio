'use client';
import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type Phase = 'available' | 'downloading' | 'ready' | 'confirm' | 'installing';
export default function StudioUpdater() {
  const update = useRef<Update | null>(null);
  const mounted = useRef(false);
  const [version, setVersion] = useState('');
  const [phase, setPhase] = useState<Phase>('available');
  const [progress, setProgress] = useState<number | undefined>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true, checking = false, lastCheck = 0;
    mounted.current = true;
    const inspect = async () => {
      if (!alive || checking || update.current || Date.now() - lastCheck < 60 * 60 * 1000) return;
      checking = true; lastCheck = Date.now();
      try {
        const candidate = await check({ timeout: 15000 });
        if (!alive) { await candidate?.close(); return; }
        update.current = candidate;
        if (candidate) setVersion(candidate.version);
      } catch { /* Offline checks stay quiet and retry later. */ }
      finally { checking = false; }
    };
    const initial = window.setTimeout(() => void inspect(), 5000);
    const interval = window.setInterval(() => void inspect(), 6 * 60 * 60 * 1000);
    window.addEventListener('focus', inspect);
    return () => {
      alive = false; mounted.current = false;
      window.clearTimeout(initial); window.clearInterval(interval);
      window.removeEventListener('focus', inspect);
      const resource = update.current; update.current = null;
      void resource?.close().catch(() => {});
    };
  }, []);
  const dismiss = () => {
    const resource = update.current; update.current = null;
    void resource?.close().catch(() => {});
    setVersion(''); setError(''); setPhase('available');
  };
  const download = async () => {
    if (!update.current) return;
    setPhase('downloading'); setError(''); setProgress(undefined);
    let received = 0, total = 0;
    try {
      await update.current.download(event => {
        if (!mounted.current) return;
        if (event.event === 'Started') { total = event.data.contentLength ?? 0; received = 0; }
        if (event.event === 'Progress') received += event.data.chunkLength;
        setProgress(total ? Math.min(100, received / total * 100) : undefined);
      }, { timeout: 30 * 60 * 1000 });
      if (mounted.current) { setProgress(100); setPhase('ready'); }
    } catch {
      if (mounted.current) { setError('Could not download and verify the update. Please try again.'); setPhase('available'); }
    }
  };
  const install = async () => {
    if (!update.current) return;
    setPhase('installing'); setError('');
    try { await update.current.install(); await relaunch(); }
    catch { if (mounted.current) { setError('Could not restart with the update. Please try again.'); setPhase('ready'); } }
  };
  if (!version) return null;
  const busy = phase === 'downloading' || phase === 'installing';
  return <aside className="studio-update" aria-label="Studio update">
    <div className="studio-update-heading"><strong>Studio v{version}</strong><button aria-label="Dismiss update" disabled={busy} onClick={dismiss}>×</button></div>
    <p role="status">{phase === 'available' ? 'A new version is available.' : phase === 'downloading' ? 'Downloading update…' : phase === 'installing' ? 'Installing update…' : phase === 'confirm' ? 'Restarting closes your current scene. Keep any recordings you need before continuing.' : 'Your update is ready.'}</p>
    {phase === 'downloading' && <progress max={100} value={progress} aria-label="Update download" />}
    {error && <p role="alert">{error}</p>}
    {phase === 'available' && <button className="primary" onClick={() => void download()}>Download update</button>}
    {phase === 'ready' && <button className="primary" onClick={() => setPhase('confirm')}>Restart &amp; update</button>}
    {phase === 'confirm' && <div className="studio-update-actions"><button onClick={() => setPhase('ready')}>Keep editing</button><button className="primary" onClick={() => void install()}>Restart now</button></div>}
  </aside>;
}
