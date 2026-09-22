import { describe, expect, it } from 'vitest';
import { createRoom, addPlayer, endGame, kickPlayer, listPublic, rematch, resignGame, startGame, timeoutPlayer } from './room.js';
import { applyAction, dealGame, legalActions, lowestOpening, resign } from './game.js';
import { project } from './view.js';
import type { Card, GameState, Rank, Suit } from './types.js';

function card(rank: Rank, suit: Suit, id = `${rank}-${suit}`): Card {
  return { id, rank, suit };
}

function seat(id: string, nick: string, hand: Card[], faceUp: (Card | null)[] = [null, null, null], faceDown: (Card | null)[] = [null, null, null]) {
  return { id, nick, hand, faceUp, faceDown, exitedPlace: null, dropped: false };
}

function state(partial: {
  players: GameState['players'];
  center?: Card[];
  current?: number;
  burned?: number;
}): GameState {
  return {
    players: partial.players,
    startIndex: 0,
    currentIndex: partial.current ?? 0,
    center: partial.center ?? [],
    burnedCount: partial.burned ?? 0,
    outCount: 0,
    phase: 'playing',
    exitOrder: [],
    loserId: null,
    log: [],
    reveal: null,
    handNote: null,
  };
}

function must<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const A = { id: 'a', nick: 'Ala' };
const B = { id: 'b', nick: 'Bartek' };
const C = { id: 'c', nick: 'Celina' };
const D = { id: 'd', nick: 'Darek' };
const E = { id: 'e', nick: 'Ewa' };
const F = { id: 'f', nick: 'Filip' };

describe('otwarcie i kupka', () => {
  it('zaczyna gracz z najniższą kartą: 2 kier, potem pik, karo, trefl', () => {
    const hearts = lowestOpening([
      seat('a', 'Ala', [card('2', 'spades')]),
      seat('b', 'Bartek', [], [null, null, null], [card('2', 'hearts'), null, null]),
      seat('c', 'Celina', [card('2', 'diamonds'), card('2', 'clubs')]),
    ]);
    expect(hearts.index).toBe(1);
    expect(hearts.card.id).toBe('2-hearts');

    const wine = lowestOpening([
      seat('a', 'Ala', [card('2', 'clubs')]),
      seat('b', 'Bartek', [card('2', 'diamonds')]),
      seat('c', 'Celina', [card('3', 'hearts')], [card('2', 'spades'), null, null]),
    ]);
    expect(wine.index).toBe(2);
    expect(wine.card.suit).toBe('spades');

    const bell = lowestOpening([
      seat('a', 'Ala', [card('2', 'clubs')]),
      seat('b', 'Bartek', [card('2', 'diamonds')]),
      seat('c', 'Celina', [card('4', 'hearts')]),
    ]);
    expect(bell.index).toBe(1);
    expect(bell.card.suit).toBe('diamonds');
  });

  it('gracz może wziąć kupkę zamiast położyć kartę', () => {
    const game = state({
      players: [
        seat('a', 'Ala', [card('A', 'hearts')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('8', 'diamonds')]),
      ],
      center: [card('7', 'spades'), card('8', 'clubs')],
    });
    const legal = legalActions(game, 'a');
    expect(legal.singles).toContain('A-hearts');
    expect(legal.takePile).toBe(true);
    const taken = must(applyAction(game, 'a', { type: 'takePile' }));
    expect(taken.center).toEqual([]);
    expect(taken.players[0]!.hand.map((item) => item.id)).toEqual(['A-hearts', '7-spades', '8-clubs']);
    expect(taken.currentIndex).toBe(1);

    const empty = state({
      players: [
        seat('a', 'Ala', [card('A', 'hearts')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('8', 'diamonds')]),
      ],
    });
    expect(legalActions(empty, 'a').takePile).toBe(false);
    expect(applyAction(empty, 'a', { type: 'takePile' }).ok).toBe(false);
  });
});

