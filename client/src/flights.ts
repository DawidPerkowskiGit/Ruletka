import type { PlayerView, PublicCard } from 'engine';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Flight {
  key: string;
  card: PublicCard | null;
  from: Box;
  to: Box;
  delay: number;
  duration: number;
  fade: boolean;
}

function timing(count: number, index: number): { delay: number; duration: number } {
  if (count <= 1) return { delay: 0, duration: 380 };
  const stagger = Math.min(180, 80 + count * 8);
  return { delay: index * stagger, duration: 420 + count * 45 };
}

function addFlights(flights: Flight[], items: Omit<Flight, 'delay' | 'duration'>[]): void {
  items.forEach((item, index) => {
    flights.push({ ...item, ...timing(items.length, index) });
  });
}

function kindOf(text: string): 'burn' | 'low' | 'take' | 'private' | 'play' | null {
  if (text.includes('kasuje stos')) return 'burn';
  if (text.includes('Za niska')) return 'low';
  if (text.includes('zakrytą kartę do ręki')) return 'private';
  if (text.includes('bierze kupkę')) return 'take';
  if (text.includes('kładzie') || text.includes('odsłania') || text.includes('gra odkrytą')) return 'play';
  return null;
}

function actorId(text: string, view: PlayerView): string | null {
  const seats = view.seats.slice().sort((left, right) => right.nick.length - left.nick.length);
  return seats.find((seat) => text.startsWith(`${seat.nick} `))?.id ?? null;
}

function cardsOf(entry: PlayerView['log'][number]): PublicCard[] {
  return (entry.parts ?? []).flatMap((part) => (part.type === 'card' ? [part.card] : []));
}

function shift(box: Box, index: number): Box {
  return { x: box.x + index * 4, y: box.y - index * 3, w: box.w, h: box.h };
}

function cardSized(box: Box, sample: Box): Box {
  const portrait = box.h >= box.w * 1.15;
  const close =
    portrait &&
    box.w >= sample.w * 0.75 &&
    box.w <= sample.w * 1.35 &&
    box.h >= sample.h * 0.75 &&
    box.h <= sample.h * 1.35;
  if (close) return box;
  return {
    x: box.x + (box.w - sample.w) / 2,
    y: box.y + (box.h - sample.h) / 2,
    w: sample.w,
    h: sample.h,
  };
}

function pileBox(prev: PlayerView, map: ReadonlyMap<string, Box>): Box | null {
  const top = prev.center.at(-1);
  const card = top ? map.get(`card-${top.id}`) : undefined;
  if (card && card.h >= card.w * 1.15) return card;
  const pile = map.get('pile');
  if (pile && pile.h >= pile.w * 1.15) return pile;
  const section = map.get('center');
  if (!section) return null;
  const w = 68;
  const h = 96;
  return { x: section.x + (section.w - w) / 2, y: section.y + Math.max(0, (section.h - h) / 2), w, h };
}

function vanish(box: Box): Box {
  return { x: box.x, y: box.y - 78, w: box.w, h: box.h };
}

function emptiedDown(prev: PlayerView, next: PlayerView, playerId: string): number | null {
  const before = prev.seats.find((seat) => seat.id === playerId);
  const after = next.seats.find((seat) => seat.id === playerId);
  if (!before || !after) return null;
  for (let index = 0; index < before.faceDown.length; index++) {
    if (before.faceDown[index] === 'back' && after.faceDown[index] !== 'back') return index;
  }
  return null;
}

export function planFlights(
  prev: PlayerView,
  next: PlayerView,
  before: ReadonlyMap<string, Box>,
  after: ReadonlyMap<string, Box>,
): Flight[] {
  if (prev.phase !== 'playing' || next.log.length < prev.log.length) return [];
  const lastId = prev.log.at(-1)?.id ?? 0;
  const fresh = next.log.filter((entry) => entry.id > lastId);
  const flights: Flight[] = [];
  const origin = pileBox(prev, before) ?? pileBox(next, after);
  if (!origin) return [];

  for (const entry of fresh) {
    const kind = kindOf(entry.text);
    const actor = actorId(entry.text, next);
    if (!kind || !actor) continue;
    const seatBox = before.get(`seat-${actor}`) ?? after.get(`seat-${actor}`) ?? null;
    const seat = seatBox ? cardSized(seatBox, origin) : null;
    const downIndex = emptiedDown(prev, next, actor);
    const down = downIndex === null ? null : (before.get(`down-${actor}-${downIndex}`) ?? null);
    const played = cardsOf(entry);
    const fromTable = entry.text.includes('odsłania') || entry.text.includes('gra odkrytą');

    if (kind === 'play') {
      const batch: Omit<Flight, 'delay' | 'duration'>[] = [];
      for (const card of played) {
        const rawFrom = (entry.text.includes('odsłania') ? down : null) ?? before.get(`card-${card.id}`) ?? seatBox;
        const from = rawFrom ? cardSized(rawFrom, origin) : null;
        const rawTo = after.get(`card-${card.id}`) ?? after.get('center');
        const to = rawTo ? cardSized(rawTo, origin) : origin;
        if (!from) continue;
        batch.push({ key: `${entry.id}-${card.id}`, card, from, to, fade: false });
      }
      addFlights(flights, batch);
    }

    if (kind === 'burn') {
      const gone = [...prev.center, ...played.filter((card) => !prev.center.some((item) => item.id === card.id))];
      addFlights(
        flights,
        gone.map((card, index) => {
          const fromHand = before.get(`card-${card.id}`);
          const raw = fromHand ?? (fromTable ? down : null) ?? (prev.center.some((item) => item.id === card.id) ? origin : null) ?? seatBox ?? origin;
          return { key: `${entry.id}-burn-${card.id}`, card, from: shift(cardSized(raw, origin), index), to: vanish(origin), fade: true };
        }),
      );
    }

    if (kind === 'take' || kind === 'low') {
      const moving = kind === 'low' ? [...prev.center, ...played] : prev.center;
      addFlights(
        flights,
        moving.map((card, index) => {
          const from = before.get(`card-${card.id}`) ?? origin;
          const landed = after.get(`card-${card.id}`);
          const to = (landed ? cardSized(landed, origin) : null) ?? seat ?? origin;
          return { key: `${entry.id}-take-${card.id}`, card, from: shift(from, index), to, fade: false };
        }),
      );
    }

    if (kind === 'private') {
      const own = next.youId === actor;
      const previousHand = prev.seats.find((item) => item.id === actor)?.hand ?? [];
      const added = own
        ? (next.seats.find((item) => item.id === actor)?.hand ?? []).find((card) => !previousHand.some((item) => item.id === card.id))
        : null;
      const rawFrom = down ?? seatBox ?? origin;
      const landed = added ? after.get(`card-${added.id}`) : null;
      const from = cardSized(rawFrom, origin);
      const to = (landed ? cardSized(landed, origin) : null) ?? seat ?? origin;
      addFlights(flights, [{ key: `${entry.id}-private`, card: own ? (added ?? null) : null, from, to, fade: false }]);
    }
  }

  return flights;
}
