import type { ElementFlip, ElementTilt, Rect } from '@slider/shared';
import { projected, TILT_DEPTH } from './tilt-math';

/** Largest side of a tilted picture, in pixels. */
const MAX_SIDE = 4096;

const VERTEX = `
attribute vec4 position;
attribute vec2 point;
varying vec2 at;
void main() {
  gl_Position = position;
  at = point;
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D picture;
varying vec2 at;
void main() {
  gl_FragColor = texture2D(picture, at);
}`;

function program(gl: WebGLRenderingContext): WebGLProgram {
  const shader = (kind: number, source: string) => {
    const made = gl.createShader(kind);
    if (!made) throw new Error('WebGL ohne Shader.');
    gl.shaderSource(made, source);
    gl.compileShader(made);
    return made;
  };
  const made = gl.createProgram();
  if (!made) throw new Error('WebGL ohne Programm.');
  gl.attachShader(made, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(made, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(made);
  if (!gl.getProgramParameter(made, gl.LINK_STATUS)) throw new Error('WebGL-Programm fehlt.');
  return made;
}

/**
 * An element's picture alone (`url`, lying at `box` of the slide) tilted about the element's
 * centre (`centre`, of the slide) and seen in perspective (`tilt-math`), see-through around it:
 * as a PNG, and where it lies on the slide. `aspect`: the slide's width over its height.
 * Drawn by WebGL – perspective-correct across the whole picture. `mirror`: the picture mirrored
 * about the element's centre first (on screen), as the element will be.
 */
export async function bakeTilt({
  url,
  box,
  centre,
  tilt,
  aspect,
  mirror,
}: {
  url: string;
  box: Rect;
  centre: { x: number; y: number };
  tilt: ElementTilt;
  aspect: number;
  mirror?: ElementFlip;
}): Promise<{ blob: Blob; box: Rect }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Das Bild des Elements fehlt.');
  const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none' });
  // In the picture's pixels: the slide as wide as it shows the element.
  const width = bitmap.width / box.w;
  const height = width / aspect;
  const depth = TILT_DEPTH * width;
  const cx = centre.x * width;
  const cy = centre.y * height;
  // Mirrored about the centre: lying on the other side of it, its pixels the other way round.
  const placedX = mirror?.x ? 2 * centre.x - box.x - box.w : box.x;
  const placedY = mirror?.y ? 2 * centre.y - box.y - box.h : box.y;
  const corners = [
    [placedX, placedY, 0, 0],
    [placedX + box.w, placedY, 1, 0],
    [placedX, placedY + box.h, 0, 1],
    [placedX + box.w, placedY + box.h, 1, 1],
  ].map(([x, y, u, v]) => {
    const seen = projected(x! * width - cx, y! * height - cy, tilt, depth);
    return {
      x: cx + seen.x,
      y: cy + seen.y,
      w: seen.w,
      u: mirror?.x ? 1 - u! : u!,
      v: mirror?.y ? 1 - v! : v!,
    };
  });
  const left = Math.floor(Math.min(...corners.map((c) => c.x)));
  const top = Math.floor(Math.min(...corners.map((c) => c.y)));
  const right = Math.ceil(Math.max(...corners.map((c) => c.x)));
  const bottom = Math.ceil(Math.max(...corners.map((c) => c.y)));
  const scale = Math.min(1, MAX_SIDE / Math.max(right - left, bottom - top));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((right - left) * scale));
  canvas.height = Math.max(1, Math.round((bottom - top) * scale));
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('Dieser Browser kann nicht in 3D zeichnen.');
  const made = program(gl);
  gl.useProgram(made);
  // Clip space with w: the GPU maps the picture perspective-correct between the corners.
  const vertices = new Float32Array(
    corners.flatMap((c) => [
      ((c.x - left) / (right - left)) * 2 * c.w - c.w,
      (1 - ((c.y - top) / (bottom - top)) * 2) * c.w,
      0,
      c.w,
      c.u,
      c.v,
    ]),
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(made, 'position');
  const point = gl.getAttribLocation(made, 'point');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(point);
  gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 24, 16);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (!blob) throw new Error('Das gekippte Bild ließ sich nicht zeichnen.');
  return {
    blob,
    box: {
      x: left / width,
      y: top / height,
      w: (right - left) / width,
      h: (bottom - top) / height,
    },
  };
}
