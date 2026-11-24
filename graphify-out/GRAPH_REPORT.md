# Graph Report - Kizmo  (2026-10-16)

## Corpus Check
- Corpus is ~7,176 words - fits in a single context window. You may not need a graph.

## Summary
- 110 nodes · 163 edges · 10 communities (8 shown, 2 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Build & Dependencies
- TypeScript Config
- Quiz Domain Models
- App & Data Transform
- Sound Effects
- UI Styles
- Package Dependencies
- Local Storage
- Theme System

## God Nodes (most connected - your core abstractions)
1. `App()` - 22 edges
2. `compilerOptions` - 16 edges
3. `playDing()` - 7 edges
4. `playFanfare()` - 7 edges
5. `isSoundMuted()` - 6 edges
6. `playBuzzer()` - 6 edges
7. `getContext()` - 5 edges
8. `currentTheme()` - 5 edges
9. `scripts` - 4 edges
10. `wait()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `isSoundMuted()`  [EXTRACTED]
  src/App.tsx → src/sfx.ts
- `App()` --calls--> `playBuzzer()`  [EXTRACTED]
  src/App.tsx → src/sfx.ts
- `App()` --calls--> `playDing()`  [EXTRACTED]
  src/App.tsx → src/sfx.ts
- `App()` --calls--> `playFanfare()`  [EXTRACTED]
  src/App.tsx → src/sfx.ts
- `App()` --calls--> `readSnapshot()`  [EXTRACTED]
  src/App.tsx → src/storage.ts

## Import Cycles
- None detected.

## Communities (10 total, 2 thin omitted)

### Community 0 - "Build & Dependencies"
Cohesion: 0.08
Nodes (22): devDependencies, @types/react, @types/react-dom, name, private, scripts, build, dev (+14 more)

### Community 1 - "TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 2 - "Quiz Domain Models"
Cohesion: 0.15
Nodes (13): choicesFor(), confettiColors, Corner, corners, flashcardCheers, Mask, MaskEdit, Point (+5 more)

### Community 3 - "App & Data Transform"
Cohesion: 0.18
Nodes (11): answerLabel(), App(), ConfettiCelebration(), folderFromRow(), folderToRow(), parseFlashcardPaste(), passageSegments(), randomFlashcardCheer() (+3 more)

### Community 4 - "Sound Effects"
Cohesion: 0.40
Nodes (10): BUZZER_MS, DING_MS, FANFARE_MS, getContext(), isSoundMuted(), ping(), playBuzzer(), playDing() (+2 more)

### Community 6 - "Package Dependencies"
Cohesion: 0.25
Nodes (8): dependencies, lucide-react, react, react-dom, @supabase/supabase-js, typescript, vite, @vitejs/plugin-react

### Community 7 - "Local Storage"
Cohesion: 0.38
Nodes (6): AppSnapshot, LocalFolder, LocalSet, openDatabase(), readSnapshot(), writeSnapshot()

### Community 8 - "Theme System"
Cohesion: 0.47
Nodes (5): applyTheme(), currentTheme(), getStoredTheme(), systemTheme(), Theme

## Knowledge Gaps
- **3 isolated node(s):** `typescript`, `@types/react`, `@types/react-dom`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 61 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `UI Styles` to `Build & Dependencies`, `Quiz Domain Models`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `App()` (e.g. with `folderFromRow()` and `folderToRow()`) actually correct?**
  _`App()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `typescript`, `@types/react`, `@types/react-dom` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Build & Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._
- **Why does `lucide-react` connect `Build & Dependencies` to `Quiz Domain Models`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Should `TypeScript Config` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Why does `dependencies` connect `Package Dependencies` to `Build & Dependencies`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._