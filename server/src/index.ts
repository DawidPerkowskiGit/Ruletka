import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addPlayer,
  applyAction,
  chooseAction,
  createRoom,
  isCard,
  kickPlayer,
  leaveLobby,
  leaveSeat,
  listPublic,
  project,
  endGame,
  rematch,
  resignGame,
  setReady,
  setTableSize,
  startGame,
  timeoutPlayer,
  type Card,
  type ClientMessage,
  type GameAction,
  type GameState,
  type RoomState,
  type ServerMessage,
} from 'engine';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

const RECONNECT_MS = 90_000;
const HOST = '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../../client/dist');

interface Live {
  room: RoomState;
  conns: Map<string, WebSocket>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  aiTimer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Live>();
const binding = new WeakMap<WebSocket, { code: string; playerId: string }>();
const watchers = new Set<WebSocket>();

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function connectedIds(live: Live): Set<string> {
  const ids = new Set<string>();
  for (const [id, ws] of live.conns) {
    if (ws.readyState === WebSocket.OPEN) ids.add(id);
  }
  return ids;
}

function broadcast(live: Live): void {
  const ids = connectedIds(live);
  for (const [id, ws] of live.conns) {
    send(ws, { type: 'view', view: project(live.room, id, ids) });
  }
  scheduleAi(live);
}

const AI_MS = 700;

function scheduleAi(live: Live): void {
  if (live.aiTimer) clearTimeout(live.aiTimer);
  live.aiTimer = null;
  const game = live.room.game;
  if (!game || game.phase !== 'playing' || game.currentIndex === null) return;
  const current = game.players[game.currentIndex];
  if (!current || !live.room.players.some((player) => player.id === current.id && player.ai)) return;
  const playerId = current.id;
  live.aiTimer = setTimeout(() => {
    live.aiTimer = null;
    const now = live.room.game;
    if (!now || now.phase !== 'playing' || now.currentIndex === null) return;
    const seat = now.players[now.currentIndex];
    if (!seat || seat.id !== playerId) return;
    const action = chooseAction(now, playerId);
    if (!action) return;
    const played = applyAction(now, playerId, action);
    if (!played.ok) return;
    live.room = { ...live.room, game: played.value, phase: played.value.phase, revision: live.room.revision + 1 };
    broadcast(live);
  }, AI_MS);
}

function pushLists(): void {
  const message: ServerMessage = {
    type: 'rooms',
    rooms: listPublic([...rooms.values()].map((live) => live.room)),
  };
  for (const ws of watchers) send(ws, message);
}

function rng(): number {
  return randomBytes(4).readUInt32BE(0) / 0x1_0000_0000;
}

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 30; attempt++) {
    const bytes = randomBytes(6);
    let code = '';
    for (let index = 0; index < 6; index++) code += alphabet[bytes[index]! % alphabet.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Brak wolnego kodu stołu');
}

function clearTimer(live: Live, playerId: string): void {
  const timer = live.timers.get(playerId);
  if (timer) clearTimeout(timer);
  live.timers.delete(playerId);
}

function bind(ws: WebSocket, live: Live, playerId: string): void {
  const previous = live.conns.get(playerId);
  live.conns.set(playerId, ws);
  binding.set(ws, { code: live.room.code, playerId });
  clearTimer(live, playerId);
  watchers.delete(ws);
  if (previous && previous !== ws) {
    binding.delete(previous);
    previous.close();
  }
}

function welcome(ws: WebSocket, live: Live, playerId: string, token: string): void {
  bind(ws, live, playerId);
  send(ws, { type: 'welcome', token, code: live.room.code, playerId });
  broadcast(live);
  pushLists();
}

function unbind(ws: WebSocket): void {
  const bound = binding.get(ws);
  if (!bound) return;
  const live = rooms.get(bound.code);
  binding.delete(ws);
  if (!live || live.conns.get(bound.playerId) !== ws) return;
  live.conns.delete(bound.playerId);
  broadcast(live);
  const timer = setTimeout(() => {
    live.timers.delete(bound.playerId);
    if (live.conns.has(bound.playerId)) return;
    const current = rooms.get(bound.code);
    if (!current) return;
    const result = timeoutPlayer(current.room, bound.playerId);
    if (!result.ok) return;
    current.room = result.value;
    if (current.room.players.length === 0) {
      rooms.delete(bound.code);
      pushLists();
      return;
    }
    broadcast(current);
    pushLists();
  }, RECONNECT_MS);
  live.timers.set(bound.playerId, timer);
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

function isCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{6}$/.test(value.trim().toUpperCase());
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 4 && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 80);
}

