import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LineChart } from '../../src/features/progression/LineChart';

describe('LineChart', () => {
  it('sans `points` : un cercle par valeur, comme avant', () => {
    const { container } = render(<LineChart values={[1, 2, 3]} />);
    expect(container.querySelectorAll('circle')).toHaveLength(3);
    expect(container.querySelector('path')).not.toBeNull();
  });

  it('avec `points` : le trait sans ses cercles, puis un point discret par valeur non nulle', () => {
    const { container } = render(<LineChart values={[70, 70.5, 71]} points={[69, null, 72]} />);
    const dots = container.querySelectorAll('circle');
    expect(dots).toHaveLength(2);
    expect(container.querySelector('path')).not.toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const cy = [...dots].map((d) => Number(d.getAttribute('cy')));
    expect(cy[0]).toBeGreaterThan(cy[1] ?? 0);
  });
});
