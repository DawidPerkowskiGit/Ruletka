import type { PublicCard } from 'engine';
import { cardAria, isRed, suitSymbol } from './labels';

interface CardProps {
  card: PublicCard;
  testId?: string;
  selected?: boolean;
  choice?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function PlayingCard({ card, testId, selected, choice, disabled, onClick }: CardProps) {
  const className = ['card', isRed(card.suit) ? 'red' : '', selected ? 'selected' : '', choice ? 'choice' : '', card.rank === '10' ? 'rank-10' : '']
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      <span className="corner">
        {card.rank}
        <span className="suit">{suitSymbol(card.suit)}</span>
      </span>
      <span className="pips" aria-hidden="true">
        {suitSymbol(card.suit)}
      </span>
      <span className="corner bottom" aria-hidden="true">
        {card.rank}
        <span className="suit">{suitSymbol(card.suit)}</span>
      </span>
    </>
  );
  if (!onClick) {
    return (
      <div className={className} data-testid={testId} data-rank={card.rank} data-suit={card.suit} aria-label={cardAria(card)}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-testid={testId}
      data-rank={card.rank}
      data-suit={card.suit}
      aria-label={cardAria(card)}
      aria-pressed={selected ?? false}
      disabled={disabled}
      onClick={onClick}
    >
      {body}
    </button>
  );
}

export function CardBack({
  testId,
  selected,
  choice,
  disabled,
  onClick,
}: {
  testId?: string;
  selected?: boolean;
  choice?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const className = ['card', 'back', selected ? 'selected' : '', choice ? 'choice' : ''].filter(Boolean).join(' ');
  if (!onClick) return <div className={className} data-testid={testId} aria-label="Zakryta karta" />;
  return (
    <button type="button" className={className} data-testid={testId} aria-label="Zakryta karta" aria-pressed={selected ?? false} disabled={disabled} onClick={onClick}>
      <span className="back-diamond" aria-hidden="true" />
    </button>
  );
}
