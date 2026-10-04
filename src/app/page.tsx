'use client';
import { useRef } from 'react';
import StudioChat from '../components/StudioChat';
import ChatPanelControls from '../components/ChatPanelControls';

export default function Home() {
  const editor = useRef<HTMLIFrameElement>(null);
  return <main className="studio-layout">
    <StudioChat editor={editor} />
    <section className="editor-pane" aria-label="Tana scene editor">
      <iframe ref={editor} src="/studio/index.html" title="Studio video editor" allow="autoplay" />
    </section>
    <ChatPanelControls />
  </main>;
}
