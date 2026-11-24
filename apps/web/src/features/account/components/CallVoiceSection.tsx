import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { callVoiceSample, useCallVoice, usePickCallVoice } from '@/lib/api';
import { Button, ErrorText, Icon, Section, Select, type ShowToast } from '@/ui';
import {
  genderLabel,
  moodLabel,
  placeOf,
  sameMood,
  voiceChoices,
  voiceName,
} from '../call-voice-choices';

/**
 * „Anrufe“ in `/einstellungen`: the voice agents speak with where you call them or bring them into
 * a call – everyone in that call hears it. First the language (German first), then a speaker in
 * it, and a mood only where that speaker has several; none picked, the first German one shows.
 * Each change keeps the voice at once and reads its sample (the one before stops); „Anhören“
 * reads it again. The sample is German like the agent in a call – the others with their accent.
 */
export function CallVoiceSection({ onNotify }: { onNotify: ShowToast }) {
  const voices = useCallVoice();
  const pick = usePickCallVoice();
  const sample = useSample(onNotify);
  const languageId = useId();
  const voiceId = useId();
  const moodId = useId();

  const list = voices.data?.voices;
  const languages = useMemo(() => voiceChoices(list ?? []), [list]);
  const picked = pick.isPending ? pick.variables : (voices.data?.picked ?? null);
  const current = picked ?? voices.data?.automatic ?? '';
  const place = placeOf(languages, current);
  const language = place?.language ?? languages[0];
  const speaker = place?.speaker;

  const choose = (next: string) => {
    if (next === current) return;
    sample.play(next);
    const shown = placeOf(languages, next);
    pick.mutate(next, {
      onSuccess: () => onNotify(`Stimme: ${shown ? voiceName(shown.speaker, shown.mood) : next}`),
      onError: (error) => onNotify(error.message, 'danger'),
    });
  };

  let rows;
  if (voices.isError) rows = <ErrorText>{voices.error.message}</ErrorText>;
  else if (voices.data && languages.length === 0)
    rows = (
      <p className="flex gap-1.5 text-xs text-fg-subtle">
        <Icon name="info" size={14} className="mt-px shrink-0" />
        Stimmen gibt es mit einem Mistral-Key für Live-Mitschrift in einem deiner Workspaces. Ohne
        ihn liest der Browser die Antworten vor.
      </p>
    );
  else {
    const loading = [{ value: '', label: 'Wird geladen …' }];
    const speakers = (language?.speakers ?? []).map((each) => ({
      value: each.key,
      label: [each.name, genderLabel(each.gender)].filter(Boolean).join(' | '),
    }));
    // One column: the voice's field and its button (12 + 0.5 + 7 rem) as wide as the others.
    rows = (
      <div className="flex flex-col divide-y divide-hairline">
        <Row
          id={languageId}
          className="pb-3"
          label="Sprache"
          hint="Im Anruf sprechen alle Deutsch – mit ihrem Akzent."
        >
          <Select
            className="min-w-0 sm:w-[19.5rem]"
            aria-labelledby={languageId}
            value={language?.key ?? ''}
            disabled={!voices.data}
            options={
              language ? languages.map((each) => ({ value: each.key, label: each.label })) : loading
            }
            onChange={(key) => {
              const next = languages.find((each) => each.key === key)?.speakers[0];
              if (next) choose(sameMood(next, place?.mood ?? null).id);
            }}
          />
        </Row>
        <Row
          id={voiceId}
          className={speaker && speaker.moods.length > 1 ? 'py-3' : 'pt-3'}
          label="Stimme"
          hint="Gilt ab dem nächsten Anruf."
        >
          <div className="flex min-w-0 items-center gap-2">
            <Select
              className="min-w-0 sm:w-48"
              aria-labelledby={voiceId}
              value={voices.data ? (speaker?.key ?? current) : ''}
              disabled={!voices.data}
              options={
                !voices.data
                  ? loading
                  : // A voice picked before that is offered no more stays shown until another is.
                    [
                      ...(speaker || !current ? [] : [{ value: current, label: current }]),
                      ...speakers,
                    ]
              }
              onChange={(key) => {
                const next = language?.speakers.find((each) => each.key === key);
                if (next) choose(sameMood(next, place?.mood ?? null).id);
              }}
            />
            <Button
              className="w-28 shrink-0"
              variant="secondary"
              icon={sample.playing ? 'stop' : 'playArrow'}
              loading={sample.loading}
              disabled={!current}
              onClick={() => {
                if (sample.playing) sample.stop();
                else if (current) sample.play(current);
              }}
            >
              {sample.playing ? 'Stopp' : 'Anhören'}
            </Button>
          </div>
        </Row>
        {speaker && speaker.moods.length > 1 && (
          <Row
            id={moodId}
            className="pt-3"
            label="Stimmung"
            hint="Dieselbe Stimme, anders gestimmt."
          >
            <Select
              className="min-w-0 sm:w-[19.5rem]"
              aria-labelledby={moodId}
              value={current}
              options={speaker.moods.map((each) => ({
                value: each.id,
                label: moodLabel(each.mood),
              }))}
              onChange={choose}
            />
          </Row>
        )}
      </div>
    );
  }

  return (
    <Section
      id="anrufe"
      title="Anrufe"
      description="Wenn du einen Agent anrufst oder in einen Anruf holst, spricht er mit deiner Stimme – für alle im Anruf."
    >
      {rows}
    </Section>
  );
}

/** A settings row: its name and a quiet line under it, the control at the right. */
function Row({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <span id={id} className="text-sm text-fg">
        {label}
        <span className="block text-xs text-fg-subtle">{hint}</span>
      </span>
      {children}
    </div>
  );
}

/** Reads a voice's sample – one at a time; each fetched once while the settings are open. */
function useSample(onNotify: ShowToast) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const asked = useRef(0);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');

  useEffect(() => {
    const made = urls.current;
    return () => {
      // A sample still on its way is not read out on the page one went on to.
      asked.current += 1;
      audio.current?.pause();
      for (const url of made.values()) URL.revokeObjectURL(url);
      made.clear();
    };
  }, []);

  const stop = () => {
    asked.current += 1;
    audio.current?.pause();
    setState('idle');
  };

  const play = async (voice: string) => {
    stop();
    const ask = asked.current;
    let url = urls.current.get(voice);
    if (!url) {
      setState('loading');
      try {
        url = URL.createObjectURL(await callVoiceSample(voice));
      } catch (error) {
        if (ask === asked.current) {
          setState('idle');
          onNotify(error instanceof Error ? error.message : 'Die Hörprobe kam nicht.', 'danger');
        }
        return;
      }
      urls.current.set(voice, url);
    }
    if (ask !== asked.current) return;
    const player = (audio.current ??= new Audio());
    player.onended = () => setState('idle');
    player.src = url;
    setState('playing');
    player.play().catch(() => setState('idle'));
  };

  return {
    play: (voice: string) => void play(voice),
    stop,
    loading: state === 'loading',
    playing: state === 'playing',
  };
}
