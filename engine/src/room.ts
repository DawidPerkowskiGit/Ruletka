import { sanitizeNick } from './cards.js';
import { dealGame, dropOut } from './game.js';
import { MAX_PLAYERS, MIN_PLAYERS, type PublicRoom, type Result, type RoomState } from './types.js';

export interface Identity {
  id: string;
  token: string;
  nick: string;
}

function fail(error: string): Result<RoomState> {
  return { ok: false, error };
}

function touch(room: RoomState): RoomState {
  return { ...room, revision: room.revision + 1 };
}

export function createRoom(options: {
  code: string;
  visibility: 'public' | 'private';
  host: Identity;
}): Result<RoomState> {
  const nick = sanitizeNick(options.host.nick);
  if (!nick) return fail('Podaj nick (do 20 znaków, bez HTML).');
  if (options.visibility !== 'public' && options.visibility !== 'private') return fail('Wybierz rodzaj stołu.');
  const room: RoomState = {
    code: options.code,
    visibility: options.visibility,
    hostId: options.host.id,
    players: [{ id: options.host.id, token: options.host.token, nick, ready: false }],
    phase: 'lobby',
    game: null,
    revision: 1,
  };
  return { ok: true, value: room };
}

export function addPlayer(room: RoomState, player: Identity): Result<RoomState> {
  const nick = sanitizeNick(player.nick);
  if (!nick) return fail('Podaj nick (do 20 znaków, bez HTML).');
  if (room.players.some((seat) => seat.token === player.token || seat.id === player.id)) {
    return fail('Już siedzisz przy tym stole.');
  }
  if (room.phase === 'playing') return fail('Partia już trwa.');
  if (room.players.length >= MAX_PLAYERS) return fail('Stół jest pełny (6 miejsc).');
  const next = touch(room);
  next.players = [...room.players, { id: player.id, token: player.token, nick, ready: false }];
  return { ok: true, value: next };
}

export function setReady(room: RoomState, playerId: string): Result<RoomState> {
  if (room.phase !== 'lobby') return fail('Gotowość dotyczy tylko poczekalni.');
  const index = room.players.findIndex((seat) => seat.id === playerId);
  if (index < 0) return fail('Nie ma cię przy stole.');
  const next = touch(room);
  next.players = room.players.map((seat) => (seat.id === playerId ? { ...seat, ready: !seat.ready } : seat));
  return { ok: true, value: next };
}

export function kickPlayer(room: RoomState, byId: string, targetId: string): Result<RoomState> {
  if (room.phase !== 'lobby') return fail('W trakcie partii nie wyrzucisz gracza.');
  if (byId !== room.hostId) return fail('Tylko gospodarz wyrzuca graczy.');
  if (byId === targetId) return fail('Nie wyrzucisz samego siebie.');
  if (!room.players.some((seat) => seat.id === targetId)) return fail('Nie ma takiego gracza.');
  const players = room.players.filter((seat) => seat.id !== targetId);
  const next = touch(room);
  next.players = players;
  return { ok: true, value: next };
}

export function leaveLobby(room: RoomState, playerId: string): Result<RoomState> {
  if (room.phase !== 'lobby') return fail('W trakcie partii wyjście to rozłączenie.');
  if (!room.players.some((seat) => seat.id === playerId)) return fail('Nie ma cię przy stole.');
  const players = room.players.filter((seat) => seat.id !== playerId);
  const next = touch(room);
  next.players = players;
  if (next.hostId === playerId) next.hostId = players[0]?.id ?? '';
  return { ok: true, value: next };
}

export function startGame(room: RoomState, playerId: string, rng: () => number): Result<RoomState> {
  if (playerId !== room.hostId) return fail('Tylko gospodarz zaczyna.');
  if (room.phase !== 'lobby' || room.game) return fail('Partia już trwa.');
  if (room.players.length < MIN_PLAYERS) return fail('Potrzeba co najmniej 3 graczy.');
  if (room.players.length > MAX_PLAYERS) return fail('Za dużo graczy.');
  const game = dealGame(
    room.players.map((seat) => ({ id: seat.id, nick: seat.nick })),
    rng,
  );
  const next = touch(room);
  next.phase = 'playing';
  next.game = game;
  return { ok: true, value: next };
}

export function rematch(room: RoomState, playerId: string, rng: () => number): Result<RoomState> {
  if (playerId !== room.hostId) return fail('Tylko gospodarz rozdaje jeszcze raz.');
  if (room.phase !== 'finished') return fail('Partia jeszcze trwa.');
  if (room.players.length < MIN_PLAYERS) return fail('Potrzeba co najmniej 3 graczy.');
  const game = dealGame(
    room.players.map((seat) => ({ id: seat.id, nick: seat.nick })),
    rng,
  );
  const next = touch(room);
  next.phase = 'playing';
  next.game = game;
  next.players = room.players.map((seat) => ({ ...seat, ready: false }));
  return { ok: true, value: next };
}

export function timeoutPlayer(room: RoomState, playerId: string): Result<RoomState> {
  if (!room.players.some((seat) => seat.id === playerId)) return fail('Nie ma takiego gracza.');
  if (room.phase === 'lobby') return leaveLobby(room, playerId);
  if (room.phase === 'playing' && room.game) {
    const game = dropOut(room.game, playerId);
    const next = touch(room);
    next.game = game;
    next.phase = game.phase;
    return { ok: true, value: next };
  }
  return { ok: true, value: room };
}

export function listPublic(rooms: readonly RoomState[]): PublicRoom[] {
  return rooms
    .filter((room) => room.visibility === 'public' && room.phase === 'lobby')
    .map((room) => ({
      code: room.code,
      hostNick: room.players.find((seat) => seat.id === room.hostId)?.nick ?? '',
      seats: room.players.length,
      max: 6 as const,
    }));
}
