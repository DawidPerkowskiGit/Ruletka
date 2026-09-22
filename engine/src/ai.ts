import { canPlaySingle, openingKey, strength } from './cards.js';
import { legalActions } from './game.js';
import type { Card, GameAction, GameState } from './types.js';

function discardRank(card: Card): number {
  if (card.rank === '10') return 200 + openingKey(card);
  if (card.rank === '5') return 100 + openingKey(card);
  return strength(card.rank) ?? 0;
}

function weakest(cards: readonly Card[]): Card {
  return cards.slice().sort((left, right) => discardRank(left) - discardRank(right))[0]!;
}

function withoutTens(cards: readonly Card[]): Card[] {
  const plain = cards.filter((card) => card.rank !== '10');
  return plain.length > 0 ? plain : cards.slice();
}

export function chooseAction(state: GameState, playerId: string): GameAction | null {
  const legal = legalActions(state, playerId);
  const seat = state.players.find((player) => player.id === playerId);
  if (!seat) return null;

  if (legal.quads.length > 0) {
    const quad = legal.quads
      .slice()
      .sort((left, right) => discardRank(seat.hand.find((card) => card.id === left[0])!) - discardRank(seat.hand.find((card) => card.id === right[0])!))[0]!;
    return { type: 'playHand', cardIds: quad };
  }

  if (legal.wayB) {
    return { type: 'playWayB', handCardIds: legal.wayB.handIds, faceUpId: legal.wayB.faceUpId };
  }

  if (legal.singles.length > 0) {
    const cards = seat.hand.filter((card) => legal.singles.includes(card.id));
    return { type: 'playHand', cardIds: [weakest(withoutTens(cards)).id] };
  }

  if (legal.faceUp.length > 0) {
    const cards = seat.faceUp.filter((card): card is Card => card !== null && legal.faceUp.includes(card.id));
    const playable = cards.filter((card) => canPlaySingle(card, state.center));
    if (playable.length > 0) return { type: 'playFaceUp', cardId: weakest(withoutTens(playable)).id };
    if (legal.takePile) return { type: 'takePile' };
    if (cards.length > 0) return { type: 'playFaceUp', cardId: weakest(cards).id };
  }

  if (legal.faceDownSlots.length > 0 && seat.hand.length === 0) {
    return { type: 'takeFaceDown', slot: legal.faceDownSlots[0]! };
  }

  if (legal.takePile) return { type: 'takePile' };
  return null;
}
