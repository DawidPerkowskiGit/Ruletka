# Ruletka

Gra karciana dla 3–6 osób w jednej przeglądarce, przy jednym stole. Zasady liczy tylko serwer. Strona wysyła ruch i rysuje stan, który wrócił.

Pokoje żyją w pamięci procesu. Restart albo uśpienie kasuje stoły. Nie ma bazy danych i nie trzeba jej dokładać.

## Uruchomienie na własnym komputerze

Potrzebny Node.js 22 albo nowszy.

```bash
npm install
npm test
npm run build
npm start
```

Otwórz [http://localhost:3000](http://localhost:3000).

`npm start` podnosi jeden proces: stronę i WebSocket na tym samym porcie. Numer bierze z `PORT`, a gdy zmiennej nie ma — z 3000. Nasłuch jest na `0.0.0.0`. Sprawdzenie życia: `GET /health` zwraca 200.

Wpisz nick (do 20 znaków) i załóż stół publiczny albo prywatny. Prywatny dostaje kod z 6 znaków i link. Nie pojawia się na liście otwartych gier. Wchodzi tylko kto zna kod.

Odświeżenie strony wraca tym samym miejscem przy stole. W trakcie partii rozłączenie czeka 90 sekund; po tym czasie gracz odpada, a jego karty wypadają z gry.

Każde okno przeglądarki to osobne miejsce, więc na jednym komputerze da się otworzyć kilku graczy.

## Wdrożenie na Renderze

Aplikacja nie jest podpięta pod żadne konto. Wdrożenie robi właściciel repozytorium, jeden raz:

1. Wypchnij to repozytorium na GitHub, gałąź `main`.
2. W Renderze wybierz New → Blueprint albo New Web Service i wskaż to repozytorium.
3. Plan: **Free**. Region: **Frankfurt**. Gałąź: **main**.
4. Zostaw Auto-Deploy włączone. Każdy następny commit na `main` wdraża się sam.
5. Build: `npm install --include=dev && npm run build`. Start: `npm start`. Health check: `/health`.

To samo jest w `render.yaml`. Karta płatnicza nie jest potrzebna.

Darmowa instancja zasypia po około 15 minutach bez ruchu. Pierwsze wejście po śnie trwa około minuty: proces wstaje od nowa, a stoły z pamięci znikają. W trakcie partii przeglądarka co 20 sekund wysyła ping, serwer odpowiada pongiem. Ruch na gnieździe trzyma instancję obudzoną, dopóki ktoś jest przy stole.

W repozytorium jest Dockerfile, ale zwykłe wdrożenie to Node (build i `npm start`), nie osobny kontener obok strony.

Heroku nie jest celem.

## Zasady w skrócie

Talia 52 kart, bez jokerów. Kolor nie liczy się do siły. As jest najwyższy. Piątka wchodzi na wszystko i wszystko wchodzi na piątkę, ale sama nie kasuje stosu. Jedna dziesiątka kasuje stos. Dokładnie cztery karty tej samej wartości naraz też kasują: albo cztery z ręki, albo dokładnie trzy z ręki plus jedna odkryta tej samej wartości. Dwie albo trzy karty w jednej turze są nielegalne.

Najpierw schodzi ręka, potem odkryte, na końcu zakryte. Kto nie ma już kart, wychodzi. Ostatni z kartami przegrywa.
