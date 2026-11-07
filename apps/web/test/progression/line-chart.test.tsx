import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LineChart } from '../../src/features/progression/LineChart';
import { declarationsOf, parseCssBlocks } from '../support/css-blocks';

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

  it('avec `dates` : les abscisses suivent l’écart en jours, pas le rang', () => {
    const { container } = render(
      <LineChart
        values={[70, 70.2, 70.4]}
        points={[70, 70.2, 70.4]}
        dates={['2026-10-01', '2026-10-02', '2026-10-11']}
      />,
    );
    const cx = [...container.querySelectorAll('circle')].map((d) => Number(d.getAttribute('cx')));
    // 1 jour puis 9 jours : le second écart est neuf fois le premier.
    const first = (cx[1] ?? 0) - (cx[0] ?? 0);
    const second = (cx[2] ?? 0) - (cx[1] ?? 0);
    expect(first).toBeGreaterThan(0);
    expect(second / first).toBeCloseTo(9, 5);
    expect(cx[0]).toBe(12);
    expect(cx[2]).toBe(308);
  });

  it('avec `dates` d’un seul jour : un point au milieu', () => {
    const { container } = render(<LineChart values={[70]} points={[70]} dates={['2026-10-01']} />);
    expect(container.querySelector('circle')?.getAttribute('cx')).toBe('160');
  });

  it('sans `dates`, les points restent répartis également', () => {
    const { container } = render(<LineChart values={[1, 2, 3]} />);
    const cx = [...container.querySelectorAll('circle')].map((d) => Number(d.getAttribute('cx')));
    expect((cx[1] ?? 0) - (cx[0] ?? 0)).toBeCloseTo((cx[2] ?? 0) - (cx[1] ?? 0), 5);
  });

  it('`neutral` : le tracé prend la durée d’un changement d’écran, jamais celle d’une célébration', () => {
    const { container } = render(<LineChart values={[70, 71]} neutral />);
    expect(container.querySelector('path')?.getAttribute('class')).toMatch(/chartLineNeutral/);
    const css = readFileSync(
      resolve(import.meta.dirname, '../../src/features/progression/progression.module.css'),
      'utf8',
    );
    const neutral = declarationsOf(parseCssBlocks(css), '.chartLineNeutral');
    expect(neutral?.get('animation-duration')).toBe('var(--dur-screen)');
    expect(
      render(<LineChart values={[1, 2]} />)
        .container.querySelector('path')
        ?.getAttribute('class'),
    ).not.toMatch(/chartLineNeutral/);
  });
});
