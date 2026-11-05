import type { Slide } from '@slider/shared';
import { CANVAS } from '@/lib/palette';
import {
  AUDIO_CONSTRAINTS,
  pickRecorderFormat,
  SCREEN_BITRATES,
  SCREEN_FRAME_RATE,
  SCREEN_MAX_SIZE,
  VIDEO_CONSTRAINTS,
} from '../../media/lib/recording';
import {
  bubbleRect,
  drawCameraBubble,
  fitWithin,
  playingVideo,
} from '../../media/lib/screen-compositor';
import { boxOpacity, type ShowBox } from './show-times';

/** What the audience sees right now – read by the recorder for every frame. */
export interface ShowScene {
  /** `null`: the end screen. */
  slide: Slide | null;
  black: boolean;
  /** How the slide shown came in (`none`: cut); played as a crossfade. */
  transition: string;
  boxes: readonly ShowBox[];
}

/** How long the recording's crossfade between slides takes (the show's „mittel“). */
const FADE_MS = 700;

export interface ShowRecording {
  /** The camera's picture (with the camera), for a preview of the bubble. */
  camera: MediaStream | null;
  pause: () => void;
  resume: () => void;
  /** The file, once the recorder has handed over its last part. */
  stop: () => Promise<Blob>;
  /** Stops without a file (left mid-recording). */
  dispose: () => void;
}

/** A CSS colour (a `var(--…)` too) as the canvas can take it. */
function resolvedColor(color: string): string {
  const probe = document.createElement('span');
  probe.style.color = color;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

/** The recording's file name: the deck's title, then the format's extension. */
export function recordingFileName(title: string, mimeType: string): string {
  const base =
    title
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Präsentation';
  return `${base} Aufnahme.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
}

/**
 * Records the show as the audience sees it: the slide (a crossfade where it comes in with a
 * transition), the boxes drawn on it and, with `camera`, the camera in the corner as in a screen
 * recording – drawn onto a canvas at up to 1080p – with the microphone. Same formats and bitrates
 * as a screen recording (`recording.ts`). Asks for the microphone (and camera) first: throws when
 * refused.
 */
export async function startShowRecording({
  camera,
  aspect,
  color,
  scene,
}: {
  camera: boolean;
  /** Width over height of the slides: the frame's shape. */
  aspect: number;
  /** The boxes' colour (one's accent). */
  color: string;
  scene: () => ShowScene;
}): Promise<ShowRecording> {
  const media = await navigator.mediaDevices.getUserMedia({
    audio: AUDIO_CONSTRAINTS,
    video: camera ? VIDEO_CONSTRAINTS : false,
  });
  let clock: Worker | null = null;
  let stream: MediaStream | null = null;
  let cameraVideo: HTMLVideoElement | null = null;
  const dispose = () => {
    clock?.terminate();
    stream?.getTracks().forEach((track) => track.stop());
    media.getTracks().forEach((track) => track.stop());
    if (cameraVideo) cameraVideo.srcObject = null;
  };
  try {
    const frame = fitWithin({
      width: SCREEN_MAX_SIZE.height * aspect * 4,
      height: SCREEN_MAX_SIZE.height * 4,
    });
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext('2d');
    if (!context) {
      media.getTracks().forEach((track) => track.stop());
      throw new Error('Canvas 2D is not available');
    }
    const boxColor = resolvedColor(color);
    cameraVideo = camera ? playingVideo(new MediaStream(media.getVideoTracks())) : null;
    const bubble = bubbleRect(frame);

    const pictures = new Map<string, HTMLImageElement>();
    const picture = (slide: Slide) => {
      let image = pictures.get(slide.imageUrl);
      if (!image) {
        image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = slide.imageUrl;
        pictures.set(slide.imageUrl, image);
      }
      return image.complete && image.naturalWidth > 0 ? image : null;
    };
    let shownId: string | null | undefined;
    let before: HTMLImageElement | null = null;
    let changedAt = 0;
    let fading = false;

    const unit = frame.height / 540;
    const drawBox = (box: ShowBox, now: number) => {
      const opacity = boxOpacity(box, now);
      if (opacity <= 0) return;
      const x = box.x * frame.width;
      const y = box.y * frame.height;
      const w = box.w * frame.width;
      const h = box.h * frame.height;
      context.save();
      context.globalAlpha = opacity * 0.1;
      context.fillStyle = boxColor;
      context.beginPath();
      context.roundRect(x, y, w, h, 4 * unit);
      context.fill();
      // The halo of a lit frame, then its 2px border (`RectFrame`, `frameHalo`).
      context.globalAlpha = opacity * 0.3;
      context.strokeStyle = boxColor;
      context.lineWidth = 8 * unit;
      context.stroke();
      context.globalAlpha = opacity;
      context.lineWidth = 2 * unit;
      context.stroke();
      context.restore();
    };

    const draw = () => {
      const now = performance.now();
      const shown = scene();
      context.fillStyle = CANVAS;
      context.fillRect(0, 0, frame.width, frame.height);
      const current = shown.slide && !shown.black ? picture(shown.slide) : null;
      const id = shown.black ? null : (shown.slide?.id ?? null);
      if (id !== shownId) {
        fading = shownId !== undefined && shown.transition !== 'none' && before !== null;
        shownId = id;
        changedAt = now;
      }
      const progress = fading ? Math.min(1, (now - changedAt) / FADE_MS) : 1;
      if (before && progress < 1) context.drawImage(before, 0, 0, frame.width, frame.height);
      if (current) {
        context.globalAlpha = progress;
        context.drawImage(current, 0, 0, frame.width, frame.height);
        context.globalAlpha = 1;
        if (progress >= 1) before = current;
      } else if (progress >= 1) {
        before = null;
      }
      if (!shown.black) for (const box of shown.boxes) drawBox(box, Date.now());
      if (cameraVideo) drawCameraBubble(context, cameraVideo, bubble);
    };

    clock = new Worker(new URL('../../media/lib/frame-clock.worker.ts', import.meta.url), {
      type: 'module',
    });
    clock.onmessage = draw;
    clock.postMessage(Math.round(1000 / SCREEN_FRAME_RATE));
    draw();

    stream = canvas.captureStream(SCREEN_FRAME_RATE);
    for (const track of media.getAudioTracks()) stream.addTrack(track);
    const mimeType = pickRecorderFormat('video', (type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, {
      ...SCREEN_BITRATES,
      ...(mimeType ? { mimeType } : {}),
    });
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.start(1000);

    return {
      camera: camera ? new MediaStream(media.getVideoTracks()) : null,
      pause: () => {
        if (recorder.state === 'recording') recorder.pause();
      },
      resume: () => {
        if (recorder.state === 'paused') recorder.resume();
      },
      stop: () =>
        new Promise<Blob>((resolve) => {
          recorder.onstop = () => {
            dispose();
            resolve(new Blob(parts, { type: recorder.mimeType || mimeType || 'video/webm' }));
          };
          if (recorder.state === 'inactive') recorder.onstop(new Event('stop'));
          else recorder.stop();
        }),
      dispose: () => {
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
        dispose();
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
