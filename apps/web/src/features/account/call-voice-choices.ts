import type { CallVoice } from '@slider/shared';

/**
 * The call voices as they are picked in `/einstellungen`: a language, a speaker in it, and – where
 * the service offers one speaker in several moods („Paul - Sad“, „Paul - Neutral“ …) – a mood.
 */

/** One voice of a speaker: its id and its mood in words (`null`: the speaker plain, „Standard“). */
export interface VoiceMood {
  id: string;
  mood: string | null;
}

/** A speaker in one language – its voices, the one taken first (neutral) leading. */
export interface VoiceSpeaker {
  key: string;
  name: string;
  gender: CallVoice['gender'];
  moods: VoiceMood[];
}

export interface VoiceLanguage {
  key: string;
  label: string;
  speakers: VoiceSpeaker[];
}

const LANGUAGES = new Intl.DisplayNames(['de'], { type: 'language' });
/** „Paul - Sad“ → Paul, Sad. */
const WITH_MOOD = /^(.+?)\s+[-–]\s+(.+)$/;
/** The service's moods in German; one it adds later shows as it names it. */
const MOODS: Record<string, string> = {
  neutral: 'Neutral',
  angry: 'Wütend',
  calm: 'Ruhig',
  cheerful: 'Heiter',
  confident: 'Selbstsicher',
  confused: 'Verwirrt',
  curious: 'Neugierig',
  excited: 'Begeistert',
  frustrated: 'Genervt',
  happy: 'Fröhlich',
  jealous: 'Eifersüchtig',
  jealousy: 'Eifersüchtig',
  sad: 'Traurig',
  sarcasm: 'Sarkastisch',
  sarcastic: 'Sarkastisch',
  shameful: 'Beschämt',
};
const OTHER = 'other';
const byGerman = new Intl.Collator('de').compare;

/** `de`, `de_DE` → `de`; `en_GB`, `en-gb` → `en_gb`; none → other. */
export function languageKey(language: string | null): string {
  const [code = '', region] = (language ?? '').toLowerCase().split(/[_-]/);
  if (!code) return OTHER;
  return region && region !== code ? `${code}_${region}` : code;
}

/** `de` → „Deutsch“, `en_us` → „Englisch (US)“ – as the service names it, where unknown. */
export function languageLabel(key: string): string {
  if (key === OTHER) return 'Weitere';
  const [code = '', region] = key.split('_');
  let name = key;
  try {
    name = LANGUAGES.of(code) ?? key;
  } catch {
    // Not a language code – shown as it came.
  }
  return region ? `${name} (${region.toUpperCase()})` : name;
}

export const genderLabel = (gender: CallVoice['gender']) =>
  gender === 'female' ? 'weiblich' : gender === 'male' ? 'männlich' : null;

export const moodLabel = (mood: string | null) =>
  mood === null ? 'Standard' : (MOODS[mood.toLowerCase()] ?? mood);

/** Plain first, then neutral, then the moods by their German names. */
const moodRank = (mood: VoiceMood) =>
  mood.mood === null ? 0 : mood.mood.toLowerCase() === 'neutral' ? 1 : 2;

/** The voices by language (German first, the rest by name), speaker (by name) and mood. */
export function voiceChoices(voices: readonly CallVoice[]): VoiceLanguage[] {
  const languages = new Map<string, Map<string, VoiceSpeaker>>();
  for (const voice of voices) {
    const [, speaker = voice.name, mood = null] = WITH_MOOD.exec(voice.name.trim()) ?? [];
    const language = languageKey(voice.language);
    const speakers = languages.get(language) ?? new Map<string, VoiceSpeaker>();
    languages.set(language, speakers);
    const key = speaker.toLowerCase();
    const found = speakers.get(key);
    if (found) found.moods.push({ id: voice.id, mood });
    else
      speakers.set(key, {
        key,
        name: speaker,
        gender: voice.gender,
        moods: [{ id: voice.id, mood }],
      });
  }
  const rank = (key: string) => (key === 'de' ? 0 : key === OTHER ? 2 : 1);
  return [...languages]
    .map(([key, speakers]) => ({
      key,
      label: languageLabel(key),
      speakers: [...speakers.values()]
        .map((speaker) => ({
          ...speaker,
          moods: speaker.moods.sort(
            (a, b) => moodRank(a) - moodRank(b) || byGerman(moodLabel(a.mood), moodLabel(b.mood)),
          ),
        }))
        .sort((a, b) => byGerman(a.name, b.name)),
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || byGerman(a.label, b.label));
}

/** Where a voice stands in {@link voiceChoices}; `null` one offered no more. */
export function placeOf(languages: readonly VoiceLanguage[], id: string) {
  for (const language of languages)
    for (const speaker of language.speakers) {
      const mood = speaker.moods.find((each) => each.id === id);
      if (mood) return { language, speaker, mood };
    }
  return null;
}

/** „Paul“, or „Paul (Traurig)“ where the speaker has moods. */
export function voiceName(speaker: VoiceSpeaker, mood: VoiceMood): string {
  return speaker.moods.length > 1 ? `${speaker.name} (${moodLabel(mood.mood)})` : speaker.name;
}

/** The voice to take on another speaker: the same mood where it has it, else its first. */
export function sameMood(speaker: VoiceSpeaker, mood: VoiceMood | null): VoiceMood {
  const wanted = mood?.mood?.toLowerCase();
  return (
    speaker.moods.find((each) => (each.mood?.toLowerCase() ?? null) === (wanted ?? null)) ??
    speaker.moods[0]!
  );
}
