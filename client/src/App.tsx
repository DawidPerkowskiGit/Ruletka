import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, PlayerView, PublicRoom, ServerMessage } from 'engine';
import { Home } from './home';
import { Lobby } from './lobby';
import { goHome, goToRoom, loadSession, roomCodeFromPath, saveSession, type Session } from './session';
import { Table } from './table';

type Conn = 'connecting' | 'open' | 'closed';

const PING_MS = 20_000;

export function App() {
  const [session, setSession] = useState<Session>(() => loadSession());
  const [conn, setConn] = useState<Conn>('connecting');
  const [view, setView] = useState<PlayerView | null>(null);
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [path, setPath] = useState(() => window.location.pathname);
  const [logOpen, setLogOpen] = useState(() => window.matchMedia('(min-width: 960px)').matches);

  const sessionRef = useRef(session);
  const viewRef = useRef(view);
  const pendingRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  sessionRef.current = session;
  viewRef.current = view;

  const remember = useCallback((next: Session) => {
    sessionRef.current = next;
    saveSession(next);
    setSession(next);
  }, []);

  const unlock = useCallback(() => {
    pendingRef.current = false;
    setPending(false);
  }, []);

  const send = useCallback(
    (message: ClientMessage, lock = false) => {
      let outgoing = message;
      if ((outgoing.type === 'create' || outgoing.type === 'join') && !outgoing.token) {
        outgoing = { ...outgoing, token: sessionRef.current.token };
      }
      if ((outgoing.type === 'create' || outgoing.type === 'join') && sessionRef.current.nick !== (outgoing.nick ?? '')) {
        remember({ ...sessionRef.current, nick: outgoing.nick });
      }
      if (lock) {
        if (pendingRef.current) return;
        pendingRef.current = true;
        setPending(true);
      }
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (lock) unlock();
        setError('Brak połączenia.');
        return;
      }
      socket.send(JSON.stringify(outgoing));
    },
    [remember, unlock],
  );

  useEffect(() => {
    const media = window.matchMedia('(max-width: 959px)');
    const apply = () => setLogOpen(!media.matches);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const current = viewRef.current;
      if (current && roomCodeFromPath() !== current.code) {
        window.history.pushState({}, '', `/gra/${current.code}`);
      }
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 500;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setConn('connecting');
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${proto}//${window.location.host}`);
      wsRef.current = socket;
      socket.onopen = () => {
        setConn('open');
        backoff = 500;
        const code = sessionRef.current.code;
        if (code) {
          goToRoom(code);
          setPath(`/gra/${code}`);
          socket?.send(JSON.stringify({ type: 'rejoin', code, token: sessionRef.current.token }));
        } else {
          socket?.send(JSON.stringify({ type: 'list' }));
        }
        if (ping) clearInterval(ping);
        ping = setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
        }, PING_MS);
      };
      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (message.type === 'pong' || message.type === 'rooms') {
          if (message.type === 'rooms') setRooms(message.rooms);
          return;
        }
        if (message.type === 'welcome') {
          const next = { ...sessionRef.current, token: message.token, code: message.code };
          remember(next);
          goToRoom(message.code);
          setPath(`/gra/${message.code}`);
          return;
        }
        if (message.type === 'view') {
          unlock();
          setError(null);
          setView(message.view);
          return;
        }
        if (message.type === 'left') {
          unlock();
          setView(null);
          remember({ ...sessionRef.current, code: null });
          goHome();
          setPath('/');
          return;
        }
        if (message.type === 'error') {
          unlock();
          setError(message.message);
          if (message.message.includes('Nie ma już tego miejsca') || message.message.includes('Stół już nie istnieje')) {
            setView(null);
            remember({ ...sessionRef.current, code: null });
          }
        }
      };
      socket.onclose = () => {
        if (ping) clearInterval(ping);
        if (wsRef.current === socket) wsRef.current = null;
        unlock();
        setConn('closed');
        if (!stopped) {
          retry = setTimeout(connect, backoff);
          backoff = Math.min(5000, Math.round(backoff * 1.5));
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      socket?.close();
    };
  }, [remember, unlock]);

  const urlCode = roomCodeFromPath(path);
  let body;
  if (view?.phase === 'lobby') body = <Lobby view={view} pending={pending} send={send} />;
  else if (view) body = <Table view={view} pending={pending} logOpen={logOpen} send={send} />;
  else if (session.code && conn !== 'closed') body = <p className="wait">Wracam do stołu…</p>;
  else {
    body = (
      <Home
        nick={session.nick}
        urlCode={urlCode}
        rooms={rooms}
        pending={pending}
        onNick={(nick) => remember({ ...sessionRef.current, nick })}
        send={send}
      />
    );
  }

  return (
    <div className={`app${view && view.phase !== 'lobby' ? ' in-game' : ''}`} data-phase={view?.phase ?? 'home'} data-pending={pending ? '1' : '0'} data-revision={view?.revision ?? 0}>
      <header className="topbar">
        <div className="brand">Ruletka</div>
        <span className={`conn ${conn}`} data-testid="conn">
          {conn === 'open' ? 'Połączono' : conn === 'connecting' ? 'Łączę' : 'Rozłączono'}
        </span>
        {view && view.phase !== 'lobby' ? (
          <button type="button" className="log-toggle" data-testid="log-toggle" onClick={() => setLogOpen((open) => !open)}>
            {logOpen ? 'Zamknij log' : 'Log partii'}
          </button>
        ) : null}
      </header>
      {error ? (
        <p className="error" role="alert" data-testid="error">
          {error}
        </p>
      ) : null}
      {body}
    </div>
  );
}
