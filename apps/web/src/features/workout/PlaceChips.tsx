import type { PlaceView } from '../../repos';
import { Chips } from '../../ui';

/** Lieux actifs de l'utilisateur en pastilles, celui du jour choisi (le principal au départ, R-LIEU-4). */
export function PlaceChips(p: {
  places: readonly PlaceView[];
  value: string | null;
  onChange(id: string): void;
}) {
  return (
    <Chips
      name="workout-place"
      legend="Lieu du jour"
      options={p.places.map((place) => ({ value: place.id, label: place.name }))}
      value={p.value}
      onChange={p.onChange}
    />
  );
}
