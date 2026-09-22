import { legalActions } from './game.js';
import {
  EMPTY_LEGAL,
  type Card,
  type PlayerView,
  type PublicCard,
  type RoomState,
  type SeatView,
} from './types.js';

function pub(card: Card): PublicCard {
  return { id: card.id, suit: card.suit, rank: card.rank };
}

export function project(room: RoomState, viewerId: string, connected: ReadonlySet<string>): PlayerView {
  const game = room.game;
  const seats: SeatView[] = room.players.map((player) => {
    const seat = game?.players.find((item) => item.id === player.id);
    const own = player.id === viewerId;
    return {
      id: player.id,
      nick: player.nick,
      ready: player.ready,
      connected: connected.has(player.id),
      handCount: seat ? seat.hand.length : 0,
      hand: seat && own ? seat.hand.map(pub) : null,
      faceUp: seat ? seat.faceUp.map((card) => (card ? pub(card) : null)) : [null, null, null],
      faceDown: seat ? seat.faceDown.map((card) => (card ? 'back' : 'empty')) : ['empty', 'empty', 'empty'],
      exitedPlace: seat?.exitedPlace ?? null,
      dropped: seat?.dropped ?? false,
      isLoser: game?.loserId === player.id,
    };
  });

  const you = game?.players[game.currentIndex ?? -1];
  const yourTurn = Boolean(game && game.phase === 'playing' && you && you.id === viewerId);

  return {
    code: room.code,
    visibility: room.visibility,
    hostId: room.hostId,
    youId: viewerId,
    phase: room.phase,
    seats,
    centerTop: game && game.center.length > 0 ? pub(game.center[game.center.length - 1]!) : null,
    center: game ? game.center.map(pub) : [],
    centerCount: game?.center.length ?? 0,
    burnedCount: game?.burnedCount ?? 0,
    outCount: game?.outCount ?? 0,
    currentPlayerId: you?.id ?? null,
    exitOrder: (game?.exitOrder ?? []).map((id, index) => ({
      id,
      nick: room.players.find((player) => player.id === id)?.nick ?? '',
      place: index + 1,
    })),
    loserId: game?.loserId ?? null,
    log: game?.log ?? [],
    legal: game ? legalActions(game, viewerId) : { ...EMPTY_LEGAL, quads: [] },
    yourTurn,
    reveal: game?.reveal ? { card: pub(game.reveal.card), outcome: game.reveal.outcome } : null,
    handNote: game?.handNote && game.handNote.playerId === viewerId ? pub(game.handNote.card) : null,
    revision: room.revision,
  };
}
