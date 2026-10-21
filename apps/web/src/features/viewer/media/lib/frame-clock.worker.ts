/*
 * A steady tick for the screen + camera compositor. Timers of a background tab are throttled to
 * once a second – and sharing a screen usually means the Slider tab is in the background – but a
 * worker's are not, so the recorded picture keeps moving.
 */
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event: MessageEvent<number>) => {
  clearInterval(timer);
  if (event.data > 0) timer = setInterval(() => self.postMessage(0), event.data);
};