describe('pojedyncza karta', () => {
  it('równa karta wchodzi, słabsza z ręki nie wchodzi i gracz bierze kupkę', () => {
    const equal = state({
      players: [
        seat('a', 'Ala', [card('7', 'hearts'), card('2', 'clubs')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('8', 'diamonds')]),
      ],
      center: [card('7', 'spades')],
    });
    const played = must(applyAction(equal, 'a', { type: 'playHand', cardIds: ['7-hearts'] }));
    expect(played.center.map((item) => item.id)).toEqual(['7-spades', '7-hearts']);
    expect(played.burnedCount).toBe(0);
    expect(played.currentIndex).toBe(1);

    const weak = state({
      players: [
        seat('a', 'Ala', [card('6', 'hearts')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('8', 'diamonds')]),
      ],
      center: [card('7', 'spades')],
    });
    const before = structuredClone(weak);
    const rejected = applyAction(weak, 'a', { type: 'playHand', cardIds: ['6-hearts'] });
    expect(rejected.ok).toBe(false);
    expect(weak).toEqual(before);
    const taken = must(applyAction(weak, 'a', { type: 'takePile' }));
    expect(taken.center).toEqual([]);
    expect(taken.players[0]!.hand.map((item) => item.id)).toEqual(['6-hearts', '7-spades']);
    expect(taken.currentIndex).toBe(1);
    expect(taken.log.at(-1)!.text).toMatch(/bierze kupkę/);
  });

  it('wyższa karta wchodzi, a czwórka nie wchodzi na szóstkę', () => {
    const higher = state({
      players: [
        seat('a', 'Ala', [card('A', 'hearts')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('8', 'diamonds')]),
      ],
      center: [card('K', 'spades')],
    });
    const played = must(applyAction(higher, 'a', { type: 'playHand', cardIds: ['A-hearts'] }));
    expect(played.center.at(-1)!.rank).toBe('A');

    const skipped = state({
      players: [
        seat('a', 'Ala', [card('4', 'hearts')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('8', 'diamonds')]),
      ],
      center: [card('6', 'spades')],
    });
    expect(applyAction(skipped, 'a', { type: 'playHand', cardIds: ['4-hearts'] }).ok).toBe(false);
  });

  it('jedna piątka na asa, potem trójka na piątkę', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [card('5', 'hearts'), card('9', 'clubs')]),
        seat('b', 'Bartek', [card('3', 'diamonds'), card('8', 'clubs')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
      center: [card('A', 'spades')],
    });
    const five = must(applyAction(start, 'a', { type: 'playHand', cardIds: ['5-hearts'] }));
    expect(five.center.at(-1)!.rank).toBe('5');
    expect(five.burnedCount).toBe(0);
    expect(five.currentIndex).toBe(1);
    const three = must(applyAction(five, 'b', { type: 'playHand', cardIds: ['3-diamonds'] }));
    expect(three.center.map((item) => item.rank)).toEqual(['A', '5', '3']);
    expect(three.burnedCount).toBe(0);
  });

  it('dwie i trzy takie same są odrzucane', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [card('8', 'hearts'), card('8', 'diamonds'), card('8', 'clubs'), card('2', 'spades')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
      center: [],
    });
    expect(applyAction(start, 'a', { type: 'playHand', cardIds: ['8-hearts', '8-diamonds'] }).ok).toBe(false);
    expect(applyAction(start, 'a', { type: 'playHand', cardIds: ['8-hearts', '8-diamonds', '8-clubs'] }).ok).toBe(false);
    expect(start.center).toEqual([]);
    expect(start.players[0]!.hand).toHaveLength(4);
  });
});

