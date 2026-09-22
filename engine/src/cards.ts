import { RANKS, SUITS, type Card, type Rank, type Suit } from './types.js';

const NORMAL: Rank[] = ['2', '3', '4', '6', '7', '8', '9', 'J', 'Q', 'K', 'A'];

const RANK_ACC: Record<Rank, string> = {
  '2': '2',
  '3': '3',
  '4': '4',
  '5': 'piątkę',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': 'dziesiątkę',
  J: 'waleta',
  Q: 'damę',
  K: 'króla',
  A: 'asa',
};

const SUIT_NAME: Record<Suit, string> = {
  hearts: 'kier',
  diamonds: 'karo',
  clubs: 'trefl',
  spades: 'pik',
};

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}-${suit}`, rank, suit });
    }
  }
  return deck;
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = swap;
  }
  return copy;
}

export function strength(rank: Rank): number | null {
  const index = NORMAL.indexOf(rank);
  return index === -1 ? null : index;
}

export function canPlaySingle(card: Card, center: readonly Card[]): boolean {
  if (center.length === 0) return true;
  if (card.rank === '5' || card.rank === '10') return true;
  const top = center[center.length - 1]!;
  if (top.rank === '5') return true;
  const topStrength = strength(top.rank);
  const cardStrength = strength(card.rank);
  if (topStrength === null || cardStrength === null) return false;
  return cardStrength >= topStrength;
}

export function isBurn(cards: readonly Card[]): boolean {
  if (cards.length === 1 && cards[0]?.rank === '10') return true;
  if (cards.length === 4 && cards.every((card) => card.rank === cards[0]?.rank)) return true;
  return false;
}

export function cardLabel(card: Card): string {
  return `${RANK_ACC[card.rank]} ${SUIT_NAME[card.suit]}`;
}

export function cardList(cards: readonly Card[]): string {
  return cards.map((card) => `${card.rank === '10' ? '10' : RANK_ACC[card.rank]} ${SUIT_NAME[card.suit]}`).join(', ');
}

export function kartyPhrase(count: number): string {
  if (count === 1) return '1 kartę';
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} karty`;
  return `${count} kart`;
}

export function isCard(value: unknown): value is Card {
  if (!value || typeof value !== 'object') return false;
  const card = value as Card;
  return (
    typeof card.id === 'string' &&
    card.id.length > 0 &&
    card.id.length <= 80 &&
    (RANKS as readonly string[]).includes(card.rank) &&
    (SUITS as readonly string[]).includes(card.suit)
  );
}

export function sanitizeNick(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim();
  if (!stripped || stripped.length > 20) return null;
  return stripped;
}

export function playPhrase(cards: readonly Card[]): string {
  if (cards.length === 1) return `kładzie ${cardLabel(cards[0]!)}`;
  return `kładzie cztery karty (${cardList(cards)})`;
}
