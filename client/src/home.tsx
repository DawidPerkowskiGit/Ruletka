import type { ClientMessage, PublicRoom } from 'engine';

interface HomeProps {
  nick: string;
  urlCode: string | null;
  rooms: PublicRoom[];
  pending: boolean;
  onNick: (nick: string) => void;
  send: (message: ClientMessage, lock?: boolean) => void;
}

export function Home({ nick, urlCode, rooms, pending, onNick, send }: HomeProps) {
  const nickOk = nick.trim().length > 0;
  return (
    <main className="home">
      <h1>Ruletka</h1>
      <p className="lead">Stół od 3 do 6 osób. Bez konta — wchodzisz nickiem i kodem.</p>
      <label className="field">
        Nick
        <input
          data-testid="nick"
          maxLength={20}
          value={nick}
          autoComplete="nickname"
          onChange={(event) => onNick(event.target.value)}
        />
      </label>
      <div className="row">
        <button type="button" data-testid="create-public" disabled={!nickOk || pending} onClick={() => send({ type: 'create', nick: nick.trim(), visibility: 'public', token: '' }, true)}>
          Stół publiczny
        </button>
        <button type="button" data-testid="create-private" disabled={!nickOk || pending} onClick={() => send({ type: 'create', nick: nick.trim(), visibility: 'private', token: '' }, true)}>
          Stół prywatny
        </button>
      </div>
      <JoinBox nick={nick} urlCode={urlCode} pending={pending} send={send} />
      <section className="open-list">
        <h2>Otwarte stoły</h2>
        {rooms.length === 0 ? <p>Nikogo nie ma na liście.</p> : null}
        {rooms.map((room) => (
          <button
            key={room.code}
            type="button"
            className="room-link"
            data-testid={`room-${room.code}`}
            disabled={!nickOk || pending}
            onClick={() => send({ type: 'join', code: room.code, nick: nick.trim(), token: '' }, true)}
          >
            {room.hostNick} · {room.seats}/{room.max} miejsc
          </button>
        ))}
      </section>
    </main>
  );
}

function JoinBox({
  nick,
  urlCode,
  pending,
  send,
}: {
  nick: string;
  urlCode: string | null;
  pending: boolean;
  send: (message: ClientMessage, lock?: boolean) => void;
}) {
  return (
    <form
      className="join"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const code = String(data.get('code') ?? '');
        if (!nick.trim() || !code.trim()) return;
        send({ type: 'join', code: code.trim().toUpperCase(), nick: nick.trim(), token: '' }, true);
      }}
    >
      <label className="field">
        Kod stołu
        <input data-testid="join-code" name="code" defaultValue={urlCode ?? ''} maxLength={6} autoCapitalize="characters" />
      </label>
      <button type="submit" data-testid="join-submit" disabled={nick.trim().length === 0 || pending}>
        Dołącz
      </button>
    </form>
  );
}
