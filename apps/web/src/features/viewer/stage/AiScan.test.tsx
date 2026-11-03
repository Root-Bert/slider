import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiScan } from './AiScan';
import { ShapeOutline } from './ShapeOutline';

const shape = {
  bbox: { x: 0.2, y: 0.2, w: 0.6, h: 0.5 },
  rotation: 35,
  tilt: { x: 15, y: 20 },
};

describe('AI scan geometry', () => {
  it('matches the hover outline for the whole object, its comment frame for a part, and stays unturned when free', () => {
    const { container } = render(
      <>
        <AiScan rect={shape.bbox} shape={shape} />
        <ShapeOutline shape={shape} variant="target" />
      </>,
    );
    const scan = container.firstElementChild as HTMLElement;
    const outline = container.lastElementChild as HTMLElement;
    for (const property of ['left', 'top', 'width', 'height', 'transform'] as const) {
      expect(scan.style[property]).toBe(outline.style[property]);
    }

    const rect = { x: 0.3, y: 0.3, w: 0.1, h: 0.1 };
    const part = render(<AiScan rect={rect} shape={shape} />).container
      .firstElementChild as HTMLElement;
    expect(part.style.left).toBe('30%');
    expect(part.style.width).toBe('10%');
    expect(part.style.height).toBe('10%');
    expect(part.style.transform).toContain('rotate(35deg)');
    expect(part.style.transform).toContain('rotateX(15deg) rotateY(20deg)');

    // A free area: unturned, without the bracket the pin occupies.
    const free = render(<AiScan rect={shape.bbox} pinOnCorner />).container;
    expect((free.firstElementChild as HTMLElement).style.transform).toBe('');
    expect(free.querySelectorAll('.ai-scan-corner')).toHaveLength(3);
    expect(free.querySelector('.ai-scan-corner-tl')).toBeNull();
  });
});