function parseAction(value: unknown): GameAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as { type?: unknown; cardIds?: unknown; handCardIds?: unknown; faceUpId?: unknown; cardId?: unknown; slot?: unknown };
  if (action.type === 'takePile') return { type: 'takePile' };
  if (action.type === 'playHand' && isIdList(action.cardIds)) return { type: 'playHand', cardIds: action.cardIds };
  if (action.type === 'playWayB' && isIdList(action.handCardIds) && typeof action.faceUpId === 'string') {
    return { type: 'playWayB', handCardIds: action.handCardIds, faceUpId: action.faceUpId };
  }
  if (action.type === 'playFaceUp' && typeof action.cardId === 'string') return { type: 'playFaceUp', cardId: action.cardId };
  if ((action.type === 'playFaceDown' || action.type === 'takeFaceDown') && (action.slot === 0 || action.slot === 1 || action.slot === 2)) {
    return { type: action.type, slot: action.slot };
  }
  return null;
}

function parseMessage(value: unknown): ClientMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'ping':
    case 'list':
    case 'ready':
    case 'start':
    case 'leave':
    case 'rematch':
    case 'endGame':
    case 'resign':
      return { type: message.type };
    case 'create':
      if ((message.visibility !== 'public' && message.visibility !== 'private') || typeof message.nick !== 'string' || message.nick.length > 40 || !isToken(message.token)) {
        return null;
      }
      if (message.ai === true) {
        const seats = message.seats === undefined ? 3 : message.seats;
        if (typeof seats !== 'number' || !Number.isInteger(seats) || seats < 3 || seats > 6) return null;
        return { type: 'create', nick: message.nick, visibility: message.visibility, token: message.token, ai: true, seats };
      }
      return { type: 'create', nick: message.nick, visibility: message.visibility, token: message.token };
    case 'join':
      if (!isCode(message.code) || typeof message.nick !== 'string' || message.nick.length > 40 || !isToken(message.token)) return null;
      return { type: 'join', code: String(message.code).trim().toUpperCase(), nick: message.nick, token: message.token };
    case 'rejoin':
      if (!isCode(message.code) || !isToken(message.token)) return null;
      return { type: 'rejoin', code: String(message.code).trim().toUpperCase(), token: message.token };
    case 'kick':
      if (typeof message.playerId !== 'string' || message.playerId.length > 80) return null;
      return { type: 'kick', playerId: message.playerId };
    case 'setTable':
      if (typeof message.seats !== 'number' || !Number.isInteger(message.seats)) return null;
      return { type: 'setTable', seats: message.seats };
    case 'action': {
      const action = parseAction(message.action);
      return action ? { type: 'action', action } : null;
    }
    default:
      return null;
  }
}

function seated(ws: WebSocket): { live: Live; playerId: string } | null {
  const bound = binding.get(ws);
  if (!bound) {
    send(ws, { type: 'error', message: 'Nie siedzisz przy stole.' });
    return null;
  }
  const live = rooms.get(bound.code);
  if (!live) {
    send(ws, { type: 'error', message: 'Stół już nie istnieje.' });
    return null;
  }
  return { live, playerId: bound.playerId };
}

function commit(ws: WebSocket, live: Live, result: { ok: true; value: RoomState } | { ok: false; error: string }): void {
  if (!result.ok) {
    send(ws, { type: 'error', message: result.error });
    return;
  }
  live.room = result.value;
  broadcast(live);
  pushLists();
}

function release(ws: WebSocket, live: Live, playerId: string): void {
  live.conns.delete(playerId);
  binding.delete(ws);
  clearTimer(live, playerId);
  watchers.add(ws);
}

