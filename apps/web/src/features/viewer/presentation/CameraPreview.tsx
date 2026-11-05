import { useEffect, useRef } from 'react';
import { BUBBLE_CORNER, bubbleRect } from '../media/lib/screen-compositor';

/**
 * The camera while recording with it, where the recording puts it: the bubble in the slide's
 * corner, at its size – drawn over the presenter's slide, so it costs the notes no room. Not
 * mirrored, as recorded.
 */
export function CameraPreview({ stream, aspect }: { stream: MediaStream; aspect: number }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  const frame = { width: 1000 * aspect, height: 1000 };
  const bubble = bubbleRect(frame);
  return (
    <video
      ref={video}
      muted
      playsInline
      aria-label="Kamera"
      data-camera-preview
      className="pointer-events-none absolute z-4 object-cover shadow-float"
      style={{
        left: `${(bubble.x / frame.width) * 100}%`,
        top: `${(bubble.y / frame.height) * 100}%`,
        width: `${(bubble.width / frame.width) * 100}%`,
        height: `${(bubble.height / frame.height) * 100}%`,
        // The corner's radius a share of its height, as the recording rounds it.
        borderRadius: `${((BUBBLE_CORNER * bubble.height) / bubble.width) * 100}% / ${BUBBLE_CORNER * 100}%`,
      }}
    />
  );
}
