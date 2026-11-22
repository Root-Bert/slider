---
title: 'Open Document et le Deutschland-Stack : ce qui a été décidé et ce que cela signifie'
description: 'L’Allemagne désigne ODF et PDF/UA comme formats de document de son infrastructure numérique publique. Ce que disent les décisions, ce qu’elles ne disent pas, et ce qui distingue ODF de DOCX.'
date: 2026-11-17
tag: Guide
accent: green
cover: { kind: slide }
readingTime: 5 min de lecture
shortAnswer:
  text: Le Deutschland-Stack retient ODF et PDF/UA comme formats de document. Les Länder doivent prendre en charge ODF progressivement à partir du 1er janvier 2027. Ce n’est pas une interdiction des autres formats, mais qui travaille avec l’administration allemande devrait savoir lire et écrire ODF.
  facts:
    - ODF pour les documents que l’on modifie, PDF/UA pour ceux qui sont terminés
    - Les administrations des Länder prennent en charge ODF dès le 1er janvier 2027, bilan en 2028
    - ODF est un ZIP de XML lisible, spécifié par OASIS et l’ISO
faq:
  - q: DOCX et PPTX sont-ils désormais interdits dans l’administration allemande ?
    a: Non. Les décisions font d’ODF la norme d’échange et la base des solutions du Deutschland-Stack. Elles n’interdisent pas les autres formats.
  - q: Microsoft Office ouvre-t-il les fichiers ODF ?
    a: Oui, Word, Excel et PowerPoint lisent et écrivent ODF. Les mises en page complexes peuvent bouger, vérifiez les fichiers importants.
  - q: Quelle est la différence entre ODF et PDF/UA ?
    a: ODF sert aux documents que l’on continue de modifier. PDF/UA est un PDF figé et accessible pour les documents terminés.
related:
  - bertro-office-vs-libreoffice
  - slider-vs-powerpoint-comments
---

En mars 2026, les titres annonçaient que l’Allemagne avait rendu le format Open Document obligatoire. Les décisions sont plus prudentes que les titres. Voici ce qu’elles disent, avec les sources.

## Ce qui a été décidé

Trois décisions de l’IT-Planungsrat, l’instance où l’État fédéral et les Länder pilotent l’informatique publique, s’appuient l’une sur l’autre.

