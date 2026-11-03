import { Component, type ReactNode } from 'react';
import { Banner } from './Banner';
import { Button } from './Button';

interface Props {
  children: ReactNode;
  /** Carte d'une page (accueil) plutôt qu'une page entière : le message tient à la place de la carte. */
  compact?: boolean;
  /** Change avec la page affichée : une erreur d'une page ne reste pas sur la suivante. */
  resetKey?: string;
}

interface State {
  failed: boolean;
}

/**
 * Lecture locale qui échoue (`useLive` relance l'erreur au rendu) : le message prend la place de ce qui n'a pas pu
 * s'afficher, au lieu d'un écran vide. « Réessayer » remonte les enfants, donc relance leurs requêtes.
 */
export class ReadErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Banner tone="error">
        <p>Impossible d'afficher cette page.</p>
        <Button
          variant="secondary"
          block={!this.props.compact}
          onClick={() => this.setState({ failed: false })}
        >
          Réessayer
        </Button>
      </Banner>
    );
  }
}
