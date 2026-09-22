import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.BASE ?? 'http://127.0.0.1:3000';
const touch = process.argv.includes('--touch');
const outDir = touch ? '.trial/phone' : '.trial/desktop';

function card(rank, suit) {
  return { id: `${rank}-${suit}`, rank, suit };
}
function slots(cards = [null, null, null]) {
  return [cards[0] ?? null, cards[1] ?? null, cards[2] ?? null];
}
function seat(id, nick, hand, faceUp, faceDown) {
  return {
    id,
    nick,
    hand,
    faceUp: slots(faceUp),
    faceDown: slots(faceDown),
    exitedPlace: null,
    dropped: false,
  };
}
function game(players, currentIndex, center = [], extra = {}) {
  return {
    players,
    startIndex: currentIndex ?? 0,
    currentIndex,
    center,
    burnedCount: extra.burnedCount ?? 0,
    outCount: 0,
    phase: extra.phase ?? 'playing',
    exitOrder: extra.exitOrder ?? [],
    loserId: extra.loserId ?? null,
    log: [],
    reveal: null,
  };
}

const results = [];
function pass(name) {
  results.push({ name, ok: true });
  console.log(`PASS  ${name}`);
}
function fail(name, error) {
  results.push({ name, ok: false, error: String(error) });
  console.error(`FAIL  ${name}`);
  console.error(error);
}

async function shot(page, name) {
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
}

async function revision(page) {
  return page.locator('.app').getAttribute('data-revision');
}

async function waitRev(pages, previous) {
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction((prev) => {
        const next = document.querySelector('.app')?.getAttribute('data-revision');
        return Boolean(next && next !== prev);
      }, previous),
    ),
  );
}

async function sameText(pages, testId) {
  const values = await Promise.all(pages.map((page) => page.getByTestId(testId).innerText()));
  if (new Set(values).size !== 1) throw new Error(`${testId}: ${values.join(' | ')}`);
  return values[0];
}

async function press(locator) {
  if (touch) await locator.tap();
  else await locator.click();
}

async function layout(page) {
  return page.evaluate(() => {
    const app = document.querySelector('.app');
    const box = app?.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      appHeight: box?.height ?? 0,
      innerHeight: window.innerHeight,
    };
  });
}

async function targetBox(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('brak pola kliknięcia');
  if (box.width < 44 || box.height < 44) throw new Error(`cel ${Math.round(box.width)}×${Math.round(box.height)}`);
  return box;
}

async function setup(request, pages, code, ids, build) {
  const state = build(ids);
  const seen = new Set();
  const cards = [...state.players.flatMap((player) => [...player.hand, ...player.faceUp, ...player.faceDown]), ...state.center];
  for (const item of cards) {
    if (!item) continue;
    if (seen.has(item.id)) throw new Error(`duplikat karty ${item.id}`);
    seen.add(item.id);
  }
  const before = await revision(pages[0]);
  const response = await request.post(`${base}/__trial/state`, {
    data: { code, game: state },
  });
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
  await waitRev(pages, before);
}

