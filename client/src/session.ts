const TAB_KEY = 'ruletka-tab';

export interface Session {
  token: string;
  code: string | null;
  nick: string;
}

function tabId(): string {
  let id = sessionStorage.getItem(TAB_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_KEY, id);
  }
  return id;
}

function storageKey(): string {
  return `ruletka:${tabId()}`;
}

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Session>;
      if (parsed && typeof parsed.token === 'string' && parsed.token) {
        return { token: parsed.token, code: parsed.code ?? null, nick: parsed.nick ?? '' };
      }
    }
  } catch {
    /* uszkodzony zapis */
  }
  const fresh: Session = { token: crypto.randomUUID(), code: null, nick: '' };
  localStorage.setItem(storageKey(), JSON.stringify(fresh));
  return fresh;
}

export function saveSession(session: Session): void {
  localStorage.setItem(storageKey(), JSON.stringify(session));
}

export function roomCodeFromPath(pathname = window.location.pathname): string | null {
  const match = pathname.match(/^\/gra\/([A-Za-z0-9]{6})\/?$/);
  return match ? match[1]!.toUpperCase() : null;
}

export function goToRoom(code: string): void {
  const next = `/gra/${code}`;
  if (window.location.pathname !== next) window.history.pushState({}, '', next);
}

export function goHome(): void {
  if (window.location.pathname !== '/') window.history.pushState({}, '', '/');
}
