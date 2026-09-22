import { useEffect, useRef, useState } from 'react';
import type { ClientMessage, GameAction, Legal, PlayerView, SeatView } from 'engine';
import { CardBack, PlayingCard } from './cards';

interface TableProps {
  view: PlayerView;
  pending: boolean;
  logOpen: boolean;
  send: (message: ClientMessage, lock?: boolean) => void;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const bag = new Set(right);
  return left.every((id) => bag.has(id));
}

function canSelectHand(id: string, legal: Legal): boolean {
  return legal.singles.includes(id) || legal.quads.some((quad) => quad.includes(id)) || Boolean(legal.wayB?.handIds.includes(id));
}

function chosenAction(legal: Legal, handIds: string[], faceUpId: string | null, downSlot: number | null): GameAction | null {
  if (downSlot !== null && handIds.length === 0 && faceUpId === null && legal.faceDownSlots.includes(downSlot)) {
    return { type: 'playFaceDown', slot: downSlot };
  }
  if (faceUpId && handIds.length === 0 && downSlot === null && legal.faceUp.includes(faceUpId)) {
    return { type: 'playFaceUp', cardId: faceUpId };
  }
  if (legal.wayB && faceUpId === legal.wayB.faceUpId && downSlot === null && sameIds(handIds, legal.wayB.handIds)) {
    return { type: 'playWayB', handCardIds: legal.wayB.handIds, faceUpId };
  }
  if (handIds.length === 4 && faceUpId === null && downSlot === null && legal.quads.some((quad) => sameIds(quad, handIds))) {
    return { type: 'playHand', cardIds: handIds };
  }
  if (handIds.length === 1 && faceUpId === null && downSlot === null && legal.singles.includes(handIds[0]!)) {
    return { type: 'playHand', cardIds: handIds };
  }
  return null;
}

function confirmLabel(action: GameAction | null, pending: boolean): string {
  if (pending) return 'Wysyłam…';
  if (!action) return 'Połóż';
  if (action.type === 'playHand' && action.cardIds.length === 4) return 'Połóż cztery';
  if (action.type === 'playWayB') return 'Połóż 3 + odkrytą';
  if (action.type === 'playFaceDown') return 'Odsłoń';
  if (action.type === 'playFaceUp') return 'Połóż odkrytą';
  return 'Połóż';
}

function seatNote(seat: SeatView, playing: boolean): string {
  const parts = [`${seat.handCount} w ręce`];
  if (seat.exitedPlace) parts.push(`miejsce ${seat.exitedPlace}`);
  if (seat.dropped) parts.push('odpadł');
  else if (playing && !seat.connected) parts.push('rozłączony');
  if (seat.isLoser) parts.push('przegrywa');
  return parts.join(' · ');
}

