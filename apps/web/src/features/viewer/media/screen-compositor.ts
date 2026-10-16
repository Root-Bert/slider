import { SCREEN_FRAME_RATE, SCREEN_MAX_SIZE } from './recording';

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** `source` scaled down (never up) to fit into `max`, in even pixels – encoders want those. */
export function fitWithin(source: Size, max: Size = SCREEN_MAX_SIZE): Size {
  if (source.width <= 0 || source.height <= 0) return max;
  const scale = Math.min(1, max.width / source.width, max.height / source.height);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(source.width), height: even(source.height) };
}

/** Where `source` goes in `frame` without cropping, centred (letterbox). */
export function containRect(source: Size, frame: Size): Rect {
  if (source.width <= 0 || source.height <= 0) return { x: 0, y: 0, ...frame };
  const scale = Math.min(frame.width / source.width, frame.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height };
}

/** The camera bubble's shape: landscape 4:3, its corners rounded by this share of its height. */
export const BUBBLE_ASPECT = 4 / 3;
export const BUBBLE_CORNER = 0.14;

/** The camera bubble: a 4:3 rectangle in the bottom right corner, a quarter of the frame's height. */
export function bubbleRect(frame: Size): Rect {
  const height = Math.round(Math.min(frame.width, frame.height) * 0.26);
  const width = Math.round(height * BUBBLE_ASPECT);
  const margin = Math.round(Math.min(frame.width, frame.height) * 0.04);
  return {
    x: frame.width - width - margin,
    y: frame.height - height - margin,
    width,
    height,
  };
}

/** The part of a `source` picture that fills `target` without distortion, centred (cover). */
export function coverCrop(source: Size, target: Size): Rect {
  const scale = Math.max(target.width / source.width, target.height / source.height);
  const width = target.width / scale;
  const height = target.height / scale;
  return { x: (source.width - width) / 2, y: (source.height - height) / 2, width, height };
}

function playingVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void video.play().catch(() => undefined);
  return video;
}

/**
 * The shared screen with the camera as a rounded rectangle in the corner, drawn onto a canvas and
 * captured as one video track. The frame size is fixed by the screen at the start – a recorder
 * should not change resolution midway; a window shared later is letterboxed into it.
 */
export function composeScreenAndCamera(screen: MediaStream, camera: MediaStream) {
  const settings = screen.getVideoTracks()[0]?.getSettings();
  const frame = fitWithin({ width: settings?.width ?? 0, height: settings?.height ?? 0 });
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available');

  const screenVideo = playingVideo(new MediaStream(screen.getVideoTracks()));
  const cameraVideo = playingVideo(new MediaStream(camera.getVideoTracks()));
  const bubble = bubbleRect(frame);

  const draw = () => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, frame.width, frame.height);
    if (screenVideo.videoWidth > 0) {
      const at = containRect(
        { width: screenVideo.videoWidth, height: screenVideo.videoHeight },
        frame,
      );
      context.drawImage(screenVideo, at.x, at.y, at.width, at.height);
    }
    const { videoWidth, videoHeight } = cameraVideo;
    if (videoWidth > 0) {
      // Cover: the middle of the camera picture fills the rounded rectangle.
      const crop = coverCrop({ width: videoWidth, height: videoHeight }, bubble);
      const radius = bubble.height * BUBBLE_CORNER;
      // Lifted off the screen like the app's floating panels: a soft shadow under it…
      context.save();
      context.shadowColor = 'rgba(0, 0, 0, 0.5)';
      context.shadowBlur = bubble.height * 0.12;
      context.shadowOffsetY = bubble.height * 0.03;
      context.beginPath();
      context.roundRect(bubble.x, bubble.y, bubble.width, bubble.height, radius);
      context.fillStyle = '#000';
      context.fill();
      context.restore();
      context.save();
      context.beginPath();
      context.roundRect(bubble.x, bubble.y, bubble.width, bubble.height, radius);
      context.clip();
      context.drawImage(
        cameraVideo,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        bubble.x,
        bubble.y,
        bubble.width,
        bubble.height,
      );
      context.restore();
      // …and a hairline edge instead of a ring.
      context.beginPath();
      context.roundRect(
        bubble.x + 0.5,
        bubble.y + 0.5,
        bubble.width - 1,
        bubble.height - 1,
        radius,
      );
      context.lineWidth = 1;
      context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      context.stroke();
    }
  };

  const clock = new Worker(new URL('./frame-clock.worker.ts', import.meta.url), {
    type: 'module',
  });
  clock.onmessage = draw;
  clock.postMessage(Math.round(1000 / SCREEN_FRAME_RATE));
  draw();

  const stream = canvas.captureStream(SCREEN_FRAME_RATE);

  const dispose = () => {
    clock.postMessage(0);
    clock.terminate();
    stream.getTracks().forEach((track) => track.stop());
    screenVideo.srcObject = null;
    cameraVideo.srcObject = null;
  };

  return { stream, dispose };
}
