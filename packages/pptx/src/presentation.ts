import { REL, type Archive } from './archive';
import { readAuthors, type AuthorDirectory } from './comments/authors';
import { readLegacyComments } from './comments/legacy';
import { readModernComments } from './comments/modern';
import { LayoutResolver } from './layouts';
import { parseSlide, type SlideRef } from './slides';
import { PptxError, type ParsedComment, type ParsedPresentation, type ParsedSlide } from './types';
import { attr, child, children, findByLocalName, intAttr, localName, type XmlElement } from './xml';

const PRESENTATION_PATH = 'ppt/presentation.xml';

/** Parses the whole package: slide list, sections, every slide and all comments. */
export async function parsePresentation(archive: Archive): Promise<ParsedPresentation> {
  const presentation = await archive.readXml(PRESENTATION_PATH);
  if (!presentation) {
    throw new PptxError('not_pptx', 'The file is not a PowerPoint (.pptx) package.');
  }

  const size = readSlideSize(presentation);
  const slideRefs = await readSlideRefs(archive, presentation);
  const layouts = new LayoutResolver(archive);
  const slides: ParsedSlide[] = [];
  for (const ref of slideRefs) {
    slides.push(await parseSlide(archive, ref, size, await layouts.forSlide(ref.path)));
  }

  return {
    size,
    slides,
    sections: readSections(presentation),
    comments: await readComments(archive, slideRefs, size),
  };
}

function readSlideSize(presentation: XmlElement): { cx: number; cy: number } {
  const slideSize = child(presentation, 'p:sldSz');
  const cx = intAttr(slideSize, 'cx');
  const cy = intAttr(slideSize, 'cy');
  if (!cx || !cy || cx <= 0 || cy <= 0) {
    throw new PptxError('corrupt', 'The presentation has no valid slide size.');
  }
  return { cx, cy };
}

async function readSlideRefs(archive: Archive, presentation: XmlElement): Promise<SlideRef[]> {
  const refs: SlideRef[] = [];
  for (const slideId of children(child(presentation, 'p:sldIdLst'), 'p:sldId')) {
    const sldId = intAttr(slideId, 'id');
    const relationship = await archive.relationshipById(
      PRESENTATION_PATH,
      attr(slideId, 'r:id') ?? '',
    );
    if (sldId === undefined || !relationship || !archive.has(relationship.target)) {
      throw new PptxError('corrupt', 'The slide list references a missing slide.');
    }
    refs.push({ sldId, index: refs.length, path: relationship.target });
  }
  return refs;
}

/** `p14:sectionLst` lives in an `p:extLst/p:ext` of the presentation. */
function readSections(presentation: XmlElement): ParsedPresentation['sections'] {
  const sectionList = findByLocalName(child(presentation, 'p:extLst'), 'sectionLst');
  return (sectionList?.children ?? [])
    .filter((section) => localName(section.name) === 'section')
    .map((section) => ({
      name: attr(section, 'name') ?? '',
      slideIds: (findByLocalName(section, 'sldIdLst')?.children ?? [])
        .map((slideId) => intAttr(slideId, 'id'))
        .filter((id): id is number => id !== undefined),
    }));
}

async function readComments(
  archive: Archive,
  slideRefs: SlideRef[],
  size: { cx: number; cy: number },
): Promise<ParsedComment[]> {
  const modernAuthors = await readAuthorPart(archive, REL.authors, 'ppt/authors.xml', 'author');
  const legacyAuthors = await readAuthorPart(
    archive,
    REL.commentAuthors,
    'ppt/commentAuthors.xml',
    'cmAuthor',
  );

  const comments: ParsedComment[] = [];
  for (const ref of slideRefs) {
    const slide = { sldId: ref.sldId, size };
    for (const rel of await archive.relationshipsOfType(ref.path, REL.modernComments)) {
      comments.push(...readModernComments(await archive.readXml(rel.target), slide, modernAuthors));
    }
    for (const rel of await archive.relationshipsOfType(ref.path, REL.legacyComments)) {
      comments.push(...readLegacyComments(await archive.readXml(rel.target), slide, legacyAuthors));
    }
  }
  return comments;
}

/** Author parts are found via the presentation's relationships, falling back to the usual path. */
async function readAuthorPart(
  archive: Archive,
  relType: string,
  fallbackPath: string,
  elementName: string,
): Promise<AuthorDirectory> {
  const [rel] = await archive.relationshipsOfType(PRESENTATION_PATH, relType);
  return readAuthors(await archive.readXml(rel?.target ?? fallbackPath), elementName);
}
