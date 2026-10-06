import { describe, expect, it } from 'vitest';
import {
  layoutConnectors,
  roundedPath,
  routeConnector,
  type ConnectorRequest,
  type LayoutFrame,
} from './connector-routing';

const frame: LayoutFrame = {
  slide: { left: 100, top: 0, right: 900, bottom: 450 },
  busTop: 700,
  laneSpace: { left: 32, right: 16 },
  busSpace: 32,
};

const request = (id: string, anchorX: number, targetX: number): ConnectorRequest => ({
  id,
  anchor: { left: anchorX, right: anchorX, top: 200, bottom: 200 },
  anchorCenterX: (anchorX - 100) / 800,
  target: { x: targetX, y: 800 },
});

describe('routeConnector', () => {
  it('goes sideways to the lane, down to the bus, across and into the card', () => {
    const points = routeConnector(request('a', 300, 500), 'left', 90, 710);
    expect(points).toEqual([
      { x: 300, y: 200 },
      { x: 90, y: 200 },
      { x: 90, y: 710 },
      { x: 500, y: 710 },
      { x: 500, y: 800 },
    ]);
  });

  it('drops redundant points', () => {
    const points = routeConnector(request('a', 300, 90), 'left', 90, 710);
    expect(points).toHaveLength(4);
  });
});

describe('layoutConnectors', () => {
  it('sends anchors on the left half to the left lane and right half to the right lane', () => {
    const [left, right] = layoutConnectors([request('l', 200, 150), request('r', 800, 950)], frame);
    expect(left!.points[1]!.x).toBeLessThan(frame.slide.left);
    expect(right!.points[1]!.x).toBeGreaterThan(frame.slide.right);
  });

  it('gives the outermost card the outermost lane and the lowest bus on one side', () => {
    const connectors = layoutConnectors(
      [request('near', 300, 600), request('far', 250, 150)],
      frame,
    );
    const far = connectors.find((c) => c.id === 'far')!;
    const near = connectors.find((c) => c.id === 'near')!;
    expect(far.points[1]!.x).toBeLessThan(near.points[1]!.x);
    expect(far.points[2]!.y).toBeGreaterThan(near.points[2]!.y);
  });

  it('keeps lanes within the available space', () => {
    const many = Array.from({ length: 10 }, (_, i) => request(`c${i}`, 150 + i, 120 + i * 50));
    for (const connector of layoutConnectors(many, frame)) {
      expect(connector.points[1]!.x).toBeGreaterThanOrEqual(
        frame.slide.left - frame.laneSpace.left,
      );
      expect(connector.points[2]!.y).toBeLessThanOrEqual(frame.busTop + frame.busSpace);
    }
  });
});

describe('roundedPath', () => {
  it('rounds corners with quadratic curves', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toBe('M0 0L90 0Q100 0 100 10L100 100');
  });

  it('shrinks the radius on short segments', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 100 },
      ]),
    ).toBe('M0 0L2 0Q4 0 4 2L4 100');
  });
});