describe('kasowanie', () => {
  it('dziesiątka na asa kasuje i ten sam gracz otwiera nowy stos', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [card('10', 'hearts'), card('2', 'clubs')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
      center: [card('A', 'spades')],
    });
    const burned = must(applyAction(start, 'a', { type: 'playHand', cardIds: ['10-hearts'] }));
    expect(burned.center).toEqual([]);
    expect(burned.burnedCount).toBe(2);
    expect(burned.currentIndex).toBe(0);
    expect(burned.log.at(-1)!.text).toMatch(/kasuje stos/);
    expect(burned.log.at(-1)!.text).toMatch(/Gra dalej/);
    const opened = must(applyAction(burned, 'a', { type: 'playHand', cardIds: ['2-clubs'] }));
    expect(opened.center.map((item) => item.id)).toEqual(['2-clubs']);
    expect(opened.currentIndex).toBe(1);
  });

  it('cztery takie same z ręki kasują, także gdy w ręce są jeszcze inne karty', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [
          card('K', 'hearts'),
          card('K', 'diamonds'),
          card('K', 'clubs'),
          card('K', 'spades'),
          card('2', 'hearts'),
        ]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
      center: [card('A', 'clubs'), card('3', 'diamonds')],
    });
    const burned = must(
      applyAction(start, 'a', { type: 'playHand', cardIds: ['K-hearts', 'K-diamonds', 'K-clubs', 'K-spades'] }),
    );
    expect(burned.center).toEqual([]);
    expect(burned.burnedCount).toBe(6);
    expect(burned.players[0]!.hand.map((item) => item.id)).toEqual(['2-hearts']);
    expect(burned.currentIndex).toBe(0);
  });

  it('cztery piątki naraz kasują stos', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [card('5', 'hearts'), card('5', 'diamonds'), card('5', 'clubs'), card('5', 'spades')]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
      center: [card('A', 'hearts')],
    });
    const burned = must(
      applyAction(start, 'a', { type: 'playHand', cardIds: ['5-hearts', '5-diamonds', '5-clubs', '5-spades'] }),
    );
    expect(burned.center).toEqual([]);
    expect(burned.burnedCount).toBe(5);
  });

  it('cztery karty tej samej wartości położone przez różnych graczy nie kasują', () => {
    let game = state({
      players: [
        seat('a', 'Ala', [card('K', 'hearts'), card('K', 'spades'), card('2', 'clubs')]),
        seat('b', 'Bartek', [card('K', 'diamonds'), card('3', 'clubs')]),
        seat('c', 'Celina', [card('K', 'clubs'), card('4', 'diamonds')]),
      ],
    });
    game = must(applyAction(game, 'a', { type: 'playHand', cardIds: ['K-hearts'] }));
    game = must(applyAction(game, 'b', { type: 'playHand', cardIds: ['K-diamonds'] }));
    game = must(applyAction(game, 'c', { type: 'playHand', cardIds: ['K-clubs'] }));
    game = must(applyAction(game, 'a', { type: 'playHand', cardIds: ['K-spades'] }));
    expect(game.center).toHaveLength(4);
    expect(game.center.every((item) => item.rank === 'K')).toBe(true);
    expect(game.burnedCount).toBe(0);
    expect(game.currentIndex).toBe(1);
  });

  it('ostatnia karta, która kasuje stos: gracz wychodzi, następny otwiera pusty stos', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [card('10', 'diamonds')]),
        seat('b', 'Bartek', [card('9', 'spades'), card('2', 'hearts')]),
        seat('c', 'Celina', [card('6', 'clubs')]),
      ],
      center: [card('A', 'hearts')],
    });
    const done = must(applyAction(start, 'a', { type: 'playHand', cardIds: ['10-diamonds'] }));
    expect(done.center).toEqual([]);
    expect(done.burnedCount).toBe(2);
    expect(done.players[0]!.exitedPlace).toBe(1);
    expect(done.exitOrder).toEqual(['a']);
    expect(done.currentIndex).toBe(1);
    expect(done.phase).toBe('playing');
    expect(done.loserId).toBeNull();
    const opened = must(applyAction(done, 'b', { type: 'playHand', cardIds: ['2-hearts'] }));
    expect(opened.center.map((item) => item.id)).toEqual(['2-hearts']);
  });
});