1. **Mars 2025, [décision 2025/06](https://www.it-planungsrat.de/beschluss/beschluss-2025-06).** Les formats ouverts comme ODF doivent être plus largement utilisés, pour qu’ODF devienne la norme d’échange de documents d’ici 2027. Elle juge aussi dépassé l’envoi de documents par mail entre Länder.
2. **Novembre 2025, [décision B-2025/44-IT](https://www.it-planungsrat.de/beschluss/b-2025-44-it).** Les administrations des Länder prennent en charge ODF progressivement à partir du 1er janvier 2027. La décision sera évaluée en 2028.
3. **Mars 2026, [décision B-2026/03-IT](https://www.it-planungsrat.de/beschluss/b-2026-03-it).** Les normes du Deutschland-Stack sont adoptées comme base contraignante de ses solutions. La [vue d’ensemble du stack](https://deutschland-stack.gov.de/gesamtbild/) cite « ODF et PDF/UA comme formats de document » parmi les technologies sémantiques. Aucun autre format de document n’est nommé.

## Ce qu’elle ne dit pas

Le mot « contraignant » vise les solutions construites pour le Deutschland-Stack. Pour le reste, l’État fédéral, les Länder et les communes « s’efforcent » de les utiliser dans leurs nouveaux développements. Il n’y a pas de date à laquelle un DOCX devient invalide, ni de règle pour les entreprises.

« L’Allemagne interdit les formats de Microsoft » est donc faux. « Le secteur public allemand a choisi ODF comme format de document et fixé une date de départ » est juste. La direction est claire, la contrainte est faible. Des offres pour tous les niveaux de l’administration sont attendues d’ici 2028.

## Ce qu’est le Deutschland-Stack

C’est le plan fédéral d’une infrastructure numérique commune : un noyau de plateforme (identité, paiement, échange de données, boîte de réception), des plateformes réutilisables pour l’IA, les données et les processus, et des services gérés. Ses règles privilégient les normes internationales, l’open source et les fournisseurs européens. Les formats de document n’en sont qu’une petite part, mais celle que touche chaque personne au bureau.

## Pourquoi ODF et pas DOCX

Les deux sont des archives ZIP pleines de XML. La différence tient à qui contrôle la spécification et à la fidélité des logiciels.

**ODF** est élaboré dans un comité ouvert chez [OASIS](https://docs.oasis-open.org/office/OpenDocument/v1.4/OpenDocument-v1.4-part1-introduction.html), la version 1.4 a été approuvée en 2025 et la version 1.2 publiée comme [ISO/IEC 26300](https://en.wikipedia.org/wiki/OpenDocument_standardization). Un `.odt`, `.ods` ou `.odp` contient :

- `content.xml` : le texte, les tableaux ou les diapositives
- `styles.xml` : polices, couleurs, mises en page
- `meta.xml` : auteur, dates, titre
- `META-INF/manifest.xml` : la liste de tout ce que contient l’archive
- les images et autres médias comme des fichiers ordinaires

Renommez un fichier en `.zip` et vous pouvez le lire avec un éditeur de texte. Plusieurs logiciels indépendants écrivent le même format.

**OOXML** (DOCX, XLSX, PPTX) est aussi une norme ISO, ISO/IEC 29500, mais en deux variantes. « Strict » est la variante propre. « Transitional » conserve le comportement d’anciennes versions de Microsoft Office, et c’est ce qu’Office [écrit en pratique](https://en.wikipedia.org/wiki/Office_Open_XML). Une étude publiée par l’Open Source Observatory de l’UE décrit comment cela [gêne les autres implémentations](https://interoperable-europe.ec.europa.eu/collection/open-source-observatory-osor/document/complex-singularity-versus-openness). Le format est ouvert sur le papier et lié à un produit à l’usage.

Pour un État, la question est pratique : un fichier de 2026 s’ouvrira-t-il encore en 2056, avec le logiciel de n’importe quel éditeur, sans licence ? Avec ODF, la réponse ne dépend pas d’une seule entreprise.

**PDF/UA** (ISO 14289) couvre l’autre cas. C’est un PDF à la structure balisée que les lecteurs d’écran peuvent suivre. Utilisez-le quand un document est terminé et doit avoir le même aspect partout.

## Qui travaille déjà ainsi

Le Schleswig-Holstein a fait d’ODF son format par défaut en 2024 et comptait fin 2025 environ [80 pour cent de ses postes sous LibreOffice](https://borncity.com/blog/?p=319090). Les autres dépendent de logiciels métier liés à Microsoft Office. C’est le vrai travail d’une migration : pas les documents, mais les macros, les modèles et les logiciels qui attendent une suite bureautique précise. Le portail d’interopérabilité de l’UE propose un [résumé du chemin allemand](https://interoperable-europe.ec.europa.eu/node/732585).

## Comment passer à ODF

1. **Fixez le format par défaut.** Enregistrez les nouveaux documents en ODF. Toutes les suites actuelles le savent.
2. **Laissez les archives tranquilles.** Convertissez les anciens fichiers quand quelqu’un en a besoin, pas tous d’un coup.
3. **Testez d’abord les plus difficiles.** Modèles, formulaires, classeurs avec macros et présentations aux polices particulières montrent où une conversion bouge.
4. **Incorporez les polices ou prenez-en de libres.** La plupart des écarts de mise en page entre logiciels viennent de polices manquantes.
5. **Envoyez du PDF/UA quand rien ne doit plus changer.** ODF est pour le travail en cours.

## Où se situe The Office

The Office repose sur ODF dès le premier fichier. Slider modifie un vrai ODP, pas un format interne exporté à la fin. Ce que vous téléchargez est le fichier lui-même, lisible dans LibreOffice et dans tout autre logiciel qui suit la norme.
