import { Avatar, Style } from '@dicebear/core';
import cameo from '@dicebear/styles/cameo.json';
import initials from '@dicebear/styles/initials.json';
import landscape from '@dicebear/styles/landscape.json';
import slice from '@dicebear/styles/slice.json';
import { DEFAULT_AGENT_AVATARS, type AgentAvatarStyle } from '@slider/shared';
import glazeFlowers from './glaze-flowers.json';
import { CAMEO_GROUNDS, GENERATED_AVATAR_GROUNDS } from './palette';

/** DiceBear "slice" with the "Bold Pop" preset: saturated grounds behind the bands. */
const style = new Style(slice);
/** DiceBear "landscape" (CC0, like "slice") with its own pastel skies: workspaces without a logo. */
const landscapeStyle = new Style(landscape);
/** DiceBear "initials" (CC0, like "slice"): people of a mail from outside, by their name. */
const initialsStyle = new Style(initials);

/**
 * The styles a workspace picks for its agents (`Workspace.agentAvatars`), all bundled – no agent
 * id leaves the browser. `flowers`: "Glaze Flowers" (CC0, our own style,
 * github.com/Root-Bert/glaze-flowers), a happy flower of its own for each agent, on the style's
 * own grounds, meadows and skies – every face in it smiles. `cameo`: DiceBear's "Cameo" (CC0),
 * a smiling head on a pale ground.
 */
const agentStyles: Record<
  AgentAvatarStyle,
  { style: Style; options?: { backgroundColor: string[] } }
> = {
  flowers: { style: new Style(glazeFlowers) },
  cameo: { style: new Style(cameo), options: { backgroundColor: [...CAMEO_GROUNDS] } },
};

const cache = new Map<string, string>();
const agentCache = new Map<string, string>();
const landscapeCache = new Map<string, string>();
const initialsCache = new Map<string, string>();

/** Avatar for someone without a photo, seeded by their name so it is the same everywhere. */
export function generatedAvatar(name: string): string {
  const seed = name.trim().toLowerCase();
  let uri = cache.get(seed);
  if (!uri) {
    uri = new Avatar(style, { seed, backgroundColor: [...GENERATED_AVATAR_GROUNDS] }).toDataUri();
    cache.set(seed, uri);
  }
  return uri;
}

/**
 * Picture of someone from outside who writes mail – no one of the workspace, no agent: their
 * initials (of the address where the name has no letter – „1&1“, „11880“, an emoji – DiceBear takes
 * only letters and would leave the circle blank) on a ground seeded by the same, so the same
 * sender has the same one everywhere. The letters at 80 % (40 % of the circle, as Outlook's): at
 * the style's own size „WW“, „WM“, „MM“ ran under the ring.
 */
export function generatedInitials(name: string, address: string): string {
  const seed = (/\p{L}/u.test(name) ? name : address).trim();
  let uri = initialsCache.get(seed);
  if (!uri) {
    uri = new Avatar(initialsStyle, { seed, fontWeight: 600, scale: 0.8 }).toDataUri();
    initialsCache.set(seed, uri);
  }
  return uri;
}

/** Picture of a workspace without a logo, seeded by its name like `generatedAvatar`. */
export function generatedLandscape(name: string): string {
  const seed = name.trim().toLowerCase();
  let uri = landscapeCache.get(seed);
  if (!uri) {
    uri = new Avatar(landscapeStyle, { seed }).toDataUri();
    landscapeCache.set(seed, uri);
  }
  return uri;
}

/**
 * An agent's picture in the workspace's style, seeded by its id: its own, and the same when its
 * title changes. Drawn through `useAgentAvatars` (features/workspaces), which knows the style.
 */
export function generatedAgentAvatar(
  id: string,
  style: AgentAvatarStyle = DEFAULT_AGENT_AVATARS,
): string {
  const key = `${style}:${id}`;
  let uri = agentCache.get(key);
  if (!uri) {
    const { style: drawn, options } = agentStyles[style] ?? agentStyles[DEFAULT_AGENT_AVATARS];
    uri = new Avatar(drawn, { seed: id, ...options }).toDataUri();
    agentCache.set(key, uri);
  }
  return uri;
}
