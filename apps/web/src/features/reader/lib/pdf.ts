import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ReaderField, ReaderRect } from '@slider/shared';

GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

/** A page as it is shown: turned by its own rotation, in points. */
export interface PageSize {
  width: number;
  height: number;
}

/** A form field's place on its page, with what pdf.js knows of it. */
export interface FormWidget {
  /** The field's full name – one field may stand in several places. */
  name: string;
  page: number;
  rect: ReaderRect;
  type: ReaderField['type'];
  /** Radio: the value this button stands for; checkbox: its „on“ name. */
  onValue?: string;
  options?: { value: string; label: string }[];
  multiLine: boolean;
  readOnly: boolean;
  maxLen?: number;
  label?: string;
  /** What the file itself holds. */
  initial: string | boolean;
  /** Text size in the file, as a fraction of the page's height; 0 = fit to the box. */
  fontSize: number;
  align: 'left' | 'center' | 'right';
}

export async function openPdfFile(data: ArrayBuffer | string): Promise<PDFDocumentProxy> {
  const task = getDocument({
    ...(typeof data === 'string' ? { url: data, withCredentials: true } : { data }),
  });
  return task.promise;
}

/** Lets go of the file and its worker. */
export const closePdf = (doc: PDFDocumentProxy) => doc.loadingTask.destroy();

export async function pageSizes(pdf: PDFDocumentProxy): Promise<PageSize[]> {
  const sizes: PageSize[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  return sizes;
}

/**
 * Draws the page into the canvas at `scale` (points → CSS px) sharp for the screen. The form
 * fields are left out: our own stand over them.
 */
export function drawPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  { forms = false, ratio = window.devicePixelRatio || 1 }: { forms?: boolean; ratio?: number } = {},
) {
  const viewport = page.getViewport({ scale: scale * ratio });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  return page.render({
    canvas,
    viewport,
    // ENABLE draws every annotation's look into the canvas, fields included; ENABLE_FORMS leaves the
    // fields to a form layer we don't draw – our own fields stand there, with what the file holds.
    annotationMode: forms ? AnnotationMode.ENABLE : AnnotationMode.ENABLE_FORMS,
  });
}

/** The page's words as invisible spans over it: picked, copied, found. */
export async function drawTextLayer(page: PDFPageProxy, container: HTMLElement, scale: number) {
  container.replaceChildren();
  const layer = new TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport: page.getViewport({ scale }),
  });
  await layer.render();
  return layer;
}

/** The page's text, as one string, with where each item of it begins. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  return content.items
    .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
    .join('');
}

interface RawAnnotation {
  subtype?: string;
  fieldType?: string;
  fieldName?: string;
  rect?: number[];
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  buttonValue?: string;
  exportValue?: string;
  fieldValue?: string | string[];
  options?: { exportValue?: string; displayValue?: string }[];
  multiLine?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  maxLen?: number;
  alternativeText?: string;
  combo?: boolean;
  textAlignment?: number;
  defaultAppearanceData?: { fontSize?: number };
}

/** The page's form fields, where they stand on it as shown. */
export async function formWidgets(page: PDFPageProxy, index: number): Promise<FormWidget[]> {
  const viewport = page.getViewport({ scale: 1 });
  const annotations = (await page.getAnnotations({ intent: 'display' })) as RawAnnotation[];
  const widgets: FormWidget[] = [];
  for (const raw of annotations) {
    if (raw.subtype !== 'Widget' || !raw.fieldName || !raw.rect || raw.hidden) continue;
    if (raw.pushButton || raw.fieldType === 'Sig') continue;
    const [x1, y1] = viewport.convertToViewportPoint(raw.rect[0]!, raw.rect[1]!);
    const [x2, y2] = viewport.convertToViewportPoint(raw.rect[2]!, raw.rect[3]!);
    const left = Math.min(x1!, x2!);
    const top = Math.min(y1!, y2!);
    const rect = {
      x: clamp(left / viewport.width),
      y: clamp(top / viewport.height),
      w: clamp(Math.abs(x2! - x1!) / viewport.width),
      h: clamp(Math.abs(y2! - y1!) / viewport.height),
    };
    if (rect.w <= 0 || rect.h <= 0) continue;
    const base = {
      name: raw.fieldName,
      page: index,
      rect,
      multiLine: !!raw.multiLine,
      readOnly: !!raw.readOnly,
      ...(raw.alternativeText && { label: raw.alternativeText.slice(0, 200) }),
      fontSize: (raw.defaultAppearanceData?.fontSize ?? 0) / viewport.height,
      align: (['left', 'center', 'right'] as const)[raw.textAlignment ?? 0] ?? 'left',
    };
    const value = Array.isArray(raw.fieldValue) ? raw.fieldValue[0] : raw.fieldValue;
    if (raw.fieldType === 'Tx') {
      widgets.push({
        ...base,
        type: 'text',
        initial: value ?? '',
        ...(raw.maxLen && { maxLen: raw.maxLen }),
      });
    } else if (raw.fieldType === 'Btn' && raw.checkBox) {
      widgets.push({
        ...base,
        type: 'checkbox',
        onValue: raw.exportValue ?? 'Yes',
        initial: !!value && value !== 'Off',
      });
    } else if (raw.fieldType === 'Btn' && raw.radioButton && raw.buttonValue) {
      widgets.push({ ...base, type: 'radio', onValue: raw.buttonValue, initial: value ?? '' });
    } else if (raw.fieldType === 'Ch') {
      const options = (raw.options ?? []).map((option) => ({
        value: option.exportValue ?? option.displayValue ?? '',
        label: option.displayValue ?? option.exportValue ?? '',
      }));
      widgets.push({ ...base, type: 'choice', options, initial: value ?? '' });
    }
  }
  return widgets;
}

/** One entry per field, for the AI: its kind, its page, its options. */
export function fieldsOf(widgets: readonly FormWidget[]): ReaderField[] {
  const byName = new Map<string, ReaderField>();
  for (const widget of widgets) {
    if (widget.readOnly) continue;
    const known = byName.get(widget.name);
    if (known) {
      if (widget.type === 'radio' && widget.onValue && !known.options?.includes(widget.onValue)) {
        known.options = [...(known.options ?? []), widget.onValue];
      }
      continue;
    }
    byName.set(widget.name, {
      name: widget.name,
      page: widget.page,
      type: widget.type,
      ...(widget.label && { label: widget.label }),
      ...(widget.type === 'radio' && widget.onValue && { options: [widget.onValue] }),
      ...(widget.type === 'choice' && {
        options: widget.options?.map((option) => option.value).slice(0, 200),
      }),
    });
  }
  return [...byName.values()].slice(0, 500);
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
