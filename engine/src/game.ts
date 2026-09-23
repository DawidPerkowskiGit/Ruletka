import { canPlaySingle, cardLabel, createDeck, isBurn, kartyPhrase, openingKey, shuffle } from './cards.js';
import {
  EMPTY_LEGAL,
  MIN_PLAYERS,
  MAX_PLAYERS,
  type Card,
  type GameAction,
  type GameState,
  type Legal,
  type LogPart,
  type Rank,
  type Result,
  type Seat,
} from './types.js';

type LogPiece = string | Card;

export interface DealPlayer {
  id: string;
  nick: string;
}

function emptySlots(): (Card | null)[] {
  return [null, null, null];
}

function pushLog(state: GameState, pieces: LogPiece[]): void {
  const id = (state.log.at(-1)?.id ?? 0) + 1;
  const parts: LogPart[] = pieces.map((piece) =>
    typeof piece === 'string'
      ? { type: 'text', text: piece }
      : { type: 'card', card: { id: piece.id, suit: piece.suit, rank: piece.rank } },
  );
  const text = pieces.map((piece) => (typeof piece === 'string' ? piece : cardLabel(piece))).join('');
  state.log.push({ id, text, parts });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

function playPieces(nick: string, cards: readonly Card[], verb: 'kładzie' | 'odsłania'): LogPiece[] {
  if (cards.length === 1) return [`${nick} ${verb} `, cards[0]!];
  const pieces: LogPiece[] = [`${nick} kładzie cztery karty (`];
  cards.forEach((card, index) => {
    if (index > 0) pieces.push(', ');
    pieces.push(card);
  });
  pieces.push(')');
  return pieces;
}

export function hasCards(seat: Seat): boolean {
  if (seat.dropped) return false;
  if (seat.hand.length > 0) return true;
  if (seat.faceUp.some((card) => card !== null)) return true;
  if (seat.faceDown.some((card) => card !== null)) return true;
  return false;
}

function seatIndex(state: GameState, seat: Seat): number {
  return state.players.findIndex((player) => player.id === seat.id);
}

export function nextIndex(state: GameState, from: number): number | null {
  const count = state.players.length;
  for (let step = 1; step <= count; step++) {
    const index = (from + step) % count;
    if (hasCards(state.players[index]!)) return index;
  }
  return null;
}

function living(state: GameState): Seat[] {
  return state.players.filter((seat) => hasCards(seat));
}

function markExit(state: GameState, seat: Seat): void {
  if (seat.exitedPlace !== null) return;
  const place = state.exitOrder.length + 1;
  seat.exitedPlace = place;
  state.exitOrder.push(seat.id);
  pushLog(state, [`${seat.nick} wychodzi (miejsce ${place}).`]);
}

export function resign(state: GameState, playerId: string): Result<GameState> {
  if (state.phase !== 'playing') return fail('Partia już się skończyła.');
  const left = living(state);
  if (left.length !== 2) return fail('Poddać się można tylko w pojedynku.');
  const seat = left.find((player) => player.id === playerId);
  if (!seat) return fail('Nie bierzesz udziału w pojedynku.');
  const rival = left.find((player) => player.id !== playerId)!;
  const next: GameState = structuredClone(state);
  next.reveal = null;
  next.handNote = null;
  const winner = next.players.find((player) => player.id === rival.id)!;
  const place = next.exitOrder.length + 1;
  winner.exitedPlace = place;
  next.exitOrder.push(winner.id);
  next.phase = 'finished';
  next.loserId = playerId;
  next.currentIndex = null;
  pushLog(next, [`${seat.nick} poddaje się. ${rival.nick} wygrywa pojedynek (miejsce ${place}).`]);
  return { ok: true, value: next };
}

export function abortGame(state: GameState): Result<GameState> {
  if (state.phase !== 'playing') return fail('Partia już się skończyła.');
  const next: GameState = structuredClone(state);
  next.reveal = null;
  next.handNote = null;
  next.phase = 'finished';
  next.currentIndex = null;
  pushLog(next, ['Gospodarz zakończył partię.']);
  return { ok: true, value: next };
}

function closeIfLast(state: GameState): void {
  if (state.phase !== 'playing') return;
  const left = living(state);
  if (left.length > 1) return;
  state.phase = 'finished';
  state.loserId = left[0]?.id ?? null;
  state.currentIndex = null;
  if (left[0]) pushLog(state, [`${left[0].nick} przegrywa.`]);
}

function sameRank(cards: readonly Card[]): boolean {
  return cards.length > 0 && cards.every((card) => card.rank === cards[0]?.rank);
}

function pullHand(seat: Seat, ids: readonly string[]): Card[] | null {
  if (new Set(ids).size !== ids.length) return null;
  const remaining = seat.hand.slice();
  const picked: Card[] = [];
  for (const id of ids) {
    const index = remaining.findIndex((card) => card.id === id);
    if (index < 0) return null;
    picked.push(remaining[index]!);
    remaining.splice(index, 1);
  }
  seat.hand = remaining;
  return picked;
}

function wayBOf(seat: Seat): { handIds: string[]; faceUpId: string } | null {
  if (seat.hand.length !== 3) return null;
  if (!sameRank(seat.hand)) return null;
  const rank = seat.hand[0]!.rank;
  const face = seat.faceUp.find((card) => card !== null && card.rank === rank);
  if (!face) return null;
  return { handIds: seat.hand.map((card) => card.id), faceUpId: face.id };
}

function quadsOf(hand: readonly Card[]): string[][] {
  const groups = new Map<Rank, Card[]>();
  for (const card of hand) {
    const list = groups.get(card.rank) ?? [];
    list.push(card);
    groups.set(card.rank, list);
  }
  const quads: string[][] = [];
  for (const list of groups.values()) {
    if (list.length === 4) quads.push(list.map((card) => card.id));
  }
  return quads;
}

export function legalActions(state: GameState, playerId: string): Legal {
  if (state.phase !== 'playing' || state.currentIndex === null) return { ...EMPTY_LEGAL, quads: [] };
  const seat = state.players[state.currentIndex];
  if (!seat || seat.id !== playerId || seat.dropped || seat.exitedPlace !== null) {
    return { ...EMPTY_LEGAL, quads: [] };
  }
  if (seat.hand.length > 0) {
    const singles = seat.hand.filter((card) => canPlaySingle(card, state.center)).map((card) => card.id);
    const quads = quadsOf(seat.hand);
    const wayB = wayBOf(seat);
    return { singles, quads, wayB, takePile: state.center.length > 0, faceUp: [], faceDownSlots: [] };
  }
  const faceUp = seat.faceUp.flatMap((card) => (card ? [card.id] : []));
  const takePile = state.center.length > 0;
  if (faceUp.length > 0) {
    return { singles: [], quads: [], wayB: null, takePile, faceUp, faceDownSlots: [] };
  }
  const faceDownSlots = seat.faceDown.flatMap((card, index) => (card ? [index] : []));
  return { singles: [], quads: [], wayB: null, takePile, faceUp: [], faceDownSlots };
}

function ownedCards(seat: Seat): Card[] {
  return [...seat.hand, ...seat.faceUp.filter((card): card is Card => card !== null), ...seat.faceDown.filter((card): card is Card => card !== null)];
}

export function lowestOpening(seats: readonly Seat[]): { index: number; card: Card } {
  let bestIndex = 0;
  let best: Card | null = null;
  seats.forEach((seat, index) => {
    for (const card of ownedCards(seat)) {
      if (!best || openingKey(card) < openingKey(best)) {
        best = card;
        bestIndex = index;
      }
    }
  });
  if (!best) throw new Error('Brak kart do otwarcia');
  return { index: bestIndex, card: best };
}

function commitPlay(state: GameState, seat: Seat, cards: Card[], verb: 'kładzie' | 'odsłania' = 'kładzie'): void {
  const from = seatIndex(state, seat);
  const base = playPieces(seat.nick, cards, verb);
  if (isBurn(cards)) {
    const removed = state.center.length + cards.length;
    state.burnedCount += removed;
    state.center = [];
    const stays = hasCards(seat);
    pushLog(state, [...base, ` i kasuje stos (${kartyPhrase(removed)}).${stays ? ' Gra dalej.' : ''}`]);
    if (!stays) {
      markExit(state, seat);
      state.currentIndex = nextIndex(state, from);
    }
  } else {
    state.center.push(...cards);
    pushLog(state, [...base, '.']);
    if (!hasCards(seat)) markExit(state, seat);
    state.currentIndex = nextIndex(state, from);
  }
  closeIfLast(state);
}

function punish(state: GameState, seat: Seat, card: Card, source: 'up' | 'down'): void {
  const from = seatIndex(state, seat);
  const taken = state.center.length + 1;
  seat.hand.push(...state.center, card);
  state.center = [];
  if (source === 'down') state.reveal = { card, outcome: 'low' };
  const verb = source === 'down' ? 'odsłania ' : 'gra odkrytą ';
  pushLog(state, [`${seat.nick} ${verb}`, card, `. Za niska — bierze kupkę i tę kartę (${kartyPhrase(taken)}).`]);
  state.currentIndex = nextIndex(state, from);
  closeIfLast(state);
}

function fail(error: string): Result<GameState> {
  return { ok: false, error };
}

export function dealGame(players: readonly DealPlayer[], rng: () => number, startIndex?: number): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error('Zła liczba graczy');
  }
  const count = players.length;
  const start = startIndex ?? Math.floor(rng() * count);
  if (!Number.isInteger(start) || start < 0 || start >= count) {
    throw new Error('Zły pierwszy gracz');
  }
  const deck = shuffle(createDeck(), rng);
  const seats: Seat[] = players.map((player) => ({
    id: player.id,
    nick: player.nick,
    hand: [],
    faceDown: emptySlots(),
    faceUp: emptySlots(),
    exitedPlace: null,
    dropped: false,
  }));

  for (let round = 0; round < 3; round++) {
    for (let offset = 0; offset < count; offset++) {
      seats[(start + offset) % count]!.faceDown[round] = deck.pop()!;
    }
  }
  for (let round = 0; round < 3; round++) {
    for (let offset = 0; offset < count; offset++) {
      seats[(start + offset) % count]!.faceUp[round] = deck.pop()!;
    }
  }
  let dealt = 0;
  while (deck.length > 0) {
    seats[(start + dealt) % count]!.hand.push(deck.pop()!);
    dealt++;
  }

  const opener = lowestOpening(seats);
  const state: GameState = {
    players: seats,
    startIndex: start,
    currentIndex: opener.index,
    center: [],
    burnedCount: 0,
    outCount: 0,
    phase: 'playing',
    exitOrder: [],
    loserId: null,
    log: [],
    reveal: null,
    handNote: null,
  };
  pushLog(state, [`${seats[opener.index]!.nick} zaczyna — ma najniższą kartę (`, opener.card, `). Środek jest pusty.`]);
  return state;
}