function handle(ws: WebSocket, message: ClientMessage): void {
  if (message.type === 'ping') {
    send(ws, { type: 'pong' });
    return;
  }
  if (message.type === 'list') {
    watchers.add(ws);
    pushLists();
    send(ws, { type: 'rooms', rooms: listPublic([...rooms.values()].map((live) => live.room)) });
    return;
  }
  if (message.type === 'create') {
    if (binding.has(ws)) {
      send(ws, { type: 'error', message: 'Najpierw wyjdź ze stołu.' });
      return;
    }
    const code = makeCode();
    const id = randomUUID();
    const created = createRoom({
      code,
      visibility: message.visibility,
      host: { id, token: message.token, nick: message.nick },
      withAi: message.ai === true,
      tableSize: message.seats,
    });
    if (!created.ok) {
      send(ws, { type: 'error', message: created.error });
      return;
    }
    const live: Live = { room: created.value, conns: new Map(), timers: new Map(), aiTimer: null };
    rooms.set(code, live);
    welcome(ws, live, id, message.token);
    return;
  }
  if (message.type === 'join') {
    const live = rooms.get(message.code);
    if (!live) {
      send(ws, { type: 'error', message: 'Nie ma takiego stołu.' });
      return;
    }
    const existing = live.room.players.find((player) => player.token === message.token);
    if (existing) {
      welcome(ws, live, existing.id, existing.token);
      return;
    }
    if (binding.has(ws)) {
      send(ws, { type: 'error', message: 'Najpierw wyjdź ze stołu.' });
      return;
    }
    const id = randomUUID();
    const joined = addPlayer(live.room, { id, token: message.token, nick: message.nick });
    if (!joined.ok) {
      send(ws, { type: 'error', message: joined.error });
      return;
    }
    live.room = joined.value;
    welcome(ws, live, id, message.token);
    return;
  }
  if (message.type === 'rejoin') {
    const live = rooms.get(message.code);
    const existing = live?.room.players.find((player) => player.token === message.token);
    if (!live || !existing) {
      send(ws, { type: 'error', message: 'Nie ma już tego miejsca przy stole.' });
      return;
    }
    welcome(ws, live, existing.id, existing.token);
    return;
  }

  const context = seated(ws);
  if (!context) return;
  const { live, playerId } = context;

  if (message.type === 'ready') {
    commit(ws, live, setReady(live.room, playerId));
    return;
  }
  if (message.type === 'start') {
    commit(ws, live, startGame(live.room, playerId, rng));
    return;
  }
  if (message.type === 'setTable') {
    commit(ws, live, setTableSize(live.room, playerId, message.seats));
    return;
  }
  if (message.type === 'rematch') {
    commit(ws, live, rematch(live.room, playerId, rng));
    return;
  }
  if (message.type === 'endGame') {
    commit(ws, live, endGame(live.room, playerId));
    return;
  }
  if (message.type === 'resign') {
    commit(ws, live, resignGame(live.room, playerId));
    return;
  }
  if (message.type === 'kick') {
    const result = kickPlayer(live.room, playerId, message.playerId);
    if (!result.ok) {
      send(ws, { type: 'error', message: result.error });
      return;
    }
    const kicked = live.conns.get(message.playerId);
    live.room = result.value;
    if (kicked) {
      release(kicked, live, message.playerId);
      send(kicked, { type: 'error', message: 'Gospodarz usunął cię ze stołu.' });
      send(kicked, { type: 'left' });
    }
    broadcast(live);
    pushLists();
    return;
  }
  if (message.type === 'leave') {
    const result = leaveSeat(live.room, playerId);
    if (!result.ok) {
      send(ws, { type: 'error', message: result.error });
      return;
    }
    release(ws, live, playerId);
    live.room = result.value;
    send(ws, { type: 'left' });
    if (!live.room.players.some((player) => !player.ai)) {
      if (live.aiTimer) clearTimeout(live.aiTimer);
      rooms.delete(live.room.code);
    } else broadcast(live);
    pushLists();
    return;
  }
  if (message.type === 'action') {
    if (!live.room.game) {
      send(ws, { type: 'error', message: 'Partia jeszcze się nie zaczęła.' });
      return;
    }
    const played = applyAction(live.room.game, playerId, message.action);
    if (!played.ok) {
      send(ws, { type: 'error', message: played.error });
      return;
    }
    live.room = { ...live.room, game: played.value, phase: played.value.phase, revision: live.room.revision + 1 };
    broadcast(live);
  }
}

function takeCard(card: unknown, seen: Set<string>): Card | null {
  if (!isCard(card) || seen.has(card.id)) return null;
  seen.add(card.id);
  return card;
}

