import { Hono } from 'hono';
import type { SliderTemplate } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { listSliderTemplates, sliderTemplatePicture } from '../services/slider-templates';

/**
 * The templates Slider brings along (`services/slider-templates.ts`) for the „Slider“ source of
 * „Folie einfügen“: the catalogue and a picture of each layout. For anyone signed in.
 */
export function sliderTemplateRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  return new Hono<ViewerEnv>()
    .get('/slider-templates', viewer, async (c) =>
      c.json<SliderTemplate[]>(await listSliderTemplates(deps)),
    )
    .get('/slider-templates/:slug/:picture{[0-9]+\\.jpg}', viewer, async (c) => {
      const bytes = await sliderTemplatePicture(
        deps,
        c.req.param('slug'),
        c.req.param('picture').replace(/\.jpg$/, ''),
      );
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': 'image/jpeg',
        // Named with its build (`?v=`), so it never changes under its address.
        'Cache-Control': 'private, max-age=31536000, immutable',
      });
    });
}
