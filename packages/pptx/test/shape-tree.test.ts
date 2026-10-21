import { describe, expect, it } from 'vitest';
import { walkShapeTree } from '../src/shape-tree';
import { parseXml } from '../src/xml';

const shape = (id: number, name: string, hidden = false) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"${hidden ? ' hidden="1"' : ''}/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm></p:spPr></p:sp>`;

describe('walkShapeTree', () => {
  it('skips shapes and groups hidden in the selection pane', () => {
    const tree = parseXml(
      `<p:spTree>${shape(2, 'Visible')}${shape(3, 'Helper', true)}` +
        `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group" hidden="1"/></p:nvGrpSpPr>` +
        `${shape(5, 'Inside hidden group')}</p:grpSp></p:spTree>`,
    );
    expect([...walkShapeTree(tree)].map((node) => node.name)).toEqual(['Visible']);
  });
});
