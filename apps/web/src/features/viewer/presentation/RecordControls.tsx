import { buttonClasses, cn, Icon, IconButton, Menu } from '@/ui';
import { canRecord } from '../media/lib/recording';
import type { useShowRecording } from './show-recording';

/**
 * „Aufnehmen“ while presenting, with the camera or without (the microphone always); then pause,
 * resume and stop; once stopped, the file to download. Nothing where the browser cannot record.
 */
export function RecordControls({ recording }: { recording: ReturnType<typeof useShowRecording> }) {
  if (!canRecord()) return null;
  const { state } = recording;
  if (state === 'done') {
    return recording.file ? (
      <a
        href={recording.file.url}
        download={recording.file.fileName}
        className={buttonClasses({ variant: 'secondary', size: 'sm' })}
      >
        <Icon name="download" size={18} />
        Aufnahme herunterladen
      </a>
    ) : null;
  }
  if (state === 'recording' || state === 'paused') {
    return (
      <div className="flex items-center gap-1" role="group" aria-label="Aufnahme">
        <span
          className={cn(
            'mx-1 size-2.5 rounded-full bg-danger',
            state === 'recording' ? 'animate-pulse' : 'opacity-50',
          )}
          aria-hidden
        />
        <span className="mr-1 text-sm text-fg-muted">
          {state === 'recording' ? 'Aufnahme läuft' : 'Aufnahme angehalten'}
        </span>
        <IconButton
          icon={state === 'recording' ? 'pause' : 'record'}
          label={state === 'recording' ? 'Aufnahme anhalten' : 'Aufnahme fortsetzen'}
          size="sm"
          onClick={recording.toggle}
        />
        <IconButton icon="stop" label="Aufnahme beenden" size="sm" onClick={recording.stop} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {recording.failed && (
        <p role="status" className="text-sm text-warning">
          Kein Zugriff auf Mikrofon oder Kamera
        </p>
      )}
      <Menu
        label="Aufnehmen"
        triggerText="Aufnehmen"
        triggerIcon="record"
        triggerLoading={state === 'starting'}
        actions={[
          {
            label: 'Mit Kamera',
            icon: 'cameraVideo',
            onSelect: () => void recording.start(true),
          },
          { label: 'Ohne Kamera', icon: 'mic', onSelect: () => void recording.start(false) },
        ]}
      />
    </div>
  );
}