describe('trzy z ręki plus odkryta', () => {
  it('dokładnie trzy takie same i czwarta odkryta kasują, zakryta pod spodem zostaje zakryta', () => {
    const hidden = card('3', 'spades', 'hidden-under');
    const start = state({
      players: [
        seat(
          'a',
          'Ala',
          [card('7', 'hearts'), card('7', 'diamonds'), card('7', 'clubs')],
          [card('7', 'spades'), null, null],
          [hidden, card('4', 'hearts'), card('5', 'clubs')],
        ),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
      center: [card('A', 'diamonds')],
    });
    expect(legalActions(start, 'a').wayB).toEqual({
      handIds: ['7-hearts', '7-diamonds', '7-clubs'],
      faceUpId: '7-spades',
    });
    const burned = must(
      applyAction(start, 'a', {
        type: 'playWayB',
        handCardIds: ['7-hearts', '7-diamonds', '7-clubs'],
        faceUpId: '7-spades',
      }),
    );
    expect(burned.center).toEqual([]);
    expect(burned.burnedCount).toBe(5);
    expect(burned.players[0]!.hand).toEqual([]);
    expect(burned.players[0]!.faceUp[0]).toBeNull();
    expect(burned.players[0]!.faceDown[0]).toEqual(hidden);
    expect(burned.currentIndex).toBe(0);

    const room = {
      code: 'ABCDEF',
      visibility: 'private' as const,
      hostId: 'a',
      players: [
        { id: 'a', token: 'token-a', nick: 'Ala', ready: false },
        { id: 'b', token: 'token-b', nick: 'Bartek', ready: false },
        { id: 'c', token: 'token-c', nick: 'Celina', ready: false },
      ],
      phase: 'playing' as const,
      game: burned,
      revision: 2,
    };
    const view = project(room, 'a', new Set(['a', 'b', 'c']));
    expect(view.seats[0]!.faceDown[0]).toBe('back');
    expect(JSON.stringify(view)).not.toContain('hidden-under');
    expect(JSON.stringify(view)).not.toContain('token-a');
  });

  it('trzy takie same plus inna karta w ręce: zagranie 3+1 jest odrzucane', () => {
    const start = state({
      players: [
        seat(
          'a',
          'Ala',
          [card('7', 'hearts'), card('7', 'diamonds'), card('7', 'clubs'), card('2', 'spades')],
          [card('7', 'spades'), null, null],
          [card('3', 'hearts'), null, null],
        ),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
      center: [card('A', 'diamonds')],
    });
    const before = structuredClone(start);
    const rejected = applyAction(start, 'a', {
      type: 'playWayB',
      handCardIds: ['7-hearts', '7-diamonds', '7-clubs'],
      faceUpId: '7-spades',
    });
    expect(rejected.ok).toBe(false);
    expect(start).toEqual(before);
    expect(legalActions(start, 'a').wayB).toBeNull();
  });

  it('ręka ma mniej albo więcej niż trzy karty: zagranie 3+1 jest odrzucane', () => {
    const two = state({
      players: [
        seat('a', 'Ala', [card('7', 'hearts'), card('7', 'diamonds')], [card('7', 'spades'), null, null]),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
    });
    expect(
      applyAction(two, 'a', { type: 'playWayB', handCardIds: ['7-hearts', '7-diamonds'], faceUpId: '7-spades' }).ok,
    ).toBe(false);

    const five = state({
      players: [
        seat(
          'a',
          'Ala',
          [card('7', 'hearts'), card('7', 'diamonds'), card('7', 'clubs'), card('2', 'hearts'), card('3', 'clubs')],
          [card('7', 'spades'), null, null],
        ),
        seat('b', 'Bartek', [card('9', 'spades')]),
        seat('c', 'Celina', [card('6', 'spades')]),
      ],
    });
    expect(
      applyAction(five, 'a', {
        type: 'playWayB',
        handCardIds: ['7-hearts', '7-diamonds', '7-clubs'],
        faceUpId: '7-spades',
      }).ok,
    ).toBe(false);
    expect(legalActions(two, 'a').wayB).toBeNull();
    expect(legalActions(five, 'a').wayB).toBeNull();
  });
});

describe('pusta ręka', () => {
  it('za niska odkryta: kupka i ta karta wracają do ręki, na środku nic nie przybywa', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [], [card('4', 'hearts'), card('9', 'clubs'), null], [card('2', 'spades'), card('3', 'diamonds'), card('6', 'clubs')]),
        seat('b', 'Bartek', [card('K', 'spades')]),
        seat('c', 'Celina', [card('8', 'spades')]),
      ],
      center: [card('A', 'spades'), card('K', 'hearts')],
    });
    expect(legalActions(start, 'a').faceUp).toContain('4-hearts');
    const punished = must(applyAction(start, 'a', { type: 'playFaceUp', cardId: '4-hearts' }));
    expect(punished.center).toEqual([]);
    expect(punished.players[0]!.hand.map((item) => item.id)).toEqual(['A-spades', 'K-hearts', '4-hearts']);
    expect(punished.players[0]!.faceUp[0]).toBeNull();
    expect(punished.players[0]!.faceUp[1]!.id).toBe('9-clubs');
    expect(punished.players[0]!.faceDown[0]!.id).toBe('2-spades');
    expect(punished.currentIndex).toBe(1);
  });

  it('za niska zakryta po odsłonięciu wraca razem z kupką', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [], [null, null, null], [card('3', 'hearts'), card('9', 'clubs'), null]),
        seat('b', 'Bartek', [card('K', 'spades')]),
        seat('c', 'Celina', [card('8', 'spades')]),
      ],
      center: [card('Q', 'diamonds')],
    });
    const punished = must(applyAction(start, 'a', { type: 'playFaceDown', slot: 0 }));
    expect(punished.center).toEqual([]);
    expect(punished.players[0]!.hand.map((item) => item.rank)).toEqual(['Q', '3']);
    expect(punished.players[0]!.faceDown[0]).toBeNull();
    expect(punished.reveal).toEqual({ card: card('3', 'hearts'), outcome: 'low' });
    expect(punished.log.at(-1)!.text).toMatch(/odsłania/);
    expect(punished.log.at(-1)!.text).toMatch(/3 kier/);
    expect(punished.log.at(-1)!.parts?.some((part) => part.type === 'card' && part.card.rank === '3')).toBe(true);
  });

  it('zakrytą można wziąć do ręki, widzi ją tylko ten gracz, tura zostaje', () => {
    const start = state({
      players: [
        seat('a', 'Ala', [], [null, null, null], [card('3', 'clubs'), card('9', 'hearts'), null]),
        seat('b', 'Bartek', [card('K', 'spades')]),
        seat('c', 'Celina', [card('8', 'spades')]),
      ],
      center: [card('A', 'spades')],
    });
    expect(applyAction(start, 'a', { type: 'takeFaceDown', slot: 1 }).ok).toBe(true);
    const busy = state({
      players: [
        seat('a', 'Ala', [card('2', 'hearts')], [null, null, null], [card('3', 'clubs'), null, null]),
        seat('b', 'Bartek', [card('K', 'spades')]),
        seat('c', 'Celina', [card('8', 'spades')]),
      ],
    });
    expect(applyAction(busy, 'a', { type: 'takeFaceDown', slot: 0 }).ok).toBe(false);

    const taken = must(applyAction(start, 'a', { type: 'takeFaceDown', slot: 0 }));
    expect(taken.players[0]!.hand.map((item) => item.id)).toEqual(['3-clubs']);
    expect(taken.players[0]!.faceDown[0]).toBeNull();
    expect(taken.players[0]!.faceDown[1]!.id).toBe('9-hearts');
    expect(taken.center.map((item) => item.id)).toEqual(['A-spades']);
    expect(taken.currentIndex).toBe(0);
    expect(taken.handNote?.playerId).toBe('a');
    expect(taken.log.at(-1)!.text).toBe('Ala bierze zakrytą kartę do ręki.');
    expect(JSON.stringify(taken.log)).not.toContain('3-clubs');
    const room = {
      code: 'UKRYTA',
      visibility: 'private' as const,
      hostId: 'a',
      players: [A, B, C].map((player) => ({ ...player, token: `secret-${player.id}`, ready: false })),
      phase: 'playing' as const,
      game: taken,
      revision: 2,
    };
    const own = project(room, 'a', new Set(['a']));
    const other = project(room, 'b', new Set(['a', 'b']));
    expect(own.handNote?.id).toBe('3-clubs');
    expect(own.seats[0]!.hand?.map((item) => item.id)).toEqual(['3-clubs']);
    expect(other.handNote).toBeNull();
    expect(other.seats[0]!.hand).toBeNull();
    expect(JSON.stringify(other)).not.toContain('3-clubs');
    expect(JSON.stringify(other)).not.toContain('9-hearts');
    expect(applyAction(taken, 'a', { type: 'playHand', cardIds: ['3-clubs'] }).ok).toBe(false);
    const piled = must(applyAction(taken, 'a', { type: 'takePile' }));
    expect(piled.players[0]!.hand.map((item) => item.id)).toEqual(['3-clubs', 'A-spades']);
    expect(piled.handNote).toBeNull();
    expect(piled.currentIndex).toBe(1);
  });

  it('zakryta dziesiątka i zakryta piątka przy pustej ręce działają jak specjalne', () => {
    const ten = state({
      players: [
        seat('a', 'Ala', [], [null, null, null], [card('10', 'clubs'), card('2', 'hearts'), null]),
        seat('b', 'Bartek', [card('K', 'spades')]),
        seat('c', 'Celina', [card('8', 'spades')]),
      ],
      center: [card('A', 'hearts')],
    });
    const burned = must(applyAction(ten, 'a', { type: 'playFaceDown', slot: 0 }));
    expect(burned.center).toEqual([]);
    expect(burned.burnedCount).toBe(2);
    expect(burned.reveal?.outcome).toBe('burn');
    expect(burned.reveal?.card.rank).toBe('10');
    expect(burned.currentIndex).toBe(0);
    expect(burned.log.at(-1)!.text).toMatch(/odsłania/);

    const five = state({
      players: [
        seat('a', 'Ala', [], [null, null, null], [card('5', 'diamonds'), card('2', 'hearts'), null]),
        seat('b', 'Bartek', [card('K', 'spades')]),
        seat('c', 'Celina', [card('8', 'spades')]),
      ],
      center: [card('A', 'hearts')],
    });
    const played = must(applyAction(five, 'a', { type: 'playFaceDown', slot: 0 }));
    expect(played.center.map((item) => item.rank)).toEqual(['A', '5']);
    expect(played.burnedCount).toBe(0);
    expect(played.reveal?.outcome).toBe('play');
    expect(played.currentIndex).toBe(1);
  });
});

