import type { PublicCard, Rank, Suit } from 'engine';

const SYMBOL: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const WORD: Record<Rank, string> = {
  '2': 'dwójka',
  '3': 'trójka',
  '4': 'czwórka',
  '5': 'piątka',
  '6': 'szóstka',
  '7': 'siódemka',
  '8': 'ósemka',
  '9': 'dziewiątka',
  '10': 'dziesiątka',
  J: 'walet',
  Q: 'dama',
  K: 'król',
  A: 'as',
};

const SUIT_WORD: Record<Suit, string> = {
  hearts: 'kier',
  diamonds: 'karo',
  clubs: 'trefl',
  spades: 'pik',
};

export function suitSymbol(suit: Suit): string {
  return SYMBOL[suit];
}

export function isRed(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds';
}

export function cardAria(card: PublicCard): string {
  return `${WORD[card.rank]} ${SUIT_WORD[card.suit]}`;
}
