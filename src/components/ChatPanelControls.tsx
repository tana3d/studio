'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function DrawerIcon({ open = false }: { open?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d={open ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} /></svg>;
}

export default function ChatPanelControls() {
  const divider = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(25);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const restoreFocus = useRef(false);
  const preferencesLoaded = useRef(false);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('tana-studio.chat-width'));
      if (Number.isFinite(saved) && saved >= 15 && saved <= 50) setWidth(saved);
    } catch { /* Storage may be unavailable; keep the quarter-width default. */ }
    preferencesLoaded.current = true;
    const toggle = () => { restoreFocus.current = true; setCollapsed(value => !value); };
    const stop = () => setDragging(false);
    window.addEventListener('studio-toggle-chat', toggle);
    window.addEventListener('blur', stop);
    return () => { window.removeEventListener('studio-toggle-chat', toggle); window.removeEventListener('blur', stop); };
  }, []);

  useLayoutEffect(() => {
    const layout = divider.current?.closest<HTMLElement>('.studio-layout');
    if (!layout) return;
    layout.style.setProperty('--chat-width', `${width}%`);
    layout.dataset.chatCollapsed = String(collapsed);
    layout.dataset.chatResizing = String(dragging);
    const chat = layout.querySelector<HTMLElement>('.chat-pane');
    if (chat) { chat.inert = collapsed; chat.setAttribute('aria-hidden', String(collapsed)); }
    if (restoreFocus.current) {
      if (collapsed) drawer.current?.focus();
      else chat?.querySelector<HTMLButtonElement>('[aria-label="Collapse chat"]')?.focus();
      restoreFocus.current = false;
    }
    if (preferencesLoaded.current) {
      try { localStorage.setItem('tana-studio.chat-width', String(width)); } catch { /* Optional preference. */ }
    }
  }, [width, collapsed, dragging]);

  function resize(clientX: number) {
    const rect = divider.current?.closest('.studio-layout')?.getBoundingClientRect();
    if (rect) setWidth(Math.max(Math.min(260 / rect.width * 100, 50), Math.min(50, (clientX - rect.left) / rect.width * 100)));
  }

  return <>
    <div ref={divider} className="chat-divider" role="separator" aria-label="Resize chat panel" aria-orientation="vertical" aria-controls="studio-chat" aria-valuemin={15} aria-valuemax={50} aria-valuenow={Math.round(width)} tabIndex={collapsed ? -1 : 0} hidden={collapsed}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
      onPointerMove={event => { if (dragging) resize(event.clientX); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }}
      onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}
      onDoubleClick={() => setWidth(25)}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setWidth(value => event.key === 'Home' ? 25 : event.key === 'End' ? 50 : Math.max(15, Math.min(50, value + (event.key === 'ArrowLeft' ? -2 : 2)))); }}
    ><span /></div>
    {dragging && <div className="panel-drag-shield" aria-hidden="true" />}
    {collapsed && <button ref={drawer} className="chat-drawer" aria-label="Open chat" title="Open chat" aria-controls="studio-chat" aria-expanded={false} onClick={() => { restoreFocus.current = true; setCollapsed(false); }}><DrawerIcon open /></button>}
  </>;
}
