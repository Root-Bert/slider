/** Why a microphone, camera or screen could not be had – said in a toast. */
export class MediaRefused extends Error {}

function refusal(error: unknown, what: 'mic' | 'camera' | 'screen'): MediaRefused {
  const name = error instanceof DOMException ? error.name : '';
  const thing = { mic: 'Mikrofon', camera: 'Kamera', screen: 'Bildschirm' }[what];
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MediaRefused(
      what === 'screen'
        ? 'Bildschirm teilen wurde nicht erlaubt.'
        : `Kein Zugriff aufs ${thing} – erlaube es in den Einstellungen des Browsers.`,
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return new MediaRefused(`Kein ${thing} gefunden.`);
  if (name === 'NotReadableError')
    return new MediaRefused(
      `${thing === 'Kamera' ? 'Die Kamera' : 'Das ' + thing} wird gerade von einem anderen Programm benutzt.`,
    );
  if (name === 'AbortError') return new MediaRefused('');
  return new MediaRefused(`${thing} ließ sich nicht starten.`);
}

const supported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices;

/** The microphone, cleaned of echo and noise. */
export async function microphone(): Promise<MediaStreamTrack> {
  if (!supported()) throw new MediaRefused('Dieser Browser kann nicht telefonieren.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const [track] = stream.getAudioTracks();
    if (!track) throw new DOMException('', 'NotFoundError');
    return track;
  } catch (error) {
    throw refusal(error, 'mic');
  }
}

/** The camera, at a size each of a few others can take. */
export async function camera(): Promise<MediaStreamTrack> {
  if (!supported()) throw new MediaRefused('Dieser Browser kann keine Kamera zeigen.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 30 } },
    });
    const [track] = stream.getVideoTracks();
    if (!track) throw new DOMException('', 'NotFoundError');
    track.contentHint = 'motion';
    return track;
  } catch (error) {
    throw refusal(error, 'camera');
  }
}

/** A screen, window or tab the person picks – sharp rather than smooth. */
export async function screen(): Promise<MediaStreamTrack> {
  if (!supported() || !navigator.mediaDevices.getDisplayMedia)
    throw new MediaRefused('Dieser Browser kann den Bildschirm nicht teilen.');
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });
    const [track] = stream.getVideoTracks();
    if (!track) throw new DOMException('', 'NotFoundError');
    track.contentHint = 'detail';
    return track;
  } catch (error) {
    throw refusal(error, 'screen');
  }
}