describe('rozdanie', () => {
  const people = [A, B, C, D, E, F];

  function countsFromStart(count: number, start = 0): number[] {
    const game = dealGame(people.slice(0, count), () => 0.25, start);
    const order: number[] = [];
    for (let offset = 0; offset < count; offset++) order.push(game.players[(start + offset) % count]!.hand.length);
    for (const player of game.players) {
      expect(player.faceDown.filter(Boolean)).toHaveLength(3);
      expect(player.faceUp.filter(Boolean)).toHaveLength(3);
    }
    const ids = new Set<string>();
    for (const player of game.players) {
      for (const item of [...player.hand, ...player.faceDown, ...player.faceUp]) {
        if (!item) continue;
        expect(ids.has(item.id)).toBe(false);
        ids.add(item.id);
      }
    }
    expect(ids.size).toBe(52);
    expect(game.players.reduce((sum, player) => sum + player.hand.length, 0)).toBe(52 - 6 * count);
    const opener = game.players.findIndex((player) =>
      [...player.hand, ...player.faceUp, ...player.faceDown].some((item) => item?.id === '2-hearts'),
    );
    expect(game.currentIndex).toBe(opener);
    expect(game.log[0]!.text).toMatch(/najniższą kartę \(2 kier\)/);
    return order;
  }

  it('3, 4, 5 i 6 graczy dostaje ręce z sekcji talia', () => {
    expect(countsFromStart(3)).toEqual([12, 11, 11]);
    expect(countsFromStart(4)).toEqual([7, 7, 7, 7]);
    expect(countsFromStart(5)).toEqual([5, 5, 4, 4, 4]);
    expect(countsFromStart(6)).toEqual([3, 3, 3, 3, 2, 2]);
    expect(countsFromStart(3, 1)).toEqual([12, 11, 11]);
  });

  it('widok zasłania cudze ręce i własne zakryte', () => {
    const game = dealGame([A, B, C], () => 0.2, 0);
    const room = {
      code: 'STAN01',
      visibility: 'private' as const,
      hostId: 'a',
      players: [A, B, C].map((player) => ({ ...player, token: `secret-${player.id}`, ready: false })),
      phase: 'playing' as const,
      game,
      revision: 1,
    };
    const own = project(room, 'a', new Set(['a', 'b', 'c']));
    const hidden = game.players[0]!.faceDown[0]!.id;
    expect(own.seats[0]!.hand).toHaveLength(12);
    expect(own.seats[0]!.faceDown.every((slot) => slot === 'back')).toBe(true);
    expect(JSON.stringify(own)).not.toContain(hidden);
    expect(JSON.stringify(own)).not.toContain('secret-a');
    const other = project(room, 'b', new Set(['a']));
    expect(other.seats[0]!.hand).toBeNull();
    expect(other.seats[0]!.handCount).toBe(12);
    expect(other.seats[0]!.faceUp.every((slot) => slot !== null)).toBe(true);
    expect(other.seats[0]!.connected).toBe(true);
    expect(other.seats[1]!.connected).toBe(false);
  });
});

