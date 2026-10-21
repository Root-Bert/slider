# Slider logo

The mark (two offset slides) and the word "Slider", as SVG (the word as outlines, no font needed)
and as PNG with a transparent background, one folder per layout:

| Folder        | Layout                       | PNG width |
| ------------- | ---------------------------- | --------- |
| `horizontal/` | mark beside the word         | 4000 px   |
| `stacked/`    | mark above the word, centred | 2048 px   |
| `mark/`       | mark alone                   | 2048 px   |
| `word/`       | word alone                   | 4000 px   |

Each layout comes for dark backgrounds (`slider-dark-…`, white word) and light ones
(`slider-light-…`, black word), with the slides in one of three colours:

| Name   | Slides                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------- |
| `mono` | the ink colour, the back slide at 45 %                                                                |
| `sage` | the website's accent `#8fcb9b`; back slide dark sage `#3d7a4b` at 60 % on light, sage at 45 % on dark |
| `sky`  | its blue sibling `#8dadd7`; back slide `#3b5f91` at 60 % on light, sky at 45 % on dark                |

The front slide is 80 % opaque, so the back one shows through where they overlap. The files come
from `scripts/logo-files.py` (SVG) and `scripts/logo-png.ts` (PNG).

The name and logo of Slider are not licensed under the AGPL: all rights reserved.