export function burnStalemate(state: GameState): Result<GameState> {
  if (state.phase !== 'playing' || state.currentIndex === null) return fail('Partia już się skończyła.');
  if (state.center.length === 0) return fail('Środek jest pusty.');
  const next: GameState = structuredClone(state);
  const removed = next.center.length;
  next.burnedCount += removed;
  next.center = [];
  next.reveal = null;
  next.handNote = null;
  pushLog(next, [`Komputery powtarzają układ — stos spalony (${kartyPhrase(removed)}).`]);
  return { ok: true, value: next };
}

export function applyAction(state: GameState, playerId: string, action: GameAction): Result<GameState> {
  if (state.phase !== 'playing' || state.currentIndex === null) return fail('Partia już się skończyła.');
  const current = state.players[state.currentIndex];
  if (!current || current.id !== playerId) return fail('Nie twoja tura.');
  if (current.dropped || current.exitedPlace !== null) return fail('Nie grasz już w tej partii.');

  const next: GameState = structuredClone(state);
  const seat = next.players[next.currentIndex!]!;
  next.reveal = null;
  next.handNote = null;

  if (action.type === 'takePile') {
    const legal = legalActions(next, playerId);
    if (!legal.takePile) return fail('Środek jest pusty.');
    const taken = next.center.length;
    seat.hand.push(...next.center);
    next.center = [];
    pushLog(next, [`${seat.nick} bierze kupkę (${kartyPhrase(taken)}).`]);
    next.currentIndex = nextIndex(next, next.currentIndex!);
    closeIfLast(next);
    return { ok: true, value: next };
  }

  if (action.type === 'playHand') {
    if (seat.hand.length === 0) return fail('Ręka jest pusta.');
    const count = action.cardIds.length;
    if (count === 2 || count === 3) return fail('Dwie albo trzy karty w jednej turze są nielegalne.');
    if (count !== 1 && count !== 4) return fail('To zagranie jest nielegalne.');
    const probe = pullHand(structuredClone(seat), action.cardIds);
    if (!probe) return fail('Nie masz tych kart.');
    if (count === 4 && !sameRank(probe)) return fail('Czwórka musi mieć tę samą wartość.');
    if (count === 1 && !canPlaySingle(probe[0]!, next.center)) return fail('Ta karta jest za słaba.');
    pullHand(seat, action.cardIds);
    commitPlay(next, seat, probe);
    return { ok: true, value: next };
  }

  if (action.type === 'playWayB') {
    if (seat.hand.length !== 3 || !sameRank(seat.hand)) return fail('Nie wolno tak złożyć czwórki.');
    const expected = new Set(seat.hand.map((card) => card.id));
    if (action.handCardIds.length !== 3 || action.handCardIds.some((id) => !expected.has(id))) {
      return fail('Nie wolno tak złożyć czwórki.');
    }
    const faceIndex = seat.faceUp.findIndex((card) => card?.id === action.faceUpId);
    const face = faceIndex >= 0 ? seat.faceUp[faceIndex] : null;
    if (!face || face.rank !== seat.hand[0]!.rank) return fail('Nie wolno tak złożyć czwórki.');
    const fromHand = pullHand(seat, action.handCardIds);
    if (!fromHand) return fail('Nie wolno tak złożyć czwórki.');
    seat.faceUp[faceIndex] = null;
    commitPlay(next, seat, [...fromHand, face]);
    return { ok: true, value: next };
  }

  if (action.type === 'playFaceUp') {
    if (seat.hand.length > 0) return fail('Dopóki masz karty w ręce, grasz z ręki.');
    const faceIndex = seat.faceUp.findIndex((card) => card?.id === action.cardId);
    const face = faceIndex >= 0 ? seat.faceUp[faceIndex] : null;
    if (!face) return fail('Nie masz tej odkrytej karty.');
    seat.faceUp[faceIndex] = null;
    if (canPlaySingle(face, next.center)) commitPlay(next, seat, [face]);
    else punish(next, seat, face, 'up');
    return { ok: true, value: next };
  }

  if (action.type === 'playFaceDown') {
    if (seat.hand.length > 0 || seat.faceUp.some((card) => card !== null)) {
      return fail('Zakrytą grasz dopiero, gdy nie masz ręki ani odkrytych.');
    }
    if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot > 2) return fail('Zły slot.');
    const hidden = seat.faceDown[action.slot];
    if (!hidden) return fail('Ten slot jest pusty.');
    seat.faceDown[action.slot] = null;
    if (canPlaySingle(hidden, next.center)) {
      next.reveal = { card: hidden, outcome: isBurn([hidden]) ? 'burn' : 'play' };
      commitPlay(next, seat, [hidden], 'odsłania');
    } else {
      punish(next, seat, hidden, 'down');
    }
    return { ok: true, value: next };
  }

  if (action.type === 'takeFaceDown') {
    if (seat.hand.length > 0 || seat.faceUp.some((card) => card !== null)) {
      return fail('Zakrytą bierzesz dopiero, gdy nie masz ręki ani odkrytych.');
    }
    if (!Number.isInteger(action.slot) || action.slot < 0 || action.slot > 2) return fail('Zły slot.');
    const hidden = seat.faceDown[action.slot];
    if (!hidden) return fail('Ten slot jest pusty.');
    seat.faceDown[action.slot] = null;
    seat.hand.push(hidden);
    next.handNote = { playerId: seat.id, card: hidden };
    pushLog(next, [`${seat.nick} bierze zakrytą kartę do ręki.`]);
    return { ok: true, value: next };
  }

  return fail('Nieznany ruch.');
}

export function dropOut(state: GameState, playerId: string): GameState {
  const seat = state.players.find((player) => player.id === playerId);
  if (!seat || seat.dropped || seat.exitedPlace !== null || state.phase !== 'playing') return state;
  const next: GameState = structuredClone(state);
  const target = next.players.find((player) => player.id === playerId)!;
  const removed = [
    ...target.hand,
    ...target.faceUp.filter((card): card is Card => card !== null),
    ...target.faceDown.filter((card): card is Card => card !== null),
  ];
  const wasCurrent = next.currentIndex !== null && next.players[next.currentIndex]?.id === playerId;
  const from = next.players.findIndex((player) => player.id === playerId);
  target.hand = [];
  target.faceUp = emptySlots();
  target.faceDown = emptySlots();
  target.dropped = true;
  next.outCount += removed.length;
  next.reveal = null;
  next.handNote = null;
  pushLog(next, [`${target.nick} odpada. Karty wypadają z gry (${kartyPhrase(removed.length)}).`]);
  if (wasCurrent) next.currentIndex = nextIndex(next, from);
  closeIfLast(next);
  return next;
}