describe('stół', () => {
  function hostRoom() {
    return must(
      createRoom({
        code: 'STOL01',
        visibility: 'private',
        host: { id: 'a', token: 'ta', nick: 'Ala' },
      }),
    );
  }

  it('start przy 2 graczach jest odrzucany, start przy 3 jest przyjmowany, siódmy gracz nie siada', () => {
    let room = hostRoom();
    room = must(addPlayer(room, { id: 'b', token: 'tb', nick: 'Bartek' }));
    const tooSoon = startGame(room, 'a', () => 0);
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error).toMatch(/3/);
    expect(room.phase).toBe('lobby');

    room = must(addPlayer(room, { id: 'c', token: 'tc', nick: 'Celina' }));
    const stranger = startGame(room, 'b', () => 0);
    expect(stranger.ok).toBe(false);
    room = must(startGame(room, 'a', () => 0));
    expect(room.phase).toBe('playing');
    expect(room.game!.players.map((player) => player.hand.length)).toEqual([12, 11, 11]);

    let open = must(createRoom({ code: 'OPEN01', visibility: 'public', host: { id: 'a', token: 'ta', nick: '<b>Ala</b>' } }));
    expect(open.players[0]!.nick).toBe('Ala');
    for (const player of [B, C, D, E, F]) {
      open = must(addPlayer(open, { id: player.id, token: `t-${player.id}`, nick: player.nick }));
    }
    expect(open.players).toHaveLength(6);
    const seventh = addPlayer(open, { id: 'g', token: 'tg', nick: 'Gosia' });
    expect(seventh.ok).toBe(false);
    expect(open.players).toHaveLength(6);
    const started = must(startGame(open, 'a', () => 0));
    expect(started.game!.players.map((player) => player.hand.length)).toEqual([3, 3, 3, 3, 2, 2]);
  });

  it('prywatny stół nie wchodzi na listę, a publiczny tak', () => {
    const priv = hostRoom();
    const pub = must(createRoom({ code: 'PUB001', visibility: 'public', host: { id: 'a', token: 'ta', nick: 'Ala' } }));
    const started = must(startGame(must(addPlayer(must(addPlayer(pub, { id: 'b', token: 'tb', nick: 'Bartek' })), { id: 'c', token: 'tc', nick: 'Celina' })), 'a', () => 0));
    const listed = listPublic([priv, pub, started]);
    expect(listed).toEqual([{ code: 'PUB001', hostNick: 'Ala', seats: 1, max: 6 }]);
  });

  it('gospodarz wyrzuca gracza przed startem', () => {
    let room = must(addPlayer(hostRoom(), { id: 'b', token: 'tb', nick: 'Bartek' }));
    expect(kickPlayer(room, 'b', 'a').ok).toBe(false);
    room = must(kickPlayer(room, 'a', 'b'));
    expect(room.players.map((player) => player.id)).toEqual(['a']);
  });

  it('po odpadnięciu zostaje jeden gracz z kartami i on przegrywa', () => {
    let room = must(addPlayer(must(addPlayer(hostRoom(), { id: 'b', token: 'tb', nick: 'Bartek' })), { id: 'c', token: 'tc', nick: 'Celina' }));
    room = must(startGame(room, 'a', () => 0));
    room = must(timeoutPlayer(room, 'a'));
    expect(room.phase).toBe('playing');
    expect(room.game!.players[0]!.dropped).toBe(true);
    expect(room.game!.players[0]!.hand).toEqual([]);
    expect(room.game!.outCount).toBe(18);
    expect(room.game!.currentIndex).toBe(1);
    room = must(timeoutPlayer(room, 'b'));
    expect(room.phase).toBe('finished');
    expect(room.game!.loserId).toBe('c');
    expect(room.game!.players[2]!.hand.length).toBe(11);
  });

  it('odrzuca HTML i pusty nick', () => {
    expect(createRoom({ code: 'X', visibility: 'public', host: { id: 'a', token: 't', nick: '<script>' } }).ok).toBe(false);
    expect(createRoom({ code: 'X', visibility: 'public', host: { id: 'a', token: 't', nick: '   ' } }).ok).toBe(false);
  });

  it('gospodarz kończy partię albo rozdaje od nowa, a w pojedynku można się poddać', () => {
    let room = must(addPlayer(must(addPlayer(hostRoom(), { id: 'b', token: 'tb', nick: 'Bartek' })), { id: 'c', token: 'tc', nick: 'Celina' }));
    room = must(startGame(room, 'a', () => 0));
    expect(endGame(room, 'b').ok).toBe(false);
    expect(rematch(room, 'b', () => 0).ok).toBe(false);

    const restarted = must(rematch(room, 'a', () => 0));
    expect(restarted.phase).toBe('playing');
    expect(restarted.game!.log.at(-1)?.text).toMatch(/najniższą kartę/);
    expect(restarted.game!.log.some((entry) => entry.text.includes('kończy'))).toBe(false);

    const ended = must(endGame(restarted, 'a'));
    expect(ended.phase).toBe('finished');
    expect(ended.game!.loserId).toBeNull();
    expect(ended.game!.currentIndex).toBeNull();
    expect(ended.game!.log.at(-1)?.text).toBe('Gospodarz zakończył partię.');
    expect(endGame(ended, 'a').ok).toBe(false);

    const again = must(rematch(ended, 'a', () => 0));
    expect(again.phase).toBe('playing');

    const early = resign(again.game!, 'a');
    expect(early.ok).toBe(false);

    const duel = state({
      players: [
        seat('a', 'Ala', []),
        seat('b', 'Bartek', [card('K', 'spades')]),
        seat('c', 'Celina', [card('9', 'hearts')]),
      ],
      current: 1,
    });
    duel.players[0]!.exitedPlace = 1;
    duel.exitOrder = ['a'];
    expect(resign(duel, 'a').ok).toBe(false);
    const surrendered = must(resign(duel, 'c'));
    expect(surrendered.phase).toBe('finished');
    expect(surrendered.loserId).toBe('c');
    expect(surrendered.players[1]!.exitedPlace).toBe(2);
    expect(surrendered.log.at(-1)?.text).toBe('Celina poddaje się. Bartek wygrywa pojedynek (miejsce 2).');
    expect(surrendered.currentIndex).toBeNull();

    again.game = duel;
    again.phase = 'playing';
    const fromRoom = must(resignGame(again, 'b'));
    expect(fromRoom.phase).toBe('finished');
    expect(fromRoom.game!.loserId).toBe('b');
    expect(fromRoom.game!.players[2]!.exitedPlace).toBe(2);
  });
});
