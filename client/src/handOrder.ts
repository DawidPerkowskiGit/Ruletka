import type { PublicCard, Rank, Suit } from 'engine';

const RANK: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT: Suit[] = ['hearts', 'spades', 'diamonds', 'clubs'];

export function sortCards(cards: readonly PublicCard[]): PublicCard[] {
  return cards.slice().sort((left, right) => {
    const byRank = RANK.indexOf(left.rank) - RANK.indexOf(right.rank);
    if (byRank !== 0) return byRank;
    return SUIT.indexOf(left.suit) - SUIT.indexOf(right.suit);
  });
}

export function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function reconcileOrder(previous: readonly string[], cards: readonly PublicCard[], auto: boolean): string[] {
  if (auto) return sortCards(cards).map((card) => card.id);
  const ids = new Set(cards.map((card) => card.id));
  const kept = previous.filter((id) => ids.has(id));
  const known = new Set(kept);
  const added = cards.filter((card) => !known.has(card.id)).map((card) => card.id);
  return [...kept, ...added];
}

export function moveCard(order: readonly string[], id: string, insertAt: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return order.slice();
  const next = order.slice();
  next.splice(from, 1);
  const to = Math.max(0, Math.min(insertAt > from ? insertAt - 1 : insertAt, next.length));
  next.splice(to, 0, id);
  return next;
}

export function fanPeek(cardWidth: number, count: number, clientWidth: number, extraGaps: number): number {
  if (count <= 1) return Math.round(cardWidth);
  const minPeek = Math.max(28, Math.round(cardWidth * 0.5) + 4);
  const fan = Math.max(minPeek, Math.round(cardWidth * 0.62));
  const fit = (clientWidth - cardWidth - extraGaps) / (count - 1);
  if (fit >= fan) return fan;
  return Math.max(minPeek, Math.floor(fit));
}
