import { MAX_COMMENT_BODY_LENGTH } from '@slider/shared';
import { AutosizeTextarea, ErrorText } from '@/ui';
import { isModEnter } from '@/lib/keyboard';
import { AttachedImages, AttachImageButton } from './AttachedImages';
import type { ImageAttachments } from './hooks/useImageAttachments';

/**
 * The note of a picture or recording reply – a text field like any other, so images can be
 * pasted into it or picked with the paperclip (BER-174) and show as tiny thumbnails in it.
 */
export function NoteField({
  label,
  value,
  onChange,
  onSend,
  images,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  images: ImageAttachments;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="field-well focus-field flex items-end gap-1 rounded-control-sm py-2 pr-1.5 pl-3">
        <div className="min-w-0 flex-1">
          <AutosizeTextarea
            aria-label={label}
            maxLength={MAX_COMMENT_BODY_LENGTH}
            placeholder={`Optional: ${label}`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onPaste={images.onPaste}
            onKeyDown={(event) => {
              if (isModEnter(event)) onSend();
            }}
            className="text-body leading-5 text-fg"
          />
          <AttachedImages attachments={images.attachments} onRemove={images.remove} />
        </div>
        <AttachImageButton
          onPick={(files) => void images.attach(files)}
          busy={images.busy}
          disabled={disabled || images.room === 0}
          size="compact"
        />
      </div>
      {images.error && (
        <ErrorText role="alert" size="xs">
          {images.error}
        </ErrorText>
      )}
    </>
  );
}
