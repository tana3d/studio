'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import AnswerText from './AnswerText';
import { DrawerIcon } from './ChatPanelControls';
import { AgentError, runSceneAgent, type ToolResult } from '../lib/scene-agent';

type Account = { status: 'signed_out' | 'pending' | 'signed_in'; email: string | null; error: string | null };
type Model = { slug: string; display_name: string };
type Message = { role: 'user' | 'assistant'; content: string };
type SceneWindow = Window & { studioContext?: () => unknown; studioViewImage?: () => string; studioAgent?: { executeTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult> } };

export default function StudioChat({ editor }: { editor: RefObject<HTMLIFrameElement | null> }) {
  const [account, setAccount] = useState<Account>({ status: 'signed_out', email: null, error: null });
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [usageLimited, setUsageLimited] = useState(false);
  const [activity, setActivity] = useState('');
  const [native, setNative] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    const desktop = isTauri(); setNative(desktop);
    if (!desktop) return;
    let alive = true;
    const update = (value: Account) => { if (alive && value) { setAccount(value); setError(value.error ?? ''); } };
    const refresh = () => invoke<Account>('chatgpt_status').then(update).catch(e => { if (alive) setError(String(e)); });
    // Subscribe before reading, so completing sign-in cannot be lost.
    // The native event is a notification with a null payload, not an Account.
    const stop = listen('chatgpt-changed', () => { void refresh(); });
    void stop.then(refresh).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; void stop.then(unlisten => unlisten()).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (account.status !== 'signed_in') { setModels([]); setModel(''); return; }
    let alive = true;
    void invoke<Model[]>('chatgpt_models').then(list => {
      if (!alive) return;
      setModels(list); setModel(previous => list.some(m => m.slug === previous) ? previous : list[0]?.slug ?? '');
      if (!list.length) setError('No models are available for this account.');
    }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [account.status]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages, busy]);

  async function accountAction(command: string) {
    setError(''); setConnecting(true);
    try { setAccount(await invoke<Account>(command)); }
    catch (e) { setError(String(e)); }
    finally { setConnecting(false); }
  }
  async function send(text = question) {
    if (active.current || !text.trim() || !model || account.status !== 'signed_in') return;
    const user: Message = { role: 'user', content: text.trim() };
    const history = [...messages.filter(m => m.content), user];
    const sceneWindow = editor.current?.contentWindow as SceneWindow | null;
    if (!sceneWindow?.studioContext || !sceneWindow.studioViewImage || !sceneWindow.studioAgent) { setError('The scene is still loading. Try again in a moment.'); return; }
    cancelled.current = false; setActivity('');
    active.current = true; setBusy(true); setError(''); setUsageLimited(false); setQuestion('');
    setMessages([...history, { role: 'assistant', content: '' }]);
    const position = history.length;
    try {
      return await runSceneAgent({ question: user.content, model, history: history.slice(0, -1),
        engine: { context: () => sceneWindow.studioContext?.(), viewImage: () => sceneWindow.studioViewImage!(), executeTool: (name, args) => sceneWindow.studioAgent!.executeTool(name, args) },
        cancelled: () => cancelled.current,
        onText: text => setMessages(current => current.map((m, i) => i === position ? { ...m, content: m.content + text } : m)),
        onTool: tool => {
          const action = tool.name === 'apply_action' ? tool.args.type : tool.name;
          setActivity(tool.result.ok ? action === 'place_asset' ? `Added ${tool.result.name ?? tool.result.assetId}.` : action === 'move_prop' ? 'Moved the object.' : action === 'delete_prop' ? 'Removed the object.' : action === 'use_scene' ? 'Loaded the starting set.' : 'Scene and library checked.' : `Could not edit: ${tool.result.error}`);
        },
      });
    } catch (e) {
      if (!(e instanceof AgentError) || e.code !== 'stopped') { setError(String(e)); setUsageLimited(e instanceof AgentError && e.usageLimited); }
      return null;
    }
    finally { active.current = false; setBusy(false); }
  }

  // Development-only entry point for the real signed-in native agent smoke test.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const host = window as Window & { studioTestAgent?: (text: string) => ReturnType<typeof send> };
    host.studioTestAgent = send;
    return () => { delete host.studioTestAgent; };
  });

  return <aside id="studio-chat" className="chat-pane" aria-label="ChatGPT conversation">
    <header className="chat-header"><div className="brand"><strong>Studio</strong><span>by tana</span></div><div className="chat-header-actions"><button disabled={busy || !messages.length} onClick={() => { setMessages([]); setError(''); setUsageLimited(false); }}>New chat</button><button className="chat-collapse" aria-label="Collapse chat" title="Collapse chat" aria-controls="studio-chat" aria-expanded={true} onClick={() => window.dispatchEvent(new Event('studio-toggle-chat'))}><DrawerIcon /></button></div></header>
    <div className="account">
      {account.status === 'signed_in' ? <><span>{account.email ?? 'Connected to ChatGPT'}</span><button disabled={busy || connecting} onClick={() => void accountAction('chatgpt_disconnect')}>Disconnect</button><select aria-label="ChatGPT model" value={model} disabled={busy || !models.length} onChange={e => setModel(e.target.value)}>{!models.length && <option value="">Loading models…</option>}{models.map(m => <option key={m.slug} value={m.slug}>{m.display_name}</option>)}</select></> : account.status === 'pending' ? <><span>Finish signing in in your browser.</span><button disabled={connecting} onClick={() => void accountAction('chatgpt_cancel')}>Cancel sign-in</button></> : <button className="primary" disabled={!native || connecting} onClick={() => void accountAction('chatgpt_start')}>Sign in with ChatGPT</button>}
    </div>
    <div className="messages" role="log" aria-label="Conversation messages" aria-live="polite">
      {!messages.length && <div className="welcome"><h1>A world for your story.</h1><p>Plan the scene, direct your characters, and find the right shot with ChatGPT beside you.</p><p>Build and record in the editor on the right.</p></div>}
      {messages.map((message, i) => <article className={`message ${message.role}`} key={i}><div className="speaker">{message.role === 'user' ? 'You' : 'ChatGPT'}</div><div className="content">{message.content ? <AnswerText text={message.content} /> : <p>{busy ? 'Thinking…' : 'No text response returned.'}</p>}</div></article>)}<div ref={end} />
    </div>
    {error && <p className="error" role="alert">{error}{usageLimited && <button onClick={() => void invoke('plugin:opener|open_url', { url: 'https://chatgpt.com/settings/usage' }).catch(e => setError(String(e)))}>Manage usage</button>}</p>}
    <form className="composer" onSubmit={e => { e.preventDefault(); void send(); }}>
      <textarea aria-label="Message ChatGPT" placeholder="Describe your story or plan a shot…" maxLength={8000} value={question} onChange={e => setQuestion(e.target.value)} disabled={busy} />
      <div className="composer-controls"><span>Scene, view & library connected</span>{busy ? <button type="button" onClick={() => { cancelled.current = true; void invoke('chatgpt_stop').catch(e => setError(String(e))); }}>Stop</button> : <button className="primary" type="submit" disabled={!native || !question.trim() || !model || account.status !== 'signed_in'}>Send</button>}</div>
      {activity && <p className="notice" role="status">{activity}</p>}
      <p className="notice">{!native ? 'Open the desktop app to connect ChatGPT.' : 'ChatGPT uses your plan and can edit the current scene.'}</p>
    </form>
  </aside>;
}
