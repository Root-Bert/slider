import type { ImageCredit, StockPhoto } from '@slider/shared';
import { useState } from 'react';
import { ImagePrompt, PhotoGrid, usePhotoTerm } from '@/features/viewer';
import {
  generateDocumentPicture,
  pickDocumentPhoto,
  useDocumentPhotos,
  useDocumentTools,
} from '@/lib/api/writer';
import { Button, IconButton } from '@/ui';
import { useWriter } from './session';

/**
 * A new picture at the caret, as a slide's picture frame fills: one row – „Datei“, „Foto suchen“
 * (the workspace's photo service, open from the start) and „Generieren“ (its key for pictures)
 * where the workspace has them. A picture comes as wide as the text, at most its own size.
 */
export function NewPicture({ onFile }: { onFile: () => void }) {
  const { engine, document: file, notify } = useWriter();
  const tools = useDocumentTools(file.id, file.permissions.canEdit).data;
  const stock = tools?.stockPhotos ?? false;
  const generation = tools?.imageGeneration ?? false;
  const [chosen, setChosen] = useState<'search' | 'generate' | null | undefined>(undefined);
  const open = chosen === undefined ? (stock ? 'search' : null) : chosen;
  const toggle = (what: 'search' | 'generate') => setChosen(open === what ? null : what);
  const [prompt, setPrompt] = useState('');
  const [making, setMaking] = useState(false);

  const insert = ({
    path,
    width,
    height,
    credit,
  }: {
    path: string;
    width: number;
    height: number;
    credit?: ImageCredit;
  }) => {
    const shown = Math.min(engine.contentWidthPt, width * 0.75);
    engine.insertPicture({
      path,
      ...(credit && { credit }),
      width: Math.round(shown * 100) / 100,
      height: Math.round(((shown * height) / width) * 100) / 100,
    });
  };
  const take = async (photo: StockPhoto) => insert(await pickDocumentPhoto(file.id, photo.id));
  const make = async (text: string) => {
    setMaking(true);
    try {
      insert(await generateDocumentPicture(file.id, text));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Das Bild ging nicht.', 'danger');
    } finally {
      setMaking(false);
    }
  };

  return (
    <>
      {/* As a slide's frame; in the comments' narrower column the words go without icons to fit. */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          title="Ein Bild von diesem Gerät an die Stelle des Cursors (↵)"
          onClick={onFile}
          className="flex-1"
        >
          Datei
        </Button>
        {stock && (
          <Button
            size="sm"
            variant={open === 'search' ? 'primary' : 'secondary'}
            aria-expanded={open === 'search'}
            title="Ein Foto suchen – es kommt so breit wie der Text."
            onClick={() => toggle('search')}
            className="flex-1"
          >
            Foto suchen
          </Button>
        )}
        {generation && (
          <IconButton
            size="sm"
            variant={open === 'generate' ? 'primary' : 'glass'}
            icon="autoAwesome"
            label="Generieren"
            expanded={open === 'generate'}
            title="Generieren – ein Bild aus einer Beschreibung"
            onClick={() => toggle('generate')}
            className="rounded-control-sm"
          />
        )}
      </div>
      {stock && open === 'search' && (
        <DocumentPhotos take={take} source={tools?.photoSource ?? 'unsplash'} />
      )}
      {generation && open === 'generate' && (
        <ImagePrompt
          prompt={prompt}
          onPrompt={setPrompt}
          pending={making}
          onSubmit={(text) => void make(text)}
        />
      )}
    </>
  );
}

/** The photo service searched, as for a slide's picture. */
function DocumentPhotos({
  take,
  source,
}: {
  take: (photo: StockPhoto) => Promise<void>;
  source: 'unsplash' | 'pexels';
}) {
  const { document: file, notify } = useWriter();
  const asked = usePhotoTerm();
  const search = useDocumentPhotos(file.id, asked.term);
  return (
    <PhotoGrid
      large={false}
      autoFocus={false}
      asked={asked}
      search={search}
      columns={2}
      take={take}
      source={source}
      onError={(message) => notify(message, 'danger')}
    />
  );
}
