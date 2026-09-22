import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ClientMessage, GameAction, Legal, LogEntry, PlayerView, PublicCard, SeatView } from 'engine';
import { CardBack, CardChip, PlayingCard } from './cards';
import { type Box, type Flight, planFlights } from './flights';
import { fanPeek, moveCard, reconcileOrder, sameOrder, sortCards } from './handOrder';
import { isRed, suitSymbol } from './labels';

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
  if (action.type === 'playFaceDown') return 'Połóż';
  if (action.type === 'playFaceUp') return 'Połóż odkrytą';
  return 'Połóż';
}

function pileRows(cards: readonly PublicCard[]): { rank: string; top: boolean; suits: PublicCard[] }[] {
  const topId = cards.at(-1)?.id;
  const rows: { rank: string; top: boolean; suits: PublicCard[] }[] = [];
  for (const card of cards) {
    let row = rows.find((item) => item.rank === card.rank);
    if (!row) {
      row = { rank: card.rank, top: false, suits: [] };
      rows.push(row);
    }
    row.suits.push(card);
    if (card.id === topId) row.top = true;
  }
  return rows;
}

function FlyingCard({ flight }: { flight: Flight }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const dx = flight.to.x - flight.from.x;
    const dy = flight.to.y - flight.from.y;
    const startAt = performance.now() + flight.delay;
    let frame = 0;
    const tick = (now: number) => {
      const raw = Math.min(1, Math.max(0, (now - startAt) / flight.duration));
      const t = 1 - (1 - raw) ** 3;
      node.style.width = `${flight.from.w + (flight.to.w - flight.from.w) * t}px`;
      node.style.height = `${flight.from.h + (flight.to.h - flight.from.h) * t}px`;
      node.style.transform = `translate3d(${dx * t}px, ${dy * t}px, 0)`;
      node.style.opacity = flight.fade ? String(1 - t) : '1';
      if (raw < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [flight]);
  return (
    <div
      ref={ref}
      className={`flight card${flight.card && isRed(flight.card.suit) ? ' red' : ''}${flight.card ? '' : ' back'}`}
      data-testid="flight"
      style={{ left: flight.from.x, top: flight.from.y, width: flight.from.w, height: flight.from.h }}
    >
      {flight.card ? (
        <>
          <span className="corner">
            {flight.card.rank}
            <span className="suit">{suitSymbol(flight.card.suit)}</span>
          </span>
          <span className="pips" aria-hidden="true">
            {suitSymbol(flight.card.suit)}
          </span>
        </>
      ) : null}
    </div>
  );
}

function inPlay(seat: SeatView): boolean {
  return !seat.dropped && seat.exitedPlace === null;
}

function seatNote(seat: SeatView, playing: boolean, withHand = true): string {
  const parts: string[] = [];
  if (withHand) parts.push(`${seat.handCount} w ręce`);
  if (seat.ai) parts.push('komputer');
  if (seat.exitedPlace) parts.push(`miejsce ${seat.exitedPlace}`);
  if (seat.dropped) parts.push('odpadł');
  else if (playing && !seat.connected && !seat.ai) parts.push('rozłączony');
  if (seat.isLoser) parts.push('przegrywa');
  return parts.join(' · ');
}

export function Table({ view, pending, logOpen, send }: TableProps) {
  const me = view.seats.find((seat) => seat.id === view.youId);
  const others = view.seats.filter((seat) => seat.id !== view.youId);
  const [handSel, setHandSel] = useState<string[]>([]);
  const [upSel, setUpSel] = useState<string | null>(null);
  const [downSel, setDownSel] = useState<number | null>(null);
  const [pileOpen, setPileOpen] = useState(false);
  const [autoSort, setAutoSort] = useState(() => sessionStorage.getItem('ruletka-hand-auto') !== '0');
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem('ruletka-hand-order') ?? '[]') as unknown;
      return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  const [peek, setPeek] = useState(44);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [cover, setCover] = useState<PublicCard | null>(null);
  const [armed, setArmed] = useState<null | 'end' | 'restart' | 'resign'>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const prevView = useRef(view);
  const positions = useRef<Map<string, Box>>(new Map());
  const flightTimer = useRef<number | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const pileRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: string; pointerId: number; x: number; y: number; mode: 'pending' | 'lift' | 'ignore' } | null>(null);
  const dropRef = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const hand = me?.hand ?? [];
  const handKey = hand.map((card) => card.id).join('|');
  const cardsRef = useRef(hand);
  cardsRef.current = hand;

  useEffect(() => {
    setHandSel([]);
    setUpSel(null);
    setDownSel(null);
    setPileOpen(false);
    setArmed(null);
    setMoreOpen(false);
  }, [view.revision]);

  useEffect(() => {
    setOrder((previous) => {
      const next = reconcileOrder(previous, cardsRef.current, autoSort);
      return sameOrder(previous, next) ? previous : next;
    });
  }, [handKey, autoSort]);

  useEffect(() => {
    sessionStorage.setItem('ruletka-hand-auto', autoSort ? '1' : '0');
    sessionStorage.setItem('ruletka-hand-order', JSON.stringify(order));
  }, [autoSort, order]);

  useEffect(() => {
    if (!pileOpen) return;
    const close = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && pileRef.current?.contains(target)) return;
      setPileOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [pileOpen]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [view.log.length, logOpen]);

  const byId = new Map(hand.map((card) => [card.id, card]));
  const shownIds = reconcileOrder(order, hand, autoSort);
  const ordered = shownIds.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
  const gaps = ordered.reduce((count, card, index) => (index > 0 && card.rank !== ordered[index - 1]?.rank ? count + 1 : count), 0);

  useEffect(() => {
    const strip = handRef.current;
    if (!strip) return;
    const measure = () => {
      const card = strip.querySelector<HTMLElement>('.card');
      const cardWidth = card?.getBoundingClientRect().width || 56;
      setPeek(fanPeek(cardWidth, ordered.length, strip.clientWidth, gaps * 14));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [handKey, gaps, ordered.length]);

  useLayoutEffect(() => {
    const measured = new Map<string, Box>();
    document.querySelectorAll<HTMLElement>('[data-fly-id]').forEach((node) => {
      const id = node.dataset.flyId;
      if (!id) return;
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      measured.set(id, { x: rect.x, y: rect.y, w: rect.width, h: rect.height });
    });
    const previous = prevView.current;
    if (previous && previous !== view) {
      const planned = planFlights(previous, view, positions.current, measured);
      if (planned.length > 0) {
        const total = planned.reduce((max, flight) => Math.max(max, flight.delay + flight.duration), 0) + 30;
        setFlights(planned);
        setHeld(new Set(planned.flatMap((flight) => (flight.card && !flight.fade ? [flight.card.id] : []))));
        const landingId = view.centerTop?.id;
        const lands = Boolean(landingId && planned.some((flight) => !flight.fade && flight.card?.id === landingId));
        const previousTop = previous.centerTop;
        setCover(lands && previousTop && previousTop.id !== landingId ? previousTop : null);
        if (flightTimer.current !== null) window.clearTimeout(flightTimer.current);
        flightTimer.current = window.setTimeout(() => {
          setFlights([]);
          setHeld(new Set());
          setCover(null);
        }, total);
      }
    }
    positions.current = measured;
    prevView.current = view;
  }, [view]);

  if (!me) return null;

  const action = view.yourTurn ? chosenAction(view.legal, handSel, upSel, downSel) : null;
  const current = view.seats.find((seat) => seat.id === view.currentPlayerId);
  const loser = view.seats.find((seat) => seat.id === view.loserId);
  const locked = pending || !view.yourTurn;

  function toggleHand(id: string) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (locked || !canSelectHand(id, view.legal)) return;
    setDownSel(null);
    setHandSel((currentIds) => (currentIds.includes(id) ? currentIds.filter((item) => item !== id) : [...currentIds, id]));
  }

  function sortNow() {
    setOrder(sortCards(hand).map((card) => card.id));
  }

  function onCardPointerDown(event: PointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0) return;
    gesture.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, mode: 'pending' };
  }

  function onCardPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.mode === 'pending') {
      if (Math.hypot(dx, dy) < 10) return;
      if (dy < -12 && Math.abs(dy) > Math.abs(dx) * 0.75) {
        drag.mode = 'lift';
        event.currentTarget.setPointerCapture(event.pointerId);
        setDraggingId(drag.id);
      } else {
        drag.mode = 'ignore';
      }
      return;
    }
    if (drag.mode !== 'lift' || !handRef.current) return;
    const slots = [...handRef.current.querySelectorAll<HTMLElement>('[data-fan-index]')];
    let insertAt = 0;
    for (const slot of slots) {
      const box = slot.getBoundingClientRect();
      if (event.clientX > box.left + box.width / 2) insertAt = Number(slot.dataset.fanIndex) + 1;
    }
    dropRef.current = insertAt;
    setDropAt(insertAt);
  }

  function onCardPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = gesture.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    gesture.current = null;
    if (drag.mode === 'ignore') suppressClick.current = true;
    if (drag.mode === 'lift') {
      suppressClick.current = true;
      const insertAt = dropRef.current ?? order.indexOf(drag.id);
      setAutoSort(false);
      setOrder((previous) => moveCard(previous, drag.id, insertAt));
    }
    dropRef.current = null;
    setDraggingId(null);
    setDropAt(null);
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
  const hostPlaying = view.phase === 'playing' && view.youId === view.hostId;
  const contenders = view.seats.filter(inPlay);
  const canResign = view.phase === 'playing' && contenders.length === 2 && contenders.some((seat) => seat.id === view.youId);

  function arm(kind: 'end' | 'restart' | 'resign', message: ClientMessage) {
    if (pending) return;
    if (armed === kind) {
      setArmed(null);
      setMoreOpen(false);
      send(message, true);
      return;
    }
    setArmed(kind);
  }

  return (
    <div className="play-layout">
      <div className="play-main">
        {view.phase !== 'finished' && (hand.length > 0 || hostPlaying) ? (
          <div className="more">
            <button type="button" data-testid="more" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
              {moreOpen ? 'Zamknij' : 'Więcej'}
            </button>
            {moreOpen ? (
              <div className="more-list">
                {hand.length > 0 ? (
                  <>
                    <button type="button" data-testid="hand-mode" aria-pressed={autoSort} onClick={() => setAutoSort((value) => !value)}>
                      {autoSort ? 'Autosort' : 'Ręcznie'}
                    </button>
                    <button type="button" data-testid="hand-sort" onClick={sortNow}>
                      Ręczny sort
                    </button>
                  </>
                ) : null}
                {hostPlaying ? (
                  <button type="button" data-testid="end-game" disabled={pending} onClick={() => arm('end', { type: 'endGame' })}>
                    {armed === 'end' ? 'Potwierdź zakończenie' : 'Zakończ grę'}
                  </button>
                ) : null}
                {hostPlaying ? (
                  <button type="button" data-testid="restart-game" disabled={pending} onClick={() => arm('restart', { type: 'rematch' })}>
                    {armed === 'restart' ? 'Potwierdź restart' : 'Zrestartuj grę'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="opponents">
          {others.map((seat) => (
            <article key={seat.id} className={`seat${seat.id === view.currentPlayerId ? ' turn' : ''}`} data-testid={`seat-${seat.id}`} data-fly-id={`seat-${seat.id}`} data-player-id={seat.id} data-hand-count={seat.handCount} data-place={seat.exitedPlace ?? ''}>
              <header>
                <strong>{seat.nick}</strong>
                <span className="seat-long">{seatNote(seat, view.phase === 'playing')}</span>
                <span className="seat-short">{seat.handCount}</span>
              </header>
              <div className="table-slots">
                {seat.faceDown.map((slot, index) => {
                  const card = seat.faceUp[index];
                  return (
                    <div className="stack" key={index}>
                      {slot === 'back' ? <CardBack flyId={`down-${seat.id}-${index}`} /> : <div className="card ghost" />}
                      {card ? <PlayingCard card={card} flyId={`card-${card.id}`} /> : <div className="card ghost" />}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
        <div data-testid="roster" hidden>
          {view.seats.map((seat) => (
            <span key={seat.id} data-player-id={seat.id} data-nick={seat.nick} data-hand-count={seat.handCount} />
          ))}
        </div>
        <section className="center" data-testid="center" data-fly-id="center" data-center-count={view.centerCount} data-burned={view.burnedCount}>
          <div className={`pile${pileOpen ? ' open' : ''}`} ref={pileRef}>
            {view.centerTop ? (
              <button
                type="button"
                className="pile-hit"
                data-fly-id="pile"
                data-testid="pile-toggle"
                aria-expanded={pileOpen}
                aria-label="Pokaż karty na kupce"
                onClick={() => setPileOpen((open) => !open)}
              >
                <PlayingCard key={view.centerTop.id} card={view.centerTop} testId="center-top" flyId={`card-${view.centerTop.id}`} held={held.has(view.centerTop.id)} />
                {cover ? (
                  <span className="pile-cover">
                    <PlayingCard card={cover} />
                  </span>
                ) : null}
              </button>
            ) : (
              <button
                type="button"
                className="empty-pile"
                data-testid="center-top"
                data-fly-id="pile"
                data-rank=""
                aria-expanded={pileOpen}
                aria-label="Pokaż stos"
                onClick={() => setPileOpen((open) => !open)}
              >
                Pusty środek
              </button>
            )}
            <div className="pile-list" data-testid="pile-list">
              <p className="pile-stats">
                <span data-testid="center-count">Na stosie: {view.centerCount}</span>
                <span data-testid="burned">Spalone: {view.burnedCount}</span>
              </p>
              {view.center.length > 0 ? (
                <ol>
                  {pileRows(view.center).map((row) => (
                    <li key={row.rank}>
                      <span className="pile-rank">{row.rank}</span>
                      <span className="pile-suits">
                        {row.suits.map((card) => (
                          <span key={card.id} className={isRed(card.suit) ? 'red' : ''} data-testid={`pile-${card.id}`} data-suit={card.suit}>
                            {suitSymbol(card.suit)}
                          </span>
                        ))}
                      </span>
                      {row.top ? <span className="pile-tag">wierzch</span> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </div>
          {view.reveal && view.reveal.outcome !== 'play' ? (
            <div className="reveal" data-testid="reveal">
              <PlayingCard card={view.reveal.card} testId="reveal-card" />
              <span>{view.reveal.outcome === 'low' ? 'Odsłonięta — za niska' : 'Odsłonięta — kasuje stos'}</span>
            </div>
          ) : null}
        </section>
        {view.handNote ? (
          <p className="private-note" data-testid="private-note">
            Tylko ty widzisz: <CardChip card={view.handNote} />
          </p>
        ) : null}
        <section className={`mine${view.yourTurn ? ' turn' : ''}`} data-testid="me" data-fly-id={`seat-${me.id}`} data-player-id={me.id} data-hand-count={me.handCount}>
          <header>
            {me.nick}
            <span className="own-hand-count"> · {me.handCount} w ręce</span>
            {seatNote(me, view.phase === 'playing', false) ? ` · ${seatNote(me, view.phase === 'playing', false)}` : ''}
          </header>
          <div className="my-table">
            {me.faceDown.map((slot, index) => {
              const up = me.faceUp[index];
              const downChoice = view.legal.faceDownSlots.includes(index);
              const upChoice = Boolean(up && (view.legal.faceUp.includes(up.id) || view.legal.wayB?.faceUpId === up.id));
              return (
                <div className="col stack" key={index}>
                  {slot === 'back' ? (
                    <CardBack testId={`me-down-${index}`} flyId={`down-${me.id}-${index}`} choice={downChoice} selected={downSel === index} disabled={!downChoice || locked} onClick={downChoice ? () => toggleDown(index) : undefined} />
                  ) : (
                    <div className="card ghost" />
                  )}
                  {up ? (
                    <PlayingCard
                      card={up}
                      testId={`me-up-${up.id}`}
                      flyId={`card-${up.id}`}
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
          <p className="between-count">{me.handCount} w ręce</p>
          <div
            className="hand"
            data-testid="hand"
            data-hand-mode={autoSort ? 'auto' : 'manual'}
            ref={handRef}
            style={{ '--peek': `${peek}px` } as CSSProperties}
          >
            {ordered.map((card, index) => {
              const choice = canSelectHand(card.id, view.legal);
              const grouped = index > 0 && card.rank !== ordered[index - 1]?.rank;
              return (
                <div
                  key={card.id}
                  className={['fan-slot', grouped ? 'group' : '', draggingId === card.id ? 'dragging' : '', dropAt === index ? 'drop-before' : ''].filter(Boolean).join(' ')}
                  style={{ zIndex: draggingId === card.id ? 20 : index + 1 }}
                  data-fan-index={index}
                  data-rank={card.rank}
                  onPointerDown={(event) => onCardPointerDown(event, card.id)}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={onCardPointerUp}
                  onPointerCancel={onCardPointerUp}
                >
                  <PlayingCard
                    card={card}
                    testId={`hand-${card.id}`}
                  flyId={`card-${card.id}`}
                  held={held.has(card.id)}
                    choice={choice}
                    selected={handSel.includes(card.id)}
                    disabled={!choice || locked}
                    onClick={() => toggleHand(card.id)}
                  />
                </div>
              );
            })}
          </div>
        </section>
        <p className="banner" data-testid="banner">
          {view.log.at(-1) ? <LogText entry={view.log.at(-1)!} /> : 'Czekam na ruch.'}
        </p>
        <div className={`turn-banner${view.yourTurn ? ' mine' : ''}`} data-testid="turn" data-yours={view.yourTurn ? '1' : '0'} data-player={view.currentPlayerId ?? ''}>
          {view.phase === 'finished' ? 'Koniec partii' : view.yourTurn ? 'Twoja tura' : `Tura: ${current?.nick ?? '—'}`}
        </div>
        {view.phase !== 'finished' && canResign ? (
          <div className="table-tools">
            <button type="button" className="resign" data-testid="resign" disabled={pending} onClick={() => arm('resign', { type: 'resign' })}>
              {armed === 'resign' ? 'Potwierdź poddanie' : 'Poddaj się'}
            </button>
          </div>
        ) : null}
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
              {view.legal.faceDownSlots.length > 0 && view.yourTurn ? (
                <button
                  type="button"
                  className="take-down"
                  data-testid="take-down"
                  disabled={downSel === null || pending || !view.legal.faceDownSlots.includes(downSel)}
                  onClick={() => downSel !== null && send({ type: 'action', action: { type: 'takeFaceDown', slot: downSel } }, true)}
                >
                  Weź
                </button>
              ) : null}
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
            <p className="loser">{loser ? `Przegrywa: ${loser.nick}` : 'Gospodarz zakończył partię.'}</p>
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
              <>
                <button type="button" className="primary" data-testid="rematch" disabled={pending} onClick={() => send({ type: 'rematch' }, true)}>
                  Jeszcze raz
                </button>
                <button type="button" className="leave" data-testid="home-exit" disabled={pending} onClick={() => send({ type: 'leave' }, true)}>
                  Strona główna
                </button>
              </>
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
            <li key={entry.id}>
              <LogText entry={entry} />
            </li>
          ))}
        </ol>
      </aside>
      {flights.length > 0
        ? createPortal(
            flights.map((flight) => <FlyingCard key={flight.key} flight={flight} />),
            document.body,
          )
        : null}
    </div>
  );
}

function LogText({ entry }: { entry: LogEntry }) {
  if (!entry.parts || entry.parts.length === 0) return <>{entry.text}</>;
  return (
    <>
      {entry.parts.map((part, index) =>
        part.type === 'text' ? <span key={index}>{part.text}</span> : <CardChip key={`${part.card.id}-${index}`} card={part.card} />,
      )}
    </>
  );
}

function mustTake(legal: Legal): boolean {
  return (
    legal.takePile &&
    legal.singles.length === 0 &&
    legal.quads.length === 0 &&
    legal.wayB === null &&
    legal.faceUp.length === 0 &&
    legal.faceDownSlots.length === 0
  );
}

function hintText(view: PlayerView, handSel: string[]): string {
  if (view.phase === 'finished') return 'Partia skończona.';
  if (!view.yourTurn) return 'Czekasz na swoją turę.';
  if (mustTake(view.legal)) return 'Brak ruchu z ręki. Weź kupkę.';
  if (view.legal.faceDownSlots.length > 0) {
    return 'Wybierz zakrytą. Połóż kładzie ją na stół. Weź — widzisz ją tylko ty, potem grasz z ręki.';
  }
  if (view.legal.faceUp.length > 0) {
    return view.legal.takePile
      ? 'Wybierz odkrytą albo weź kupkę. Za niska wraca do ręki razem z kupką.'
      : 'Wybierz odkrytą. Za niska wraca do ręki razem z kupką.';
  }
  if (handSel.length > 4) return 'Naraz kładziesz jedną kartę albo dokładnie cztery takie same.';
  if (handSel.length === 4 && !view.legal.quads.some((quad) => sameIds(quad, handSel))) {
    return 'Czwórka musi mieć tę samą wartość.';
  }
  if ((handSel.length === 2 || handSel.length === 3) && !(view.legal.wayB && handSel.length === 3)) {
    return 'Dwie albo trzy karty naraz są nielegalne. Jedna karta albo dokładnie cztery takie same.';
  }
  if (view.legal.wayB) return 'Możesz położyć trzy z ręki razem z odkrytą albo wziąć kupkę.';
  if (view.legal.quads.length > 0) return 'Stuknij cztery jednakowe, potem „Połóż cztery”. Albo jedną kartę.';
  return view.legal.takePile ? 'Wybierz jedną kartę i potwierdź albo weź kupkę.' : 'Wybierz jedną kartę i potwierdź.';
}