async function run() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const size = touch ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const contexts = await Promise.all(
    ['Ala', 'Bartek', 'Celina'].map(() =>
      browser.newContext({
        viewport: size,
        hasTouch: touch,
        isMobile: touch,
        locale: 'pl-PL',
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  for (const page of pages) page.on('pageerror', (error) => console.error('PAGE', error));
  const [host, bartek, celina] = pages;
  pages.forEach((page) => page.setDefaultTimeout(12_000));
  const request = contexts[0].request;
  let code = '';
  let ids = [];

  try {
    await host.goto(base);
    await host.getByTestId('conn').filter({ hasText: 'Połączono' }).waitFor();
    await host.getByTestId('nick').fill('Ala');
    await press(host.getByTestId('create-private'));
    await host.getByTestId('code').waitFor();
    code = (await host.getByTestId('code').innerText()).trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error(`zły kod ${code}`);
    pass('założenie prywatnego stołu');
    await shot(host, '01-lobby');

    for (const [page, nick] of [
      [bartek, 'Bartek'],
      [celina, 'Celina'],
    ]) {
      await page.goto(base);
      await page.getByRole('heading', { name: 'Otwarte stoły' }).waitFor();
      if ((await page.getByTestId(`room-${code}`).count()) !== 0) throw new Error('prywatny stół jest na liście');
      await page.goto(`${base}/gra/${code}`);
      await page.getByTestId('conn').filter({ hasText: 'Połączono' }).waitFor();
      await page.getByTestId('nick').fill(nick);
      await page.getByTestId('join-code').fill(code);
      await press(page.getByTestId('join-submit'));
      await page.getByTestId('code').waitFor();
    }
    await host.waitForFunction(() => {
      const button = document.querySelector('[data-testid="start"]');
      return Boolean(button && !button.disabled);
    });
    pass('dołączenie trzech graczy, prywatny stół poza listą');

    await press(host.getByTestId('start'));
    await host.locator('.app[data-phase="playing"]').waitFor();
    await bartek.locator('.app[data-phase="playing"]').waitFor();
    await celina.locator('.app[data-phase="playing"]').waitFor();

    const roster = await host.locator('[data-testid="roster"] [data-player-id]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute('data-player-id'),
        hand: Number(node.getAttribute('data-hand-count')),
      })),
    );
    ids = roster.map((item) => item.id);
    const current = await host.getByTestId('turn').getAttribute('data-player');
    const start = ids.indexOf(current);
    const hands = roster.map((item) => item.hand).sort((left, right) => right - left);
    if (JSON.stringify(hands) !== JSON.stringify([12, 11, 11])) throw new Error(`ręce ${hands.join(',')}`);
    const opening = await host.getByTestId('banner').innerText();
    if (!opening.includes('najniższą kartę')) throw new Error(opening);
    if ((await host.getByTestId('banner').locator('[data-rank="2"][data-suit="hearts"]').count()) !== 1) {
      throw new Error(opening);
    }
    const sum = roster.reduce((total, item) => total + item.hand, 0);
    if (sum !== 34) throw new Error(`suma rąk ${sum}`);
    for (const page of pages) {
      if ((await page.locator('[data-testid^="me-down-"]').count()) !== 3) throw new Error('brak 3 zakrytych');
      if ((await page.locator('[data-testid^="me-up-"]').count()) !== 3) throw new Error('brak 3 odkrytych');
    }
    const ownHand = await host.locator('[data-testid^="hand-"][data-rank]').count();
    if (ownHand !== roster[0].hand) throw new Error('widok ręki nie zgadza się z liczbą');
    const leaked = await bartek.locator(`[data-testid^="hand-"][data-rank]`).count();
    const bartekHand = roster.find((item) => item.id === ids[1]).hand;
    if (leaked !== bartekHand) throw new Error('cudza ręka jest odkryta');
    pass('rozdanie 3 graczy: 12, 11, 11 oraz zasłonięte ręce');

    for (const page of pages) {
      const metrics = await layout(page);
      if (metrics.scrollWidth > metrics.clientWidth + 1) throw new Error(`poziomy scroll ${metrics.scrollWidth}>${metrics.clientWidth}`);
      if (metrics.appHeight > metrics.innerHeight + 1) throw new Error(`wysokość ${metrics.appHeight}>${metrics.innerHeight}`);
    }
    pass(touch ? 'telefon mieści stół bez poziomego przewijania' : 'desktop mieści stół bez poziomego przewijania');
    await shot(pages[start], '02-rozdanie');

    const actor = pages[start];
    const natural = actor.locator('[data-testid^="hand-"][data-rank]').first();
    await targetBox(natural);
    await targetBox(actor.getByTestId('confirm'));
    await targetBox(actor.getByTestId('take-pile'));
    const beforeNatural = await revision(host);
    await press(natural);
    await press(actor.getByTestId('confirm'));
    await waitRev(pages, beforeNatural);
    if ((await sameText(pages, 'center-count')) !== 'Stos: 1') throw new Error(await sameText(pages, 'center-count'));
    pass(touch ? 'dotyk: zagranie karty z prawdziwego rozdania' : 'zagranie karty z prawdziwego rozdania');

    const [ala, bart, cela] = ids;

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(ala, 'Ala', [card('7', 'hearts'), card('2', 'diamonds')], [card('4', 'clubs')], [card('3', 'clubs')]),
          seat(bart, 'Bartek', [card('A', 'hearts'), card('8', 'clubs')], [card('6', 'diamonds')], [card('4', 'diamonds')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('2', 'spades')]),
        ],
        0,
        [card('7', 'spades')],
      ),
    );
    if (await host.locator('[data-testid="hand-2-diamonds"]').isEnabled()) throw new Error('słabsza karta jest klikalna przy siódemce na stole');
    const beforeEqual = await revision(host);
    await press(host.getByTestId('hand-7-hearts'));
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeEqual);
    if ((await host.getByTestId('center-top').getAttribute('data-rank')) !== '7') throw new Error('równa karta nie weszła');
    if ((await sameText(pages, 'center-count')) !== 'Stos: 2') throw new Error('rozjazd stosu po równej karcie');
    pass('zwykła karta równa');

    const beforeHigher = await revision(host);
    await press(bartek.getByTestId('hand-A-hearts'));
    await press(bartek.getByTestId('confirm'));
    await waitRev(pages, beforeHigher);
    if ((await sameText(pages, 'center-count')) !== 'Stos: 3') throw new Error('rozjazd po wyższej karcie');
    if ((await host.getByTestId('center-top').getAttribute('data-rank')) !== 'A') throw new Error('wyższa karta nie weszła');
    pass('zwykła karta wyższa');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(ala, 'Ala', [card('6', 'hearts')], [card('4', 'clubs')], [card('3', 'clubs')]),
          seat(bart, 'Bartek', [card('9', 'spades')], [card('9', 'diamonds')], [card('2', 'hearts')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('8', 'spades')], [card('3', 'diamonds')]),
        ],
        0,
        [card('7', 'spades')],
      ),
    );
    if (await host.getByTestId('hand-6-hearts').isEnabled()) throw new Error('słabsza karta z ręki dała się wybrać');
    if (await host.getByTestId('confirm').isEnabled()) throw new Error('potwierdzenie słabszej karty jest aktywne');
    if (!(await host.getByTestId('take-pile').isEnabled())) throw new Error('brak Weź kupkę');
    await targetBox(host.getByTestId('take-pile'));
    const beforeTake = await revision(host);
    await press(host.getByTestId('take-pile'));
    await waitRev(pages, beforeTake);
    if ((await sameText(pages, 'center-count')) !== 'Stos: 0') throw new Error('kupka została na stole');
    if ((await host.getByTestId('me').getAttribute('data-hand-count')) !== '2') throw new Error('kupka nie wróciła do ręki');
    if (!(await host.getByTestId('banner').innerText()).includes('bierze kupkę')) throw new Error('log nie mówi o kupce');
    pass('odmowa słabszej karty i wzięcie kupki');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(ala, 'Ala', [card('5', 'hearts'), card('9', 'clubs')], [card('4', 'clubs')], [card('3', 'clubs')]),
          seat(bart, 'Bartek', [card('3', 'diamonds'), card('8', 'clubs')], [card('6', 'diamonds')], [card('2', 'hearts')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('4', 'diamonds')]),
        ],
        0,
        [card('A', 'spades')],
      ),
    );
    const beforeFive = await revision(host);
    await press(host.getByTestId('hand-5-hearts'));
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeFive);
    if ((await sameText(pages, 'burned')) !== 'Spalone: 0') throw new Error('piątka skasowała stos');
    if ((await host.getByTestId('center-top').getAttribute('data-rank')) !== '5') throw new Error('piątka nie leży na asie');
    const beforeThree = await revision(host);
    await press(bartek.getByTestId('hand-3-diamonds'));
    await press(bartek.getByTestId('confirm'));
    await waitRev(pages, beforeThree);
    if ((await host.getByTestId('center-top').getAttribute('data-rank')) !== '3') throw new Error('trójka nie weszła na piątkę');
    if ((await sameText(pages, 'center-count')) !== 'Stos: 3') throw new Error('rozjazd po piątce');
    pass('piątka na wysoką kartę i dowolna karta na piątkę');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(ala, 'Ala', [card('10', 'hearts'), card('2', 'clubs')], [card('4', 'clubs')], [card('3', 'clubs')]),
          seat(bart, 'Bartek', [card('9', 'spades')], [card('6', 'diamonds')], [card('2', 'hearts')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('4', 'diamonds')]),
        ],
        0,
        [card('A', 'spades')],
      ),
    );
    const beforeTen = await revision(host);
    await press(host.getByTestId('hand-10-hearts'));
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeTen);
    if ((await sameText(pages, 'center-count')) !== 'Stos: 0') throw new Error('dziesiątka nie skasowała stosu');
    if ((await sameText(pages, 'burned')) !== 'Spalone: 2') throw new Error(await sameText(pages, 'burned'));
    if ((await host.getByTestId('turn').getAttribute('data-yours')) !== '1') throw new Error('tura uciekła po dziesiątce');
    if ((await bartek.getByTestId('turn').getAttribute('data-yours')) !== '0') throw new Error('Bartek dostał turę po cudzej dziesiątce');
    const beforeOpen = await revision(host);
    await press(host.getByTestId('hand-2-clubs'));
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeOpen);
    if ((await host.getByTestId('center-top').getAttribute('data-rank')) !== '2') throw new Error('ten sam gracz nie otworzył nowego stosu');
    pass('dziesiątka kasuje stos i ten sam gracz gra dalej');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(
            ala,
            'Ala',
            [card('K', 'hearts'), card('K', 'diamonds'), card('K', 'clubs'), card('K', 'spades'), card('2', 'hearts')],
            [card('4', 'clubs')],
            [card('3', 'clubs')],
          ),
          seat(bart, 'Bartek', [card('9', 'spades')], [card('6', 'diamonds')], [card('2', 'clubs')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('4', 'diamonds')]),
        ],
        0,
        [card('3', 'diamonds'), card('A', 'clubs')],
      ),
    );
    await press(host.getByTestId('hand-K-hearts'));
    if (await host.getByTestId('confirm').isEnabled()) throw new Error('jeden król skasowałby stos');
    for (const suit of ['diamonds', 'clubs', 'spades']) await press(host.getByTestId(`hand-K-${suit}`));
    if (!(await host.getByTestId('confirm').isEnabled())) throw new Error('czwórka z ręki nie dała się potwierdzić');
    const beforeQuads = await revision(host);
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeQuads);
    if ((await sameText(pages, 'center-count')) !== 'Stos: 0') throw new Error('czwórka nie skasowała stosu');
    if ((await sameText(pages, 'burned')) !== 'Spalone: 6') throw new Error(await sameText(pages, 'burned'));
    if ((await host.getByTestId('turn').getAttribute('data-yours')) !== '1') throw new Error('tura nie została przy graczu po czwórce');
    if ((await host.locator('[data-testid^="hand-"][data-rank]').count()) !== 1) throw new Error('z ręki zniknęło za dużo kart');
    pass('cztery takie same z ręki');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(
            ala,
            'Ala',
            [card('7', 'hearts'), card('7', 'diamonds'), card('7', 'clubs')],
            [card('7', 'spades')],
            [card('3', 'spades'), card('4', 'hearts'), card('5', 'clubs')],
          ),
          seat(bart, 'Bartek', [card('9', 'spades')], [card('6', 'diamonds')], [card('2', 'hearts')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('4', 'diamonds')]),
        ],
        0,
        [card('A', 'diamonds')],
      ),
    );
    if ((await host.getByTestId('mark-way-b').count()) !== 1) throw new Error('brak przycisku 3+1');
    await targetBox(host.getByTestId('mark-way-b'));
    await press(host.getByTestId('mark-way-b'));
    const beforeWay = await revision(host);
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeWay);
    if ((await sameText(pages, 'burned')) !== 'Spalone: 5') throw new Error(await sameText(pages, 'burned'));
    if ((await host.locator('[data-rank="3"]').count()) !== 0) throw new Error('zakryta pod spodem została pokazana');
    if ((await bartek.locator('[data-rank="3"]').count()) !== 0) throw new Error('zakryta widać u przeciwnika');
    if ((await host.getByTestId('me-down-0').count()) !== 1) throw new Error('zakryty slot zniknął');
    pass('trzy z ręki plus odkryta, zakryta zostaje zakryta');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(
            ala,
            'Ala',
            [card('7', 'hearts'), card('7', 'diamonds'), card('7', 'clubs'), card('2', 'spades')],
            [card('7', 'spades')],
            [card('3', 'hearts')],
          ),
          seat(bart, 'Bartek', [card('9', 'spades')], [card('6', 'diamonds')], [card('2', 'hearts')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('4', 'diamonds')]),
        ],
        0,
        [],
      ),
    );
    if ((await host.getByTestId('mark-way-b').count()) !== 0) throw new Error('3+1 jest dostępne mimo czwartej karty');
    for (const suit of ['hearts', 'diamonds', 'clubs']) await press(host.getByTestId(`hand-7-${suit}`));
    if (await host.getByTestId('confirm').isEnabled()) throw new Error('trzy karty dały się potwierdzić');
    if ((await host.getByTestId('me-up-7-spades').evaluate((node) => node.tagName)) !== 'DIV') {
      throw new Error('odkryta dała się kliknąć przy ręce większej niż trzy');
    }
    if ((await sameText(pages, 'center-count')) !== 'Stos: 0') throw new Error('nielegalne 3+1 zmieniło stół');
    pass('odrzucenie 3+1, gdy w ręce jest czwarta karta');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(ala, 'Ala', [], [card('4', 'hearts'), card('9', 'clubs')], [card('2', 'spades'), card('3', 'diamonds'), card('6', 'clubs')]),
          seat(bart, 'Bartek', [card('9', 'spades')], [card('6', 'diamonds')], [card('2', 'hearts')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('4', 'diamonds')]),
        ],
        0,
        [card('A', 'spades'), card('K', 'hearts')],
      ),
    );
    const beforeLowUp = await revision(host);
    await press(host.getByTestId('me-up-4-hearts'));
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeLowUp);
    if ((await sameText(pages, 'center-count')) !== 'Stos: 0') throw new Error('za niska odkryta została na środku');
    if ((await host.getByTestId('me').getAttribute('data-hand-count')) !== '3') throw new Error('kupka i karta nie wróciły do ręki');
    if ((await host.locator('[data-testid="hand-4-hearts"]').count()) !== 1) throw new Error('odkryta nie weszła do ręki');
    if ((await bartek.locator('[data-testid="hand-4-hearts"]').count()) !== 0) throw new Error('karta z ręki Ali widać u Bartka');
    pass('za niska odkryta: kupka i karta wracają do ręki');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(ala, 'Ala', [], [null, null, null], [card('3', 'hearts'), card('9', 'clubs')]),
          seat(bart, 'Bartek', [card('9', 'spades')], [card('6', 'diamonds')], [card('2', 'hearts')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('4', 'diamonds')]),
        ],
        0,
        [card('Q', 'diamonds')],
      ),
    );
    const beforeLowDown = await revision(host);
    await press(host.getByTestId('me-down-0'));
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeLowDown);
    if ((await sameText(pages, 'center-count')) !== 'Stos: 0') throw new Error('za niska zakryta została na środku');
    for (const page of pages) {
      if ((await page.getByTestId('reveal-card').getAttribute('data-rank')) !== '3') throw new Error('zakryta nie została pokazana');
    }
    if (!(await host.getByTestId('banner').innerText()).toLowerCase().includes('odsłania')) throw new Error('brak odsłonięcia w komunikacie');
    if ((await host.getByTestId('me').getAttribute('data-hand-count')) !== '2') throw new Error('kara nie wróciła do ręki');
    pass('za niska zakryta: pokazanie karty, kupka wraca do ręki');

    await setup(request, pages, code, ids, () =>
      game(
        [
          seat(ala, 'Ala', [card('8', 'hearts'), card('2', 'clubs')], [card('4', 'clubs')], [card('3', 'clubs')]),
          seat(bart, 'Bartek', [card('9', 'spades')], [card('6', 'diamonds')], [card('2', 'hearts')]),
          seat(cela, 'Celina', [card('J', 'hearts')], [card('6', 'spades')], [card('4', 'diamonds')]),
        ],
        0,
        [card('6', 'hearts')],
      ),
    );
    const handBefore = await host.locator('[data-testid^="hand-"][data-rank]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-testid')).sort(),
    );
    await host.reload();
    await host.getByTestId('conn').filter({ hasText: 'Połączono' }).waitFor();
    await host.locator('.app[data-phase="playing"]').waitFor();
    const handAfter = await host.locator('[data-testid^="hand-"][data-rank]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-testid')).sort(),
    );
    if (JSON.stringify(handBefore) !== JSON.stringify(handAfter)) throw new Error(`ręka po odświeżeniu ${handAfter.join(',')}`);
    if ((await host.getByTestId('turn').getAttribute('data-yours')) !== '1') throw new Error('po odświeżeniu to nie jest ta sama tura');
    if ((await bartek.getByTestId('center-count').innerText()) !== (await host.getByTestId('center-count').innerText())) {
      throw new Error('stan rozjechał się po odświeżeniu');
    }
    const beforeRefreshPlay = await revision(bartek);
    await press(host.getByTestId('hand-8-hearts'));
    await press(host.getByTestId('confirm'));
    await waitRev([bartek, celina, host], beforeRefreshPlay);
    if ((await host.getByTestId('center-top').getAttribute('data-rank')) !== '8') throw new Error('ruch po odświeżeniu nie doszedł');
    pass('odświeżenie wraca tym samym tokenem i stan się nie rozjeżdża');

    await setup(request, pages, code, ids, () => {
      const built = game(
        [
          seat(ala, 'Ala', [card('10', 'diamonds')]),
          seat(bart, 'Bartek', [], [null, null, null], [null, null, null]),
          seat(cela, 'Celina', [card('9', 'spades'), card('2', 'hearts')], [card('6', 'clubs')], [card('4', 'spades')]),
        ],
        0,
        [card('A', 'hearts')],
      );
      built.players[1].exitedPlace = 1;
      built.exitOrder = [bart];
      return built;
    });
    const beforeEnd = await revision(host);
    await press(host.getByTestId('hand-10-diamonds'));
    await press(host.getByTestId('confirm'));
    await waitRev(pages, beforeEnd);
    await host.getByTestId('end').waitFor();
    const endText = await host.getByTestId('end').innerText();
    if (!endText.includes('Przegrywa: Celina')) throw new Error(endText);
    if (!endText.includes('1. Bartek') || !endText.includes('2. Ala')) throw new Error(endText);
    const otherEnd = await bartek.getByTestId('end').innerText();
    if (!otherEnd.includes('Przegrywa: Celina') || !otherEnd.includes('1. Bartek') || !otherEnd.includes('2. Ala')) {
      throw new Error(otherEnd);
    }
    await shot(host, '03-koniec');
    const beforeRematch = await revision(host);
    await press(host.getByTestId('rematch'));
    await waitRev(pages, beforeRematch);
    if ((await host.locator('.app').getAttribute('data-phase')) !== 'playing') throw new Error('jeszcze raz nie rozdało');
    if ((await host.getByTestId('end').count()) !== 0) throw new Error('ekran końca został');
    const again = await host.locator('[data-testid="roster"] [data-hand-count]').evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('data-hand-count'))),
    );
    if (again.reduce((total, value) => total + value, 0) !== 34) throw new Error(`nowe ręce ${again.join(',')}`);
    if ((await sameText(pages, 'burned')) !== 'Spalone: 0') throw new Error('stare spalenie zostało');
    if ((await sameText(pages, 'center-count')) !== 'Stos: 0') throw new Error('środek nie jest pusty');
    pass('koniec partii i jeszcze raz');
    await shot(host, '04-jeszcze-raz');
  } catch (error) {
    fail('partia przerwana', error);
    await Promise.all(pages.map((page, index) => shot(page, `fail-${index}`).catch(() => {})));
  } finally {
    await browser.close();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${touch ? 'TELEFON' : 'DESKTOP'}: ${results.length - failed.length}/${results.length}`);
  if (failed.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
