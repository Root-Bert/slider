import { boxOf } from './geometry';
import { attr, childrenOf, firstChild, removeAttr, setAttr, tagOf, type XmlNode } from './xml';

/*
 * A box's rounded corners: one rectangle with a radius, as Figma has it, rather than a rectangle
 * and a rounded rectangle to choose between. In the file LibreOffice's preset `round-rectangle`,
 * its modifier the radius as a share of the shorter side (of 21600, at most half of it); radius 0
 * is the plain `rectangle` again.
 */

const PT_PER_CM = 72 / 2.54;
/** The modifier of a round rectangle that does not say: LibreOffice's default. */
const DEFAULT_ROUNDING = 3600;
/** Half the shorter side: the ends are round then. */
const MAX_ROUNDING = 10800;
const RECTANGLE_PATH = 'M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N';

const shorterSide = (node: XmlNode): number => {
  const box = boxOf(node);
  return box ? Math.min(box.w, box.h) : 0;
};

/** The box's own geometry, when it is a rectangle or a rounded one (a custom shape). */
function boxGeometry(node: XmlNode): { geometry: XmlNode; round: boolean } | null {
  if (tagOf(node) !== 'draw:custom-shape') return null;
  const geometry = firstChild(node, 'draw:enhanced-geometry');
  const type = geometry && attr(geometry, 'draw:type');
  if (!geometry || (type !== 'rectangle' && type !== 'round-rectangle')) return null;
  return { geometry, round: type === 'round-rectangle' };
}

/** The corners' radius (pt) of a rectangle, 0 when sharp; `undefined` for any other shape. */
export function readCornerRadius(node: XmlNode): number | undefined {
  const box = boxGeometry(node);
  if (!box) return undefined;
  if (!box.round) return 0;
  // No modifier said (`Number('')` would be 0): LibreOffice's default rounding.
  const said = (attr(box.geometry, 'draw:modifiers') ?? '').trim().split(/\s+/)[0];
  const modifier = said ? Number(said) : NaN;
  const share = Math.min(
    Number.isFinite(modifier) && modifier >= 0 ? modifier : DEFAULT_ROUNDING,
    MAX_ROUNDING,
  );
  return Math.round((share / 21600) * shorterSide(node) * PT_PER_CM * 100) / 100;
}

/**
 * Rounds a rectangle's corners by `radius` (pt; at most half the shorter side), or makes them
 * sharp again (0). `false`: not a rectangle.
 */
export function writeCornerRadius(node: XmlNode, radius: number): boolean {
  const box = boxGeometry(node);
  if (!box) return false;
  const { geometry } = box;
  // The preset draws itself: no path, text area, stretch points, formulas or handles of the old.
  for (const name of [
    'draw:enhanced-path',
    'draw:text-areas',
    'draw:path-stretchpoint-x',
    'draw:path-stretchpoint-y',
    'draw:modifiers',
  ])
    removeAttr(geometry, name);
  const children = childrenOf(geometry);
  children.splice(0, children.length);
  setAttr(geometry, 'svg:viewBox', '0 0 21600 21600');
  const side = shorterSide(node);
  if (radius <= 0 || side <= 0) {
    setAttr(geometry, 'draw:type', 'rectangle');
    setAttr(geometry, 'draw:enhanced-path', RECTANGLE_PATH);
    return true;
  }
  const share = Math.min(MAX_ROUNDING, (radius / PT_PER_CM / side) * 21600);
  setAttr(geometry, 'draw:type', 'round-rectangle');
  setAttr(geometry, 'draw:modifiers', String(Math.round(share)));
  return true;
}
