---
title: 'Open Document and the Deutschland-Stack: what was decided and what it means'
description: 'Germany named ODF and PDF/UA as the document formats of its public digital infrastructure. What the decisions say, what they do not say, and how ODF differs from DOCX.'
date: 2026-11-17
tag: Guide
accent: green
cover: { kind: slide }
readingTime: 5 min read
shortAnswer:
  text: The Deutschland-Stack lists ODF and PDF/UA as its document formats. German states are to support ODF step by step from 1 January 2027. It is not a ban on other formats, but anyone working with public bodies should be able to read and write ODF.
  facts:
    - ODF for documents that are edited, PDF/UA for documents that are final
    - State administrations support ODF from 1 January 2027, review in 2028
    - ODF is a ZIP of plain XML, specified by OASIS and ISO
faq:
  - q: Are DOCX and PPTX forbidden in German administration now?
    a: No. The decisions set ODF as the standard for exchange and as a basis for solutions in the Deutschland-Stack. They do not ban other formats.
  - q: Does Microsoft Office open ODF files?
    a: Yes, Word, Excel and PowerPoint read and write ODF. Complex layouts can shift, so check important files.
  - q: What is the difference between ODF and PDF/UA?
    a: ODF is for documents people keep editing. PDF/UA is a fixed, accessible PDF for documents that are finished.
related:
  - bertro-office-vs-libreoffice
  - slider-vs-powerpoint-comments
---

In March 2026 headlines said Germany had made the Open Document Format mandatory. The decisions are more careful than the headlines. Here is what they say, with the sources.

## What was decided

Three decisions of the IT-Planungsrat, the body in which the federal government and the states steer public IT, build on each other.

1. **March 2025, [decision 2025/06](https://www.it-planungsrat.de/beschluss/beschluss-2025-06).** Open formats such as ODF are to be used more widely, so that ODF becomes the standard for document exchange by 2027. It also calls sending documents by mail between states outdated.
2. **November 2025, [decision B-2025/44-IT](https://www.it-planungsrat.de/beschluss/b-2025-44-it).** State administrations support ODF step by step from 1 January 2027. The decision is evaluated in 2028.
3. **March 2026, [decision B-2026/03-IT](https://www.it-planungsrat.de/beschluss/b-2026-03-it).** The standards of the Deutschland-Stack are adopted as the binding basis of its solutions. The [stack's overview](https://deutschland-stack.gov.de/gesamtbild/) lists "ODF and PDF/UA as document formats" under semantic technologies. No other document format is named.

## What it does not say

The word "binding" refers to solutions built for the Deutschland-Stack. For everything else, the federal government, states and municipalities "strive" to use them in new developments. There is no date on which a DOCX becomes invalid, and no rule for companies.

So "Germany bans Microsoft formats" is wrong. "The German public sector has chosen ODF as its document format and set a start date" is right. The direction is clear, the enforcement is soft. Offers for all levels of government are due by 2028.

## What the Deutschland-Stack is

It is the federal plan for a shared digital infrastructure: a platform core (identity, payment, data exchange, mailbox), reusable platforms for AI, data and workflows, and managed services. Its rules prefer international standards, open source and European providers. Document formats are a small part of it, but the part every office worker touches.

## Why ODF and not DOCX

Both are ZIP archives full of XML. The difference is who controls the specification and how closely programs follow it.

**ODF** is developed in an open committee at [OASIS](https://docs.oasis-open.org/office/OpenDocument/v1.4/OpenDocument-v1.4-part1-introduction.html), with version 1.4 approved in 2025 and version 1.2 published as [ISO/IEC 26300](https://en.wikipedia.org/wiki/OpenDocument_standardization). An `.odt`, `.ods` or `.odp` contains:

- `content.xml`: the text, tables or slides
- `styles.xml`: fonts, colours, page layouts
- `meta.xml`: author, dates, title
- `META-INF/manifest.xml`: the list of everything in the archive
- pictures and other media as ordinary files

Rename a file to `.zip` and you can read it with a text editor. Several independent programs write the same format.

**OOXML** (DOCX, XLSX, PPTX) is also an ISO standard, ISO/IEC 29500, but it comes in two variants. "Strict" is the clean one. "Transitional" keeps behaviour of old Microsoft Office versions for compatibility, and it is what Office [writes in practice](https://en.wikipedia.org/wiki/Office_Open_XML). A study published by the EU's Open Source Observatory describes how this [hinders other implementations](https://interoperable-europe.ec.europa.eu/collection/open-source-observatory-osor/document/complex-singularity-versus-openness). The format is open on paper and tied to one product in use.

For a state this is a practical question: can a file from 2026 still be opened in 2056, by software from any vendor, without a licence? With ODF the answer does not depend on one company.

**PDF/UA** (ISO 14289) covers the other case. It is a PDF with a tagged structure that screen readers can follow. Use it when a document is finished and must look the same everywhere.

## Who already works this way

Schleswig-Holstein made ODF its standard format in 2024 and had about [80 percent of its workplaces on LibreOffice](https://borncity.com/blog/?p=319090) by the end of 2025. The remaining ones depend on specialist software tied to Microsoft Office. That is the real work of a migration: not the documents, but macros, templates and programs that expect a certain office suite. The EU's interoperability portal has a [summary of the German path](https://interoperable-europe.ec.europa.eu/node/732585).

## How to switch

1. **Set the default.** Save new documents as ODF. Every current office suite can.
2. **Leave the archive alone.** Convert old files when someone needs them, not all at once.
3. **Test the hard ones first.** Templates, forms, spreadsheets with macros and decks with special fonts show where a conversion shifts.
4. **Embed fonts or use free ones.** Most layout differences between programs are missing fonts.
5. **Send PDF/UA when nothing should change.** ODF is for work in progress.

## Where The Office stands

The Office is built on ODF from the first file. Slider edits a real ODP, not an internal format that is exported at the end. What you download is the file itself, readable in LibreOffice and any other program that follows the standard.
