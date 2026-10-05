'use client';
import { useRef, useEffect } from 'react';
import StudioChat from '../components/StudioChat';
import ChatPanelControls from '../components/ChatPanelControls';

export default function Home() {
  const editor = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || !/^(Digit[1-9]|Backquote)$/.test(event.code)) return;
      event.preventDefault();
      if (!event.repeat) editor.current?.contentWindow?.postMessage({type:'studio-control-shortcut',code:event.code},location.origin);
    };
    window.addEventListener('keydown',shortcut);
    return () => window.removeEventListener('keydown',shortcut);
  },[]);
  return <main className="studio-layout">
    <StudioChat editor={editor} />
    <section className="editor-pane" aria-label="Tana scene editor">
      <iframe ref={editor} src="/studio/index.html" title="Studio video editor" allow="autoplay" />
    </section>
    <ChatPanelControls />
  </main>;
}
