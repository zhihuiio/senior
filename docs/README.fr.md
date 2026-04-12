<div align="center">

<img src="../resources/senior_v2.png" alt="Senior Logo" width="120" height="120">

# Senior

### Votre équipe 24/7 d’ingénieurs senior

### Un harness IA multi-agent desktop conçu pour les tâches logicielles de long horizon

Senior est un harness IA multi-agent desktop basé sur Electron qui transforme la collecte d’exigences en PRD structurés, puis orchestre les tâches d’ingénierie de long horizon via une exécution IA par étapes avec validations humaines.

De l’évaluation d’exigences à la conception PRD, revue technique, développement, QA et notes de déploiement, Senior rend chaque étape traçable grâce aux artefacts et à l’historique d’exécution.

[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](#installation)
[![Stack](https://img.shields.io/badge/stack-Electron%20%7C%20React%20%7C%20TypeScript-blue.svg)](#fonctionnement)
[![Database](https://img.shields.io/badge/database-SQLite-0f766e.svg)](#données--artefacts)
[![Language](https://img.shields.io/badge/ui-English%20%7C%20简体中文-8b5cf6.svg)](#fonctionnalités)

[Installation](#installation) · [Démarrage rapide](#démarrage-rapide) · [Fonctionnement](#fonctionnement) · [Contribuer](#contribuer)

**[English](../README.md)** | **[简体中文](./README.zh-CN.md)** | **[繁體中文](./README.zh-TW.md)** | **[Español](./README.es.md)** | **[Deutsch](./README.de.md)** | **[日本語](./README.ja.md)**

</div>

---

<div align="center">

![Senior Screenshot](../resources/senior_v2.png)

</div>

---

## Captures d’écran

<div align="center">
  <img src="../resources/1.png" alt="Capture Senior 1" width="32%">
  <img src="../resources/2.png" alt="Capture Senior 2" width="32%">
  <img src="../resources/3.png" alt="Capture Senior 3" width="32%">
</div>

---

## Pourquoi Senior ?

La plupart des outils IA s’arrêtent au chat. Senior est conçu comme votre équipe d’ingénierie toujours active pour des livraisons logicielles de long horizon, avec des workflows pilotés par états explicites :

- Les exigences suivent des états explicites : `pending -> evaluating -> prd_designing -> prd_reviewing -> queued/canceled`
- Les tâches suivent des étapes de delivery : `idle -> arch_designing -> tech_reviewing -> coding -> qa_reviewing -> deploying -> done`
- Chaque étape génère artefacts et traces, pour comprendre exactement ce qui s’est passé
- L’intervention humaine est native pour les gates de revue et les révisions

Senior est conçu pour les équipes qui veulent l’exécution IA avec contrôle de processus, pas seulement des échanges prompt-réponse.

---

## Fonctionnalités

<table>
<tr>
<td width="50%">

### Pipeline d’exigences
Évalue automatiquement la pertinence d’une exigence, génère des brouillons PRD, effectue la revue qualité et met en file les tâches exécutables.

### Boucle d’orchestration des tâches
Exécute conception d’architecture, revue technique, développement, revue QA et consignes de déploiement via un flux par étapes.

### Gates Human-in-the-Loop
Quand une étape nécessite un contexte humain, Senior met en pause et reprend après une réponse structurée.

</td>
<td width="50%">

### Traces et timeline par étape
Inspectez les runs d’étape (rounds, durée, statut) et les traces détaillées agent/outils de chaque run.

### Rail d’artefacts
Chaque étape persiste des artefacts (ex. `arch_design.md`, `tech_review.json`, `code.md`, `qa.json`, `deploy.md`).

### Stockage local-first
Métadonnées projet, états exigences/tâches et runs d’étapes sont stockés en SQLite locale avec évolution automatique du schéma.

</td>
</tr>
</table>

### Également inclus

- **Deux auto-processors** pour les boucles exigences et tâches
- **Exécution liée au workspace** dans les répertoires projet sélectionnés
- **UI bilingue** (`en-US` et `zh-CN`) avec préférence locale persistée
- **Frontière IPC Electron** entre renderer et services du process principal

---

## Installation

### Prérequis

- Node.js 20+ (recommandé)
- npm 10+
- Machine avec environnement graphique (Electron)
- Identifiants runtime Claude Agent SDK configurés localement

### Lancer depuis les sources

```bash
git clone https://github.com/zhihuiio/senior.git
cd senior
npm install
npm run dev
```

### Build

```bash
npm run build
npm run preview
```

---

## Démarrage rapide

1. Lancez l’app avec `npm run dev`.
2. Créez ou sélectionnez un répertoire de projet.
3. Ajoutez des exigences dans le workspace.
4. Démarrez le Requirement Auto Processor pour évaluer et produire des PRD.
5. Vérifiez les tâches en file puis démarrez le Task Auto Processor.
6. Inspectez traces et artefacts, puis fournissez un retour humain lorsqu’un gate met l’exécution en pause.

Astuce : vous pouvez aussi orchestrer manuellement une tâche spécifique et répondre directement dans les flows de conversation humaine.

---

## Fonctionnement

```text
┌─────────────────────────────────────────────────────────────────────┐
│                           Senior Desktop                            │
│  ┌───────────────┐   IPC   ┌─────────────────────────────────────┐  │
│  │ React Renderer│◄───────►│ Electron Main Services             │  │
│  │ (UI + State)  │         │ - project/requirement/task service │  │
│  └───────────────┘         │ - auto processors                  │  │
│                            │ - stage run + trace management     │  │
│                            └───────────────┬─────────────────────┘  │
│                                            │                        │
│                            ┌───────────────▼─────────────────────┐  │
│                            │ Claude Agent SDK                    │  │
│                            │ - requirement agents                │  │
│                            │ - task stage agents                 │  │
│                            └───────────────┬─────────────────────┘  │
│                                            │                        │
│                ┌───────────────────────────▼─────────────────────┐  │
│                │ Local data                                      │  │
│                │ - SQLite app.db (Electron userData)            │  │
│                │ - .senior/tasks/<taskId> artifacts              │  │
│                └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Machine d’états Requirement vers Task

```mermaid
stateDiagram-v2
  [*] --> ReqPending: créer requirement
  ReqPending: Requirement.pending
  ReqEvaluating: Requirement.evaluating
  ReqPrdDesigning: Requirement.prd_designing
  ReqPrdReviewing: Requirement.prd_reviewing
  ReqQueued: Requirement.queued
  ReqWaitingHuman: waitingContext=prd_review_gate
  ReqCanceled: Requirement.canceled

  ReqPending --> ReqEvaluating: démarrer processor requirement
  ReqEvaluating --> ReqPrdDesigning: évaluation validée
  ReqEvaluating --> ReqCanceled: évaluation échouée
  ReqPrdDesigning --> ReqPrdReviewing: brouillon PRD généré
  ReqPrdReviewing --> ReqQueued: approuvé
  ReqPrdReviewing --> ReqPrdDesigning: review_fail (rework)
  ReqPrdReviewing --> ReqWaitingHuman: review_fail > 3
  ReqWaitingHuman --> ReqPrdDesigning: réponse humaine / revise

  ReqQueued --> TaskIdle: créer task depuis requirement
  TaskIdle: Task.idle
  TaskArchDesigning: Task.arch_designing
  TaskTechReviewing: Task.tech_reviewing
  TaskWaitingHuman: Task.waiting_human
  TaskCoding: Task.coding
  TaskQaReviewing: Task.qa_reviewing
  TaskDeploying: Task.deploying
  TaskDone: Task.done

  TaskIdle --> TaskArchDesigning: démarrer processor task
  TaskArchDesigning --> TaskTechReviewing
  TaskTechReviewing --> TaskCoding
  TaskTechReviewing --> TaskArchDesigning: review_fail (rework)
  TaskTechReviewing --> TaskWaitingHuman: review_fail > 3
  TaskCoding --> TaskQaReviewing
  TaskCoding --> TaskWaitingHuman: coding_gate
  TaskQaReviewing --> TaskDeploying
  TaskQaReviewing --> TaskCoding: qa_fail (rework)
  TaskQaReviewing --> TaskWaitingHuman: qa_fail > 3

  TaskWaitingHuman --> TaskArchDesigning: revise humain (gate archi)
  TaskWaitingHuman --> TaskCoding: revise humain (gate coding)
  TaskWaitingHuman --> TaskTechReviewing: force_pass humain (gate archi)
  TaskWaitingHuman --> TaskQaReviewing: force_pass humain (gate coding)
  TaskWaitingHuman --> TaskIdle: cancel humain
  TaskWaitingHuman --> TaskWaitingHuman: note humaine additionnelle

  TaskDeploying --> TaskDone
  TaskDone --> [*]
```

---

## Structure du projet

```text
src/
  main/                 Processus principal Electron, services, DB, agents
  preload/              Pont API sécurisé pour renderer
  renderer/             UI React, hooks, i18n, composants
  shared/               Types partagés et contrats IPC
tests/
  main/agents/          Tests de comportement des agents
resources/
  senior_v2.png         Ressource image du projet
```

---

## Scripts

```bash
npm run dev                  # Démarrer Electron + Vite en dev
npm run build                # Build des bundles main/preload/renderer
npm run preview              # Prévisualiser l’app buildée
npm run test:freeform-agent  # Exécuter les tests freeform agent
```

`npm install` déclenche aussi `electron-rebuild -f -w better-sqlite3` via `postinstall`.

---

## Données & artefacts

- Base SQLite : `<electron-userData>/app.db`
- Dossier d’artefacts de tâche : `<project-path>/.senior/tasks/<taskId>/`
- Artefacts d’étape courants :
  - `arch_design.md`
  - `tech_review.json`
  - `code.md`
  - `qa.json`
  - `deploy.md`

Senior stocke les statuts de run d’étape (`running/succeeded/failed/waiting_human`), les métadonnées de round et les traces agent pour réparer/reprendre proprement les exécutions interrompues.

---

## Feuille de route

- [x] Pipeline des étapes exigences (évaluation, design PRD, revue)
- [x] Orchestration des étapes tâches avec gates de revue
- [x] Auto-processors exigences et tâches
- [x] Persistance des traces d’étape et visualisation timeline
- [x] Lecture des artefacts depuis les dossiers de tâches du workspace
- [ ] Couverture de tests élargie au-delà de freeform agent
- [ ] Workflow de release packagée et installateurs
- [ ] Plus de langues UI au-delà de l’anglais et du chinois simplifié

---

## Contribuer

Les contributions sont bienvenues, notamment sur :

- Fiabilité des workflows et gestion des cas limites
- Tests supplémentaires et fixtures
- Améliorations UI/UX pour la traçabilité et le contrôle opérateur
- Internationalisation et qualité documentaire

Bootstrap de développement :

```bash
npm install
npm run dev
```

---

## Licence

Ce projet est distribué sous la Senior Community License. Consultez `LICENSE` pour les détails.
