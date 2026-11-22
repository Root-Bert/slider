---
title: 'The Office ou LibreOffice : même format de fichier, autre idée du travail'
description: 'Les deux écrivent des fichiers Open Document. LibreOffice est un logiciel pour une personne sur un fichier. The Office est conçu pour des équipes et une IA qui travaillent sur le même fichier dans le navigateur.'
date: 2026-11-17
tag: Comparison
accent: blue
cover: { kind: versus, self: The Office, other: LibreOffice }
readingTime: 4 min de lecture
shortAnswer:
  text: LibreOffice est la suite bureautique libre la plus complète et la référence pour les fichiers Open Document. The Office utilise le même format, et LibreOffice lui-même comme moteur, mais place le fichier sur un serveur pour qu’une équipe et une IA y travaillent ensemble.
  facts:
    - Le même format ouvert, aucune conversion entre les deux
    - Commentaires, curseurs en direct et versions sont intégrés, pas ajoutés
    - L’IA modifie le vrai fichier et montre chaque changement
faq:
  - q: Puis-je ouvrir un fichier de The Office dans LibreOffice ?
    a: Oui. Slider travaille sur un vrai fichier ODP. Téléchargez-le et ouvrez-le dans LibreOffice Impress ou tout autre logiciel qui lit Open Document.
  - q: Tout The Office est-il disponible aujourd’hui ?
    a: Non. Slider, l’application de présentation, et Cloud, l’application de fichiers, sont disponibles. Writer et Solver sont en cours de développement.
  - q: The Office est-il open source ?
    a: Slider est publié sous la European Union Public Licence 1.2 et peut tourner sur votre propre serveur.
related:
  - open-document-and-the-deutschland-stack
  - slider-vs-powerpoint-comments
---

LibreOffice et The Office ne sont pas des adversaires. Slider dessine chaque diapositive avec un LibreOffice qui tourne sur le serveur. La différence n’est pas le fichier, c’est l’endroit où il se trouve et qui peut y travailler en même temps.

## Ce que les deux partagent

Les deux écrivent le [format Open Document](https://docs.oasis-open.org/office/OpenDocument/v1.4/OpenDocument-v1.4-part1-introduction.html) (ODF) : `.odt` pour le texte, `.ods` pour les tableaux, `.odp` pour les diapositives. ODF est une norme d’OASIS, en version 1.4 depuis fin 2025, et la version 1.2 est aussi [ISO/IEC 26300](https://en.wikipedia.org/wiki/OpenDocument_standardization). Un fichier créé dans l’un s’ouvre dans l’autre sans conversion. C’est le but d’un format ouvert : le document survit au logiciel.

## Le comparatif

|                       | LibreOffice                             | The Office                                          |
| --------------------- | --------------------------------------- | --------------------------------------------------- |
| Où il tourne          | Installé sur chaque ordinateur          | Dans le navigateur, hébergé ou sur votre serveur    |
| Format de fichier     | ODF                                     | ODF                                                 |
| Plusieurs à la fois   | Non, une personne par fichier           | <span class="ok">✓</span> en direct, par conception |
| Commentaires          | Enregistrés dans le fichier             | À l’endroit exact, partagés aussitôt                |
| Versions              | Des fichiers enregistrés et envoyés     | Gardées automatiquement, changements signalés       |
| IA                    | Aucune, par choix                       | <span class="ok">✓</span> modifie le fichier        |
| Hors ligne            | <span class="ok">✓</span> toujours      | Non                                                 |
| Étendue des fonctions | Très profonde, des décennies de travail | Plus étroite : texte, blocs, relecture, IA          |
| Licence               | MPL 2.0                                 | EUPL 1.2 (Slider)                                   |

## Collaboration

LibreOffice est un logiciel de bureau. Un document est ouvert par une personne, modifié, enregistré et envoyé. La suite de bureau ne permet pas l’édition simultanée à plusieurs. Calc peut partager un classeur, mais les changements sont fusionnés à l’enregistrement, pas pendant la frappe. L’édition en temps réel n’existe que dans des produits serveur construits sur le même code, comme [Collabora Online](https://en.wikipedia.org/wiki/Collabora_Online) ; la Document Foundation ne propose pas de version en ligne à elle.

The Office part de l’autre bout. Le fichier est sur un serveur. Tout le monde ouvre le même, voit les curseurs des autres, commente l’endroit exact, et personne n’envoie de copie. Ce n’est pas une fonction en plus, c’est la façon d’enregistrer. Les tours de relecture ne produisent plus de `final_v3_vraiment.odp`.

## IA

LibreOffice dit non, et clairement. L’annonce de la [version 26.8](https://blog.documentfoundation.org/blog/2026/08/26/libreoffice-26-8/) en août 2026 précise qu’elle ne contient pas d’IA. Le raisonnement tient : un logiciel qui n’envoie jamais un document nulle part est facile à auditer. Collabora a pris l’autre chemin et ajouté l’IA en option, [désactivée par défaut](https://itsfoss.com/news/libreoffice-26-8-release/).

Dans The Office, l’IA est une collègue avec les mêmes droits qu’une personne. Dans Slider, vous la sollicitez dans un commentaire. Elle lit le fil, modifie les vraies diapositives, signale chaque changement, et un clic l’annule. Elle ne produit ni l’image d’une diapositive ni un nouveau fichier dans un format étranger. Elle modifie l’ODP.

Le prix est à dire : une IA a besoin d’un modèle, et un modèle a besoin de vos contenus. Si ce n’est pas permis pour un document, la position de LibreOffice est la bonne pour ce document.

## Lequel, quand

Prenez LibreOffice si vous travaillez seul, hors ligne, ou s’il vous faut les fonctions profondes : publipostage, macros, tableaux croisés, une base de données, de longs documents à la mise en page complexe. Rien de libre ne s’en approche.

Prenez The Office quand le travail est celui d’une équipe : plusieurs personnes sur une présentation, des retours de l’extérieur, une IA qui exécute ce qui a été décidé. Aujourd’hui, c’est Slider. Writer et Solver suivent.

Comme les deux parlent ODF, ce n’est pas un choix pour la vie. Commencez une présentation dans Slider, finissez un détail dans Impress, importez-la de nouveau.
