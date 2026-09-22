import type { ClientMessage, PlayerView } from 'engine';

interface LobbyProps {
  view: PlayerView;
  pending: boolean;
  send: (message: ClientMessage, lock?: boolean) => void;
}

export function Lobby({ view, pending, send }: LobbyProps) {
  const me = view.seats.find((seat) => seat.id === view.youId);
  const link = `${window.location.origin}/gra/${view.code}`;
  const host = view.youId === view.hostId;
  return (
    <main className="home">
      <p className="kicker">{view.visibility === 'private' ? 'Stół prywatny' : 'Stół publiczny'}</p>
      <h1 data-testid="code">{view.code}</h1>
      <p>{view.visibility === 'private' ? 'Tego stołu nie ma na liście. Wejdzie tylko kto zna kod.' : 'Stół widać na liście otwartych gier.'}</p>
      <label className="field">
        Link
        <input data-testid="link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(link);
        }}
      >
        Kopiuj link
      </button>
      <ul className="roster">
        {view.seats.map((seat) => (
          <li key={seat.id} data-testid={`seat-${seat.id}`} data-player-id={seat.id}>
            <span>
              {seat.nick}
              {seat.id === view.hostId ? ' · gospodarz' : ''}
              {seat.ready ? ' · gotowy' : ''}
              {!seat.connected ? ' · rozłączony' : ''}
            </span>
            {host && seat.id !== view.youId ? (
              <button type="button" data-testid={`kick-${seat.id}`} disabled={pending} onClick={() => send({ type: 'kick', playerId: seat.id }, true)}>
                Wyrzuć
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p data-testid="seat-count">
        Siedzą {view.seats.length}. Start od 3, maksymalnie 6.
      </p>
      <div className="row">
        <button type="button" data-testid="ready" disabled={pending} onClick={() => send({ type: 'ready' }, true)}>
          {me?.ready ? 'Cofnij gotowość' : 'Gotowy'}
        </button>
        {host ? (
          <button type="button" data-testid="start" disabled={pending || view.seats.length < 3} onClick={() => send({ type: 'start' }, true)}>
            Start
          </button>
        ) : (
          <p>Czekam na gospodarza.</p>
        )}
      </div>
      <button type="button" data-testid="leave" disabled={pending} onClick={() => send({ type: 'leave' }, true)}>
        Wyjdź ze stołu
      </button>
    </main>
  );
}