function trialGame(body: unknown, room: RoomState): GameState | null {
  if (!body || typeof body !== 'object') return null;
  const game = body as GameState;
  if (!Array.isArray(game.players) || game.players.length !== room.players.length) return null;
  const expected = new Set(room.players.map((player) => player.id));
  const seenPlayers = new Set<string>();
  const seenCards = new Set<string>();
  for (const seat of game.players) {
    if (!seat || typeof seat.id !== 'string' || !expected.has(seat.id) || seenPlayers.has(seat.id)) return null;
    seenPlayers.add(seat.id);
    if (!Array.isArray(seat.hand) || !Array.isArray(seat.faceUp) || !Array.isArray(seat.faceDown)) return null;
    if (seat.faceUp.length !== 3 || seat.faceDown.length !== 3) return null;
    if (typeof seat.dropped !== 'boolean') return null;
    if (seat.exitedPlace !== null && typeof seat.exitedPlace !== 'number') return null;
    for (const card of seat.hand) if (!takeCard(card, seenCards)) return null;
    for (const card of seat.faceUp) if (card !== null && !takeCard(card, seenCards)) return null;
    for (const card of seat.faceDown) if (card !== null && !takeCard(card, seenCards)) return null;
    const official = room.players.find((player) => player.id === seat.id);
    if (official) seat.nick = official.nick;
  }
  if (!Array.isArray(game.center)) return null;
  for (const card of game.center) if (!takeCard(card, seenCards)) return null;
  if (game.reveal != null) {
    if (!takeCard(game.reveal.card, seenCards)) return null;
    if (game.reveal.outcome !== 'low' && game.reveal.outcome !== 'burn' && game.reveal.outcome !== 'play') return null;
  } else {
    game.reveal = null;
  }
  if (game.phase !== 'playing' && game.phase !== 'finished') return null;
  if (game.currentIndex !== null) {
    if (!Number.isInteger(game.currentIndex) || game.currentIndex < 0 || game.currentIndex >= game.players.length) return null;
  }
  if (typeof game.burnedCount !== 'number' || typeof game.outCount !== 'number') return null;
  if (!Array.isArray(game.exitOrder) || !Array.isArray(game.log)) return null;
  if (!game.log.every((entry) => entry && typeof entry.id === 'number' && typeof entry.text === 'string')) return null;
  if (game.loserId !== null && typeof game.loserId !== 'string') return null;
  if (typeof game.startIndex !== 'number') game.startIndex = 0;
  return game;
}

if (!existsSync(path.join(clientDir, 'index.html'))) {
  console.error(`Brak buildu klienta (${clientDir}). Uruchom npm run build.`);
  process.exit(1);
}

const app = express();
app.get('/health', (_req, res) => {
  res.status(200).type('text/plain').send('ok');
});

if (process.env.TRIAL_HOOK === '1') {
  app.post('/__trial/state', express.json({ limit: '300kb' }), (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const live = rooms.get(code);
    if (!live) {
      res.status(404).json({ error: 'brak stołu' });
      return;
    }
    const game = trialGame(req.body?.game, live.room);
    if (!game) {
      res.status(400).json({ error: 'zły stan' });
      return;
    }
    live.room = { ...live.room, game, phase: game.phase, revision: live.room.revision + 1 };
    broadcast(live);
    res.status(200).json({ ok: true });
  });
}

app.use(express.static(clientDir, { index: false }));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  watchers.add(ws);
  ws.on('message', (data) => {
    let parsed: ClientMessage | null = null;
    try {
      parsed = parseMessage(JSON.parse(data.toString()));
    } catch {
      send(ws, { type: 'error', message: 'Zły komunikat.' });
      return;
    }
    if (!parsed) {
      send(ws, { type: 'error', message: 'Zły komunikat.' });
      return;
    }
    handle(ws, parsed);
  });
  ws.on('close', () => {
    watchers.delete(ws);
    unbind(ws);
  });
  send(ws, { type: 'rooms', rooms: listPublic([...rooms.values()].map((live) => live.room)) });
});

if (!Number.isInteger(port) || port <= 0) {
  console.error('Zły PORT');
  process.exit(1);
}

server.listen(port, HOST, () => {
  console.log(`Ruletka nasłuchuje na ${HOST}:${port}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
