export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export type GameAction =
  | { type: 'playHand'; cardIds: string[] }
  | { type: 'playWayB'; handCardIds: string[]; faceUpId: string }
  | { type: 'playFaceUp'; cardId: string }
  | { type: 'playFaceDown'; slot: number }
  | { type: 'takePile' };

export interface Seat {
  id: string;
  nick: string;
  hand: Card[];
  faceDown: (Card | null)[];
  faceUp: (Card | null)[];
  exitedPlace: number | null;
  dropped: boolean;
}

export interface Reveal {
  card: Card;
  outcome: 'low' | 'burn' | 'play';
}

export interface LogEntry {
  id: number;
  text: string;
}

export interface GameState {
  players: Seat[];
  startIndex: number;
  currentIndex: number | null;
  center: Card[];
  burnedCount: number;
  outCount: number;
  phase: 'playing' | 'finished';
  exitOrder: string[];
  loserId: string | null;
  log: LogEntry[];
  reveal: Reveal | null;
}

export interface RoomPlayer {
  id: string;
  token: string;
  nick: string;
  ready: boolean;
}

export interface RoomState {
  code: string;
  visibility: 'public' | 'private';
  hostId: string;
  players: RoomPlayer[];
  phase: 'lobby' | 'playing' | 'finished';
  game: GameState | null;
  revision: number;
}

export interface Legal {
  singles: string[];
  quads: string[][];
  wayB: { handIds: string[]; faceUpId: string } | null;
  takePile: boolean;
  faceUp: string[];
  faceDownSlots: number[];
}

export interface PublicCard {
  id: string;
  suit: Suit;
  rank: Rank;
}

export interface SeatView {
  id: string;
  nick: string;
  ready: boolean;
  connected: boolean;
  handCount: number;
  hand: PublicCard[] | null;
  faceUp: (PublicCard | null)[];
  faceDown: ('back' | 'empty')[];
  exitedPlace: number | null;
  dropped: boolean;
  isLoser: boolean;
}

export interface PlayerView {
  code: string;
  visibility: 'public' | 'private';
  hostId: string;
  youId: string;
  phase: 'lobby' | 'playing' | 'finished';
  seats: SeatView[];
  centerTop: PublicCard | null;
  centerCount: number;
  burnedCount: number;
  outCount: number;
  currentPlayerId: string | null;
  exitOrder: { id: string; nick: string; place: number }[];
  loserId: string | null;
  log: LogEntry[];
  legal: Legal;
  yourTurn: boolean;
  reveal: { card: PublicCard; outcome: Reveal['outcome'] } | null;
  revision: number;
}

export interface PublicRoom {
  code: string;
  hostNick: string;
  seats: number;
  max: 6;
}

export type ClientMessage =
  | { type: 'ping' }
  | { type: 'list' }
  | { type: 'create'; nick: string; visibility: 'public' | 'private'; token: string }
  | { type: 'join'; code: string; nick: string; token: string }
  | { type: 'rejoin'; code: string; token: string }
  | { type: 'ready' }
  | { type: 'start' }
  | { type: 'kick'; playerId: string }
  | { type: 'leave' }
  | { type: 'rematch' }
  | { type: 'action'; action: GameAction };

export type ServerMessage =
  | { type: 'pong' }
  | { type: 'error'; message: string }
  | { type: 'welcome'; token: string; code: string; playerId: string }
  | { type: 'rooms'; rooms: PublicRoom[] }
  | { type: 'view'; view: PlayerView }
  | { type: 'left' };

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const EMPTY_LEGAL: Legal = {
  singles: [],
  quads: [],
  wayB: null,
  takePile: false,
  faceUp: [],
  faceDownSlots: [],
};
