---
title: 'The Office vs. LibreOffice: same file format, different idea of work'
description: 'Both write Open Document files. LibreOffice is a desktop suite for one person at one file. The Office is built for teams and an AI working on the same file in the browser.'
date: 2026-11-17
tag: Comparison
accent: blue
cover: { kind: versus, self: The Office, other: LibreOffice }
readingTime: 4 min read
shortAnswer:
  text: LibreOffice is the most complete free desktop suite and the reference for Open Document files. The Office uses the same format, and LibreOffice itself as its engine, but puts the file on a server so a team and an AI can work on it together.
  facts:
    - Same open file format, no conversion between the two
    - Comments, live cursors and versions are built in, not added on
    - The AI edits the real file and shows every change
faq:
  - q: Can I open a The Office file in LibreOffice?
    a: Yes. Slider works on a real ODP file. Download it and open it in LibreOffice Impress or any other program that reads Open Document.
  - q: Is all of The Office available today?
    a: No. Slider, the presentation app, and Cloud, the files app, are live. Writer and Solver are in development.
  - q: Is The Office open source?
    a: Slider is published under the European Union Public Licence 1.2 and can be self-hosted.
related:
  - open-document-and-the-deutschland-stack
  - slider-vs-powerpoint-comments
---

LibreOffice and The Office are not enemies. Slider renders every slide with LibreOffice running on the server. The difference is not the file, it is where the file lives and who can work on it at once.

## What both share

Both write [Open Document Format](https://docs.oasis-open.org/office/OpenDocument/v1.4/OpenDocument-v1.4-part1-introduction.html) (ODF): `.odt` for text, `.ods` for tables, `.odp` for slides. ODF is an OASIS standard, version 1.4 since late 2025, and version 1.2 is also [ISO/IEC 26300](https://en.wikipedia.org/wiki/OpenDocument_standardization). A file made in one opens in the other without conversion. That is the point of an open format: the document outlives the program.

## How the two compare

|                        | LibreOffice                      | The Office                                |
| ---------------------- | -------------------------------- | ----------------------------------------- |
| Where it runs          | Installed on each computer       | In the browser, hosted or on your server  |
| File format            | ODF                              | ODF                                       |
| Several people at once | No, one editor per file          | <span class="ok">✓</span> live, by design |
| Comments               | Stored inside the file           | On the exact spot, shared at once         |
| Versions               | Files you save and send          | Kept automatically, changes flagged       |
| AI                     | None, on purpose                 | <span class="ok">✓</span> edits the file  |
| Works offline          | <span class="ok">✓</span> always | No                                        |
| Feature depth          | Very deep, decades of work       | Narrower: text, boxes, review, AI         |
| Licence                | MPL 2.0                          | EUPL 1.2 (Slider)                         |

## Collaboration

LibreOffice is a desktop program. A document is opened by one person, edited, saved and sent on. There is no real-time editing by several people in the desktop suite. Calc can share a spreadsheet, but changes are merged when someone saves, not while they type. Real-time editing exists only in server products built on the same code, such as [Collabora Online](https://en.wikipedia.org/wiki/Collabora_Online); The Document Foundation does not ship an online version of its own.

The Office starts from the other end. The file lives on a server. Everyone opens the same one, sees the others' cursors, comments on the exact spot, and nobody mails a copy. This is not a feature on top, it is the storage model. Review rounds stop producing `final_v3_really.odp`.

## AI

LibreOffice says no, and clearly. The announcement of [version 26.8](https://blog.documentfoundation.org/blog/2026/08/26/libreoffice-26-8/) in August 2026 states that there is no AI in it. The reasoning is sound: software that never sends a document anywhere is easy to audit. Collabora took the other path and added AI as an opt-in that is [off by default](https://itsfoss.com/news/libreoffice-26-8-release/).

In The Office the AI is a colleague with the same rights as a person. In Slider you ask it in a comment. It reads the thread, changes the real slides, marks every change, and one click takes it back. It does not produce a picture of a slide or a new file in a foreign format. It edits the ODP.

The cost is honest to name: an AI needs a model, and a model needs your content to be sent to it. If that is not allowed for a document, LibreOffice's position is the right one for that document.

## Which one when

Take LibreOffice when you work alone, offline, or need the deep features: mail merge, macros, pivot tables, a database, long documents with complex layout. Nothing free comes close.

Take The Office when the work is a team's: several people on one presentation, feedback from outside, an AI that carries out what was decided. Today that means Slider. Writer and Solver follow.

Because both speak ODF, this is not a decision for life. Start a deck in Slider, finish a detail in Impress, upload it again.