export function Table({ view, pending, logOpen, send }: TableProps) {
  const me = view.seats.find((seat) => seat.id === view.youId);
  const others = view.seats.filter((seat) => seat.id !== view.youId);
  const [handSel, setHandSel] = useState<string[]>([]);
  const [upSel, setUpSel] = useState<string | null>(null);
  const [downSel, setDownSel] = useState<number | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setHandSel([]);
    setUpSel(null);
    setDownSel(null);
  }, [view.revision]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [view.log.length, logOpen]);

  if (!me) return null;

  const action = view.yourTurn ? chosenAction(view.legal, handSel, upSel, downSel) : null;
  const current = view.seats.find((seat) => seat.id === view.currentPlayerId);
  const loser = view.seats.find((seat) => seat.id === view.loserId);
  const locked = pending || !view.yourTurn;

  function toggleHand(id: string) {
    if (locked || !canSelectHand(id, view.legal)) return;
    setDownSel(null);
    setHandSel((currentIds) => (currentIds.includes(id) ? currentIds.filter((item) => item !== id) : [...currentIds, id]));
  }

  function toggleUp(id: string) {
    if (locked) return;
    const allowed = view.legal.faceUp.includes(id) || view.legal.wayB?.faceUpId === id;
    if (!allowed) return;
    setDownSel(null);
    if (view.legal.faceUp.includes(id)) setHandSel([]);
    setUpSel((currentId) => (currentId === id ? null : id));
  }

  function toggleDown(slot: number) {
    if (locked || !view.legal.faceDownSlots.includes(slot)) return;
    setHandSel([]);
    setUpSel(null);
    setDownSel((currentSlot) => (currentSlot === slot ? null : slot));
  }

  const hint = hintText(view, handSel);

  return (
    <div className="play-layout">
      <div className="play-main">
        <div className={`turn-banner${view.yourTurn ? ' mine' : ''}`} data-testid="turn" data-yours={view.yourTurn ? '1' : '0'} data-player={view.currentPlayerId ?? ''}>
          {view.phase === 'finished' ? 'Koniec partii' : view.yourTurn ? 'Twoja tura' : `Tura: ${current?.nick ?? '—'}`}
        </div>
        <div className="opponents">
          {others.map((seat) => (
            <article key={seat.id} className={`seat${seat.id === view.currentPlayerId ? ' turn' : ''}`} data-testid={`seat-${seat.id}`} data-player-id={seat.id} data-hand-count={seat.handCount} data-place={seat.exitedPlace ?? ''}>
              <header>
                <strong>{seat.nick}</strong>
                <span>{seatNote(seat, view.phase === 'playing')}</span>
              </header>
              <div className="mini-row">
                {seat.faceDown.map((slot, index) =>
                  slot === 'back' ? <span key={index} className="mini back" /> : <span key={index} className="mini ghost" />,
                )}
              </div>
              <div className="mini-row">
                {seat.faceUp.map((card, index) =>
                  card ? (
                    <span key={card.id} className={`mini face${card.suit === 'hearts' || card.suit === 'diamonds' ? ' red' : ''}`} data-rank={card.rank}>
                      {card.rank}
                    </span>
                  ) : (
                    <span key={`empty-${index}`} className="mini ghost" />
                  ),
                )}
              </div>
            </article>
          ))}
        </div>
        <div data-testid="roster" hidden>
          {view.seats.map((seat) => (
            <span key={seat.id} data-player-id={seat.id} data-nick={seat.nick} data-hand-count={seat.handCount} />
          ))}
        </div>
        <section className="center" data-testid="center">
          {view.centerTop ? (
            <PlayingCard key={view.centerTop.id} card={view.centerTop} testId="center-top" />
          ) : (
            <div className="empty-pile" data-testid="center-top" data-rank="">
              Pusty środek
            </div>
          )}
          <div className="center-meta">
            <span data-testid="center-count">Stos: {view.centerCount}</span>
            <span data-testid="under">Pod spodem: {Math.max(0, view.centerCount - 1)}</span>
            <span data-testid="burned">Spalone: {view.burnedCount}</span>
            {view.outCount > 0 ? <span>Poza grą: {view.outCount}</span> : null}
          </div>
          {view.reveal && view.reveal.outcome !== 'play' ? (
            <div className="reveal" data-testid="reveal">
              <PlayingCard card={view.reveal.card} testId="reveal-card" />
              <span>{view.reveal.outcome === 'low' ? 'Odsłonięta — za niska' : 'Odsłonięta — kasuje stos'}</span>
            </div>
          ) : null}
        </section>
        <p className="banner" data-testid="banner">
          {view.log.at(-1)?.text ?? 'Czekam na ruch.'}
        </p>
        <section className={`mine${view.yourTurn ? ' turn' : ''}`} data-testid="me" data-player-id={me.id} data-hand-count={me.handCount}>
          <header>
            {me.nick} · {seatNote(me, view.phase === 'playing')}
          </header>
          <div className="my-table">
            {me.faceDown.map((slot, index) => {
              const up = me.faceUp[index];
              const downChoice = view.legal.faceDownSlots.includes(index);
              const upChoice = Boolean(up && (view.legal.faceUp.includes(up.id) || view.legal.wayB?.faceUpId === up.id));
              return (
                <div className="col" key={index}>
                  {slot === 'back' ? (
                    <CardBack testId={`me-down-${index}`} choice={downChoice} selected={downSel === index} disabled={!downChoice || locked} onClick={downChoice ? () => toggleDown(index) : undefined} />
                  ) : (
                    <div className="card ghost" />
                  )}
                  {up ? (
                    <PlayingCard
                      card={up}
                      testId={`me-up-${up.id}`}
                      choice={upChoice}
                      selected={upSel === up.id}
                      disabled={!upChoice || locked}
                      onClick={upChoice ? () => toggleUp(up.id) : undefined}
                    />
                  ) : (
                    <div className="card ghost" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="hand" data-testid="hand">
            {(me.hand ?? []).map((card) => {
              const choice = canSelectHand(card.id, view.legal);
              return (
                <PlayingCard
                  key={card.id}
                  card={card}
                  testId={`hand-${card.id}`}
                  choice={choice}
                  selected={handSel.includes(card.id)}
                  disabled={!choice || locked}
                  onClick={() => toggleHand(card.id)}
                />
              );
            })}
          </div>
        </section>
        {view.phase !== 'finished' ? (
          <>
            <p className="hint" data-testid="hint">
              {hint}
            </p>
            {view.legal.wayB && view.yourTurn ? (
              <button
                type="button"
                className="wayb"
                data-testid="mark-way-b"
                disabled={pending}
                onClick={() => {
                  setHandSel(view.legal.wayB!.handIds);
                  setUpSel(view.legal.wayB!.faceUpId);
                  setDownSel(null);
                }}
              >
                Zaznacz 3 + odkrytą
              </button>
            ) : null}
            <div className="actions">
              <button type="button" className="confirm" data-testid="confirm" disabled={!action || pending} onClick={() => action && send({ type: 'action', action }, true)}>
                {confirmLabel(action, pending)}
              </button>
              <button
                type="button"
                className="take"
                data-testid="take-pile"
                disabled={!view.legal.takePile || pending}
                onClick={() => send({ type: 'action', action: { type: 'takePile' } }, true)}
              >
                Weź kupkę
              </button>
            </div>
          </>
        ) : null}
        {view.phase === 'finished' ? (
          <div className="end" data-testid="end">
            <h2>Koniec partii</h2>
            <p className="loser">Przegrywa: {loser?.nick ?? '—'}</p>
            <ol>
              {view.exitOrder.map((place) => (
                <li key={place.id}>
                  {place.place}. {place.nick}
                </li>
              ))}
            </ol>
            {view.seats
              .filter((seat) => seat.dropped)
              .map((seat) => (
                <p key={seat.id}>{seat.nick} odpadł</p>
              ))}
            {view.youId === view.hostId ? (
              <button type="button" data-testid="rematch" disabled={pending} onClick={() => send({ type: 'rematch' }, true)}>
                Jeszcze raz
              </button>
            ) : (
              <p>Czekam na gospodarza.</p>
            )}
          </div>
        ) : null}
      </div>
      <aside className={`log-dock${logOpen ? ' open' : ''}`} data-testid="log">
        <h2>Log partii</h2>
        <ol ref={logRef}>
          {view.log.length === 0 ? <li>Brak zdarzeń.</li> : null}
          {view.log.map((entry) => (
            <li key={entry.id}>{entry.text}</li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function hintText(view: PlayerView, handSel: string[]): string {
  if (view.phase === 'finished') return 'Partia skończona.';
  if (!view.yourTurn) return 'Czekasz na swoją turę.';
  if (view.legal.takePile) return 'Brak ruchu z ręki. Weź kupkę.';
  if (view.legal.faceDownSlots.length > 0) return 'Wybierz zakrytą na ślepo i potwierdź.';
  if (view.legal.faceUp.length > 0) return 'Wybierz odkrytą. Za niska wraca do ręki razem z kupką.';
  if ((handSel.length === 2 || handSel.length === 3) && !(view.legal.wayB && handSel.length === 3)) {
    return 'Dwie albo trzy karty naraz są nielegalne.';
  }
  if (view.legal.wayB) return 'Możesz położyć trzy z ręki razem z odkrytą tej samej wartości.';
  if (view.legal.quads.length > 0) return 'Cztery jednakowe naraz kasują stos. Zaznacz je i potwierdź.';
  return 'Wybierz jedną kartę i potwierdź.';
}
