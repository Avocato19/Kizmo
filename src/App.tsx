import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import { Archive, ArrowLeft, ArrowRight, Check, ChevronDown, Download, Flower2, FolderOpen, ImagePlus, Layers3, ListChecks, Pencil, Plus, RotateCcw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { readSnapshot } from './storage';
import { supabase, supabaseConfigured } from './lib/supabase';

type Mask = { id: string; x: number; y: number; w: number; h: number; answer: string; question?: string; start?: number; end?: number };
type StudySet = { id: string; title: string; image: string; masks: Mask[]; createdAt: string; folderId: string; kind?: 'quiz' | 'flashcard' | 'fillblank'; content?: string };
type StudyFolder = { id: string; title: string; createdAt: string; archived?: boolean };
type PracticeTask = { set: StudySet; questionIndex: number | null };
type View = 'home' | 'folder' | 'create' | 'study';
type Point = { x: number; y: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type MaskEdit = { id: string; mode: 'move' | 'resize'; corner?: Corner; start: Point; original: Mask };
const corners: Corner[] = ['nw', 'ne', 'sw', 'se'];
const flashcardCheers = ['Goodjob babyyy🥰', 'Gooo my beloved wifey😘', 'I love you babyyy😍', "You're doing good, my love🥰"];
const randomFlashcardCheer = (previous?: string) => {
  const options = flashcardCheers.filter(message => message !== previous);
  return options[Math.floor(Math.random() * options.length)];
};
const answerLabel = (index: number) => {
  let value = index + 1;
  let label = '';
  while (value > 0) { value -= 1; label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26); }
  return label;
};
const shuffle = <T,>(items: T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const choicesFor = (item: StudySet) => Object.fromEntries(item.masks.map(mask => {
  const correct = mask.answer.trim();
  const uniqueAnswers = [...new Map(item.masks.map(card => [card.answer.trim().toLocaleLowerCase(), card.answer.trim()])).values()];
  const distractors = shuffle(uniqueAnswers.filter(value => value.toLocaleLowerCase() !== correct.toLocaleLowerCase())).slice(0, Math.min(3, uniqueAnswers.length - 1));
  return [mask.id, shuffle([correct, ...distractors])];
}));

const folderFromRow = (row: { id: string; title: string; created_at: string; archived: boolean }): StudyFolder => ({ id: row.id, title: row.title, createdAt: row.created_at, archived: row.archived });
const setFromRow = (row: { id: string; title: string; image: string; masks: Mask[]; created_at: string; folder_id: string; kind?: 'quiz' | 'flashcard' | 'fillblank'; content?: string }): StudySet => ({ id: row.id, title: row.title, image: row.image, masks: row.masks, createdAt: row.created_at, folderId: row.folder_id, kind: row.kind ?? 'quiz', content: row.content ?? '' });
const folderToRow = (folder: StudyFolder) => ({ id: folder.id, title: folder.title, created_at: folder.createdAt, archived: Boolean(folder.archived) });
const setToRow = (item: StudySet) => ({ id: item.id, title: item.title, image: item.image, masks: item.masks, created_at: item.createdAt, folder_id: item.folderId, kind: item.kind ?? 'quiz', content: item.content ?? '' });
const parseFlashcardPaste = (source: string) => {
  const fronts: string[] = [];
  const backLines: string[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\*\*/g, '').trim();
    if (!line) continue;
    if (/[•●▪·]/.test(line) && !/^[•●▪·]\s*[^•●▪·]*$/.test(line)) {
      const parts = line.split(/[•●▪·]/).map(part => part.trim()).filter(Boolean);
      const beginsWithBullet = /^[•●▪·]/.test(line);
      if (!beginsWithBullet && parts[0]) backLines.push(parts.shift()!);
      fronts.push(...parts.map(part => `• ${part}`));
    } else if (/^[•●▪·]\s*/.test(line) || /^[-*]\s+/.test(line)) {
      fronts.push(line);
    } else if (/[•●▪·]/.test(line)) {
      const sentenceTail = line.match(/^(.*[•●▪·]\s*)([^•●▪·]+[.!?])$/);
      if (sentenceTail && sentenceTail[2].trim().split(/\s+/).length >= 4) {
        fronts.push(sentenceTail[1].trim()); backLines.push(sentenceTail[2].trim());
      } else fronts.push(line);
    } else backLines.push(line);
  }
  return { front: fronts.join('\n').trim(), back: backLines.join('\n').trim() };
};
const passageSegments = (text: string, marks: Mask[]) => {
  const ordered = marks.filter(mark => mark.start !== undefined && mark.end !== undefined).sort((a, b) => a.start! - b.start!);
  const parts: { text: string; mark?: Mask; index?: number }[] = [];
  let cursor = 0;
  ordered.forEach((mark, index) => {
    if (mark.start! < cursor || mark.end! > text.length) return;
    if (mark.start! > cursor) parts.push({ text: text.slice(cursor, mark.start!) });
    parts.push({ text: text.slice(mark.start!, mark.end!), mark, index: index + 1 });
    cursor = mark.end!;
  });
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
};

const confettiColors = ['#e9a0ad', '#a8c7a7', '#c5b4df', '#f3cf8c', '#9bcbd1', '#f3b7a4'];
function ConfettiCelebration() {
  return <div className="confetti-layer" aria-hidden="true">{Array.from({ length: 42 }, (_, index) => <i
    className={`confetti-piece confetti-piece-${index % 3}`}
    key={index}
    style={{
      left: `${(index * 47 + 11) % 100}%`,
      animationDelay: `${(index % 14) * 0.07}s`,
      animationDuration: `${2.5 + (index % 4) * 0.35}s`,
      backgroundColor: confettiColors[index % confettiColors.length],
      '--drift': `${((index * 31) % 180) - 90}px`,
    } as CSSProperties}
  />)}</div>;
}

function App() {
  const [sets, setSets] = useState<StudySet[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [archiveMode, setArchiveMode] = useState(false);
  const [folderModal, setFolderModal] = useState<'create' | 'rename' | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [view, setView] = useState<View>('home');
  const [active, setActive] = useState<StudySet | null>(null);
  const [practiceTasks, setPracticeTasks] = useState<PracticeTask[]>([]);
  const [practiceTaskIndex, setPracticeTaskIndex] = useState(0);
  const [mixedPractice, setMixedPractice] = useState(false);
  const [folderPracticeComplete, setFolderPracticeComplete] = useState(false);
  const [singleQuestion, setSingleQuestion] = useState(false);
  const [image, setImage] = useState('');
  const [imageRatio, setImageRatio] = useState(4 / 3);
  const [quizType, setQuizType] = useState<'picture' | 'text' | 'fillblank'>('picture');
  const [createKind, setCreateKind] = useState<'quiz' | 'flashcard'>('quiz');
  const [flashcardFrontDraft, setFlashcardFrontDraft] = useState('');
  const [flashcardBackDraft, setFlashcardBackDraft] = useState('');
  const [flashcardRevealed, setFlashcardRevealed] = useState(false);
  const [flashcardCheer, setFlashcardCheer] = useState(() => randomFlashcardCheer());
  const [blankTextDraft, setBlankTextDraft] = useState('');
  const [confirmedBlankText, setConfirmedBlankText] = useState('');
  const [blankTextConfirmed, setBlankTextConfirmed] = useState(false);
  const [selectedTextRange, setSelectedTextRange] = useState<{ start: number; end: number } | null>(null);
  const [masks, setMasks] = useState<Mask[]>([]);
  const [drawing, setDrawing] = useState<{ start: Point; end: Point } | null>(null);
  const [maskEdit, setMaskEdit] = useState<MaskEdit | null>(null);
  const [selectedMask, setSelectedMask] = useState<string | null>(null);
  const [pictureAnswers, setPictureAnswers] = useState<Record<string, string>>({});
  const [pictureSubmitted, setPictureSubmitted] = useState(false);
  const [textChoices, setTextChoices] = useState<Record<string, string[]>>({});
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [choiceChecked, setChoiceChecked] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizComplete, setQuizComplete] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [questionDraft, setQuestionDraft] = useState('');
  const [answerDraft, setAnswerDraft] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfQuestionCount, setPdfQuestionCount] = useState(10);
  const [generatingPdfQuiz, setGeneratingPdfQuiz] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const backupRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const blankPassageRef = useRef<HTMLDivElement>(null);
  const activeMask = active?.masks[cardIndex % (active.masks.length || 1)];
  const activeFolder = folders.find(folder => folder.id === folderId) ?? null;
  const folderSets = sets.filter(set => set.folderId === folderId);
  const flashcardCombinedDraft = Boolean(flashcardFrontDraft.trim()) !== Boolean(flashcardBackDraft.trim());
  const flashcardPreview = flashcardCombinedDraft
    ? parseFlashcardPaste(flashcardFrontDraft || flashcardBackDraft)
    : { front: flashcardFrontDraft.trim(), back: flashcardBackDraft.trim() };
  const blankEditorSegments = passageSegments(confirmedBlankText, masks);
  const activeBlankMarks = active?.masks.filter(mark => mark.start !== undefined && mark.end !== undefined).sort((a, b) => a.start! - b.start!) ?? [];
  const blankPracticeSegments = passageSegments(active?.content ?? '', active?.masks ?? []);
  const lastPracticeTask = !mixedPractice || practiceTaskIndex === practiceTasks.length - 1;
  const shouldCelebrate = folderPracticeComplete || (active?.kind === 'flashcard'
    ? quizComplete && lastPracticeTask
    : lastPracticeTask && (quizComplete || pictureSubmitted || (singleQuestion && choiceChecked)));

  const loadSets = async () => {
    try {
      if (!supabaseConfigured || !supabase) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect Supabase.');
      const [folderResult, setResult] = await Promise.all([
        supabase.from('folders').select('id,title,created_at,archived').order('created_at', { ascending: false }),
        supabase.from('study_sets').select('id,title,image,masks,created_at,folder_id,kind,content').order('created_at', { ascending: false }),
      ]);
      if (folderResult.error) throw folderResult.error;
      if (setResult.error) throw setResult.error;
      let loadedFolders = (folderResult.data ?? []).map(folderFromRow);
      let loadedSets = (setResult.data ?? []).map(setFromRow);
      if (!loadedFolders.length && !loadedSets.length) {
        const local = await readSnapshot();
        if (local.folders.length || local.sets.length) {
          const migratedFolders = local.folders as StudyFolder[];
          const migratedSets = local.sets as StudySet[];
          if (migratedFolders.length) { const result = await supabase.from('folders').upsert(migratedFolders.map(folderToRow)); if (result.error) throw result.error; }
          if (migratedSets.length) { const result = await supabase.from('study_sets').upsert(migratedSets.map(setToRow)); if (result.error) throw result.error; }
          loadedFolders = migratedFolders; loadedSets = migratedSets;
        }
      }
      setSets(loadedSets); setFolders(loadedFolders);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load data from Supabase.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadSets(); }, []);
  const exportBackup = async () => {
    if (!supabase) { setError('Set your Supabase URL and anon key first.'); return; }
    const [folderResult, setResult] = await Promise.all([
      supabase.from('folders').select('id,title,created_at,archived'),
      supabase.from('study_sets').select('id,title,image,masks,created_at,folder_id,kind,content'),
    ]);
    if (folderResult.error || setResult.error) { setError(folderResult.error?.message ?? setResult.error?.message ?? 'Could not export data.'); return; }
    const snapshot = { folders: (folderResult.data ?? []).map(folderFromRow), sets: (setResult.data ?? []).map(setFromRow) };
    const file = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a'); link.href = url; link.download = 'kizmo-backup.json'; link.click(); URL.revokeObjectURL(url);
  };
  const importBackup = async (file?: File) => {
    if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text()) as { folders: StudyFolder[]; sets: StudySet[] };
      if (!Array.isArray(snapshot.folders) || !Array.isArray(snapshot.sets)) throw new Error('Choose a valid Kizmo backup.');
      if (!supabase) throw new Error('Set your Supabase URL and anon key first.');
      if (!window.confirm('Import these folders and quizzes into Supabase? Existing items with matching IDs will be updated.')) return;
      const foldersToImport = snapshot.folders.map(folder => ({ ...folder, archived: Boolean(folder.archived) }));
      if (foldersToImport.length) { const result = await supabase.from('folders').upsert(foldersToImport.map(folderToRow)); if (result.error) throw result.error; }
      if (snapshot.sets.length) { const result = await supabase.from('study_sets').upsert(snapshot.sets.map(setToRow)); if (result.error) throw result.error; }
      await loadSets(); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import this backup.'); }
    finally { if (backupRef.current) backupRef.current.value = ''; }
  };

  const startCreate = (kind: 'quiz' | 'flashcard' = 'quiz') => {
    if (!folderId) { setError('Open a folder first.'); return; }
    setImage(''); setMasks([]); setSelectedMask(null);
    setQuestionDraft(''); setAnswerDraft(''); setFlashcardFrontDraft(''); setFlashcardBackDraft(''); setBlankTextDraft(''); setConfirmedBlankText(''); setBlankTextConfirmed(false); setSelectedTextRange(null); setPdfFile(null); setPdfQuestionCount(10); setCreateKind(kind); setQuizType('picture'); setView('create'); setError('');
  };
  const changeQuizType = (type: 'picture' | 'text' | 'fillblank') => {
    setQuizType(type); setImage(''); setMasks([]); setSelectedMask(null); setError('');
  };
  const handleImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    if (file.size > 12 * 1024 * 1024) { setError('Choose an image smaller than 12 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result)); setMasks([]); setSelectedMask(null); setError(''); };
    reader.onerror = () => setError('Could not read that image.');
    reader.readAsDataURL(file);
  };
  const stagePoint = (clientX: number, clientY: number): Point => {
    const box = stageRef.current!.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)), y: Math.min(100, Math.max(0, ((clientY - box.top) / box.height) * 100)) };
  };
  const beginDraw = (event: PointerEvent<HTMLDivElement>) => {
    if (!image || (event.target as HTMLElement).closest('[data-mask]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = stagePoint(event.clientX, event.clientY); setDrawing({ start, end: start }); setSelectedMask(null);
  };
  const moveDraw = (event: PointerEvent<HTMLDivElement>) => {
    const point = stagePoint(event.clientX, event.clientY);
    if (maskEdit) {
      const dx = point.x - maskEdit.start.x; const dy = point.y - maskEdit.start.y; const original = maskEdit.original;
      setMasks(previous => previous.map(mask => {
        if (mask.id !== maskEdit.id) return mask;
        if (maskEdit.mode === 'move') return { ...mask, x: Math.min(100 - original.w, Math.max(0, original.x + dx)), y: Math.min(100 - original.h, Math.max(0, original.y + dy)) };
        const right = original.x + original.w; const bottom = original.y + original.h; const corner = maskEdit.corner;
        let left = original.x; let top = original.y; let nextRight = right; let nextBottom = bottom;
        if (corner?.includes('w')) left = Math.min(right - 2, Math.max(0, original.x + dx));
        if (corner?.includes('e')) nextRight = Math.max(original.x + 2, Math.min(100, right + dx));
        if (corner?.includes('n')) top = Math.min(bottom - 2, Math.max(0, original.y + dy));
        if (corner?.includes('s')) nextBottom = Math.max(original.y + 2, Math.min(100, bottom + dy));
        return { ...mask, x: left, y: top, w: nextRight - left, h: nextBottom - top };
      }));
      return;
    }
    if (drawing) setDrawing({ ...drawing, end: point });
  };
  const finishDraw = (event: PointerEvent<HTMLDivElement>) => {
    if (maskEdit) { setMaskEdit(null); return; }
    if (!drawing) return;
    const end = stagePoint(event.clientX, event.clientY); const x = Math.min(drawing.start.x, end.x); const y = Math.min(drawing.start.y, end.y);
    const w = Math.abs(end.x - drawing.start.x); const h = Math.abs(end.y - drawing.start.y);
    if (w > 1.5 && h > 1.5) {
      const mask: Mask = { id: crypto.randomUUID(), x, y, w, h, answer: '' };
      setMasks(previous => [...previous, mask]); setSelectedMask(mask.id);
    }
    setDrawing(null);
  };
  const beginMaskMove = (event: PointerEvent<HTMLDivElement>, mask: Mask) => {
    if ((event.target as HTMLElement).closest('.resize-handle')) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedMask(mask.id);
    setMaskEdit({ id: mask.id, mode: 'move', start: stagePoint(event.clientX, event.clientY), original: mask });
  };
  const beginMaskResize = (event: PointerEvent<HTMLButtonElement>, mask: Mask, corner: Corner) => {
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedMask(mask.id);
    setMaskEdit({ id: mask.id, mode: 'resize', corner, start: stagePoint(event.clientX, event.clientY), original: mask });
  };
  const addTextCard = () => {
    if (!questionDraft.trim() || !answerDraft.trim()) { setError('Add both a question and an answer.'); return; }
    const card: Mask = { id: crypto.randomUUID(), x: 0, y: 0, w: 0, h: 0, question: questionDraft.trim(), answer: answerDraft.trim() };
    setMasks(previous => [...previous, card]); setQuestionDraft(''); setAnswerDraft(''); setError('');
  };
  const generatePdfQuiz = async () => {
    if (!pdfFile) { setError('Choose a PDF first.'); return; }
    if (pdfFile.size > 8 * 1024 * 1024) { setError('Choose a PDF smaller than 8 MB.'); return; }
    if (!supabase) { setError('Connect Supabase before generating a quiz.'); return; }
    setGeneratingPdfQuiz(true); setError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('generate-pdf-quiz', {
        body: await pdfFile.arrayBuffer(),
        headers: { 'Content-Type': 'application/pdf', 'x-question-count': String(pdfQuestionCount) },
        timeout: 120_000,
      });
      if (invokeError) {
        const context = (invokeError as Error & { context?: unknown }).context;
        let message = invokeError.message;
        if (context instanceof Response) {
          try { const body = await context.json() as { error?: string }; message = body.error || message; } catch { /* use the SDK message */ }
        }
        throw new Error(message);
      }
      const questions = (data as { questions?: { question: string; answer: string }[] })?.questions;
      if (!Array.isArray(questions) || questions.length === 0) throw new Error('No questions were generated. Try a different PDF.');
      setMasks(questions.map(item => ({ id: crypto.randomUUID(), x: 0, y: 0, w: 0, h: 0, question: item.question, answer: item.answer })));
      setQuizType('text'); setPdfFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not generate questions from that PDF.');
    } finally { setGeneratingPdfQuiz(false); }
  };
  const confirmBlankText = () => {
    if (!blankTextDraft.trim()) { setError('Paste a passage first.'); return; }
    setConfirmedBlankText(blankTextDraft); setMasks([]); setSelectedTextRange(null); setBlankTextConfirmed(true); setError('');
  };
  const readBlankSelection = () => {
    const selection = window.getSelection(); const root = blankPassageRef.current;
    if (!selection || selection.isCollapsed || !root) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length; const selected = range.toString();
    const leading = selected.search(/\S/); const trailing = selected.search(/\s*$/);
    if (leading < 0 || trailing <= leading) return null;
    return { start: start + leading, end: start + trailing };
  };
  const captureBlankSelection = () => { const range = readBlankSelection(); if (range) { setSelectedTextRange(range); setError(''); } };
  const addFillBlank = () => {
    const range = selectedTextRange ?? readBlankSelection();
    if (!range) { setError('Select one or more words in the passage first.'); return; }
    if (masks.some(mask => range.start < (mask.end ?? 0) && range.end > (mask.start ?? 0))) { setError('That selection overlaps an existing blank.'); return; }
    const answer = confirmedBlankText.slice(range.start, range.end);
    if (!answer.trim()) return;
    const mark: Mask = { id: crypto.randomUUID(), x: 0, y: 0, w: 0, h: 0, answer, start: range.start, end: range.end };
    setMasks(previous => [...previous, mark].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)));
    setSelectedTextRange(null); window.getSelection()?.removeAllRanges(); setError('');
  };
  const saveSet = async (event: FormEvent) => {
    event.preventDefault();
    const fillBlankMode = createKind === 'quiz' && quizType === 'fillblank';
    let flashcardFront = flashcardFrontDraft.trim(); let flashcardBack = flashcardBackDraft.trim();
    if (createKind === 'flashcard' && (Boolean(flashcardFront) !== Boolean(flashcardBack))) {
      const parsed = parseFlashcardPaste(flashcardFront || flashcardBack);
      if (parsed.front && parsed.back) { flashcardFront = parsed.front; flashcardBack = parsed.back; }
    }
    const cards = createKind === 'flashcard'
      ? flashcardFront && flashcardBack ? [{ id: crypto.randomUUID(), x: 0, y: 0, w: 0, h: 0, question: flashcardFront, answer: flashcardBack }] : []
      : masks;
    if (createKind === 'flashcard' && !cards.length) { setError('Add a front and back, or paste bullet forms with a sentence into one field.'); return; }
    if (fillBlankMode && (!blankTextConfirmed || !confirmedBlankText.trim() || !masks.length)) { setError('Confirm your passage and add at least one blank.'); return; }
    if (createKind === 'quiz' && !fillBlankMode && (cards.length === 0 || cards.some(mask => !mask.answer.trim() || (quizType === 'text' && !mask.question?.trim())))) {
    setError(cards.length === 0 ? quizType === 'picture' ? 'Draw at least one cover on the image.' : 'Add at least one question.' : 'Add an answer for each item.'); return;
    }
    if (createKind === 'quiz' && quizType === 'picture' && !image) { setError('Add an image first.'); return; }
    if (!folderId) { setError('Open a folder first.'); return; }
    setSaving(true); setError('');
    const item: StudySet = { id: crypto.randomUUID(), title: '', image: createKind === 'quiz' && quizType === 'picture' ? image : '', masks: cards, createdAt: new Date().toISOString(), folderId, kind: createKind === 'flashcard' ? 'flashcard' : fillBlankMode ? 'fillblank' : 'quiz', content: fillBlankMode ? confirmedBlankText : '' };
    try {
      if (!supabase) throw new Error('Set your Supabase URL and anon key first.');
      const result = await supabase.from('study_sets').insert(setToRow(item)); if (result.error) throw result.error;
      const nextSets = [item, ...sets];
      setSets(nextSets); setImage(''); setMasks([]); setSelectedMask(null); setFlashcardFrontDraft(''); setFlashcardBackDraft(''); setBlankTextDraft(''); setConfirmedBlankText(''); setBlankTextConfirmed(false); setPdfFile(null); setView('folder');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this quiz.'); }
    finally { setSaving(false); }
  };
  const deleteSet = async (id: string) => {
    try {
      if (!supabase) throw new Error('Set your Supabase URL and anon key first.');
      const result = await supabase.from('study_sets').delete().eq('id', id); if (result.error) throw result.error;
      setSets(sets.filter(item => item.id !== id));
    } catch { setError('Could not delete this quiz.'); }
  };
  const loadPracticeTask = (task: PracticeTask) => {
    setActive(task.set); setCardIndex(task.questionIndex ?? 0); setPictureAnswers({}); setPictureSubmitted(false); setQuizScore(0); setQuizComplete(false);
    setFlashcardRevealed(false);
    if (task.set.kind === 'flashcard') setFlashcardCheer(previous => randomFlashcardCheer(previous));
    setTextChoices(task.set.image ? {} : choicesFor(task.set)); setSelectedChoice(null); setChoiceChecked(false);
    setSingleQuestion(task.questionIndex !== null); setView('study');
  };
  const startStudy = (item: StudySet, questionIndex: number | null = null) => {
    setFolderPracticeComplete(false);
    setMixedPractice(false); setPracticeTasks([]); setPracticeTaskIndex(0);
    loadPracticeTask({ set: item, questionIndex });
  };
  const startFolderPractice = () => {
    const tasks: PracticeTask[] = folderSets.flatMap((set): PracticeTask[] => set.image || set.kind === 'flashcard' || set.kind === 'fillblank' ? [{ set, questionIndex: null }] : set.masks.map((_, questionIndex) => ({ set, questionIndex })));
    if (!tasks.length) return;
    setFolderPracticeComplete(false);
    setPracticeTasks(tasks); setPracticeTaskIndex(0); setMixedPractice(true); loadPracticeTask(tasks[0]);
  };
  const nextPracticeTask = () => {
    const nextIndex = practiceTaskIndex + 1;
    if (nextIndex >= practiceTasks.length) {
      setMixedPractice(false); setFolderPracticeComplete(true); setView('study'); return;
    }
    setPracticeTaskIndex(nextIndex); loadPracticeTask(practiceTasks[nextIndex]);
  };
  const nextMask = () => {
    if (active?.kind === 'flashcard') {
      if (cardIndex >= active.masks.length - 1) setQuizComplete(true);
      else { setCardIndex(index => index + 1); setFlashcardRevealed(false); setFlashcardCheer(previous => randomFlashcardCheer(previous)); }
      return;
    }
    if (singleQuestion) {
      if (mixedPractice) nextPracticeTask();
      else setView('folder');
      return;
    }
    if (!active?.masks.length) return;
    if (cardIndex >= active.masks.length - 1) { setQuizComplete(true); return; }
    const nextIndex = (cardIndex + 1) % active.masks.length;
    setCardIndex(nextIndex); setSelectedChoice(null); setChoiceChecked(false);
    if (nextIndex === 0 && !active.image) setTextChoices(choicesFor(active));
  };
  const previousFlashcard = () => {
    if (cardIndex === 0) return;
    setCardIndex(index => index - 1); setFlashcardRevealed(false); setQuizComplete(false); setFlashcardCheer(previous => randomFlashcardCheer(previous));
  };
  const checkTextAnswer = () => {
    if (!activeMask || !selectedChoice?.trim()) return;
    if (selectedChoice?.trim().toLocaleLowerCase() === activeMask.answer.trim().toLocaleLowerCase()) setQuizScore(score => score + 1);
    setChoiceChecked(true);
  };

  const createFolder = async (event: FormEvent) => {
    event.preventDefault();
    const title = folderName.trim();
    if (!title) return;
    const folder: StudyFolder = { id: crypto.randomUUID(), title, createdAt: new Date().toISOString() };
    try {
      if (!supabase) throw new Error('Set your Supabase URL and anon key first.');
      const result = await supabase.from('folders').insert(folderToRow(folder)); if (result.error) throw result.error;
      const nextFolders = [folder, ...folders];
      setFolders(nextFolders); setFolderId(folder.id); setView('folder'); setFolderName(''); setFolderModal(null); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the folder.'); }
  };
  const renameFolder = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeFolder || !folderName.trim()) return;
    try {
      if (!supabase) throw new Error('Set your Supabase URL and anon key first.');
      const result = await supabase.from('folders').update({ title: folderName.trim() }).eq('id', activeFolder.id); if (result.error) throw result.error;
      const nextFolders = folders.map(folder => folder.id === activeFolder.id ? { ...folder, title: folderName.trim() } : folder);
      setFolders(nextFolders); setFolderName(''); setFolderModal(null); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rename the folder.'); }
  };
  const submitPictureAnswers = () => {
    if (!active?.masks.length || active.masks.some(mask => !pictureAnswers[mask.id]?.trim())) return;
    setPictureSubmitted(true);
  };
  const setFolderArchived = async (folder: StudyFolder, archived: boolean) => {
    try {
      if (!supabase) throw new Error('Set your Supabase URL and anon key first.');
      const result = await supabase.from('folders').update({ archived }).eq('id', folder.id); if (result.error) throw result.error;
      const nextFolders = folders.map(item => item.id === folder.id ? { ...item, archived } : item);
      setFolders(nextFolders);
      if (archived) { setFolderId(null); setView('home'); }
    } catch { setError('Could not update this folder.'); }
  };
  const deleteFolderForever = async (folder: StudyFolder) => {
    if (!window.confirm(`Delete “${folder.title}” and all its quizzes forever?`)) return;
    try {
      if (!supabase) throw new Error('Set your Supabase URL and anon key first.');
      const result = await supabase.from('folders').delete().eq('id', folder.id); if (result.error) throw result.error;
      setFolders(folders.filter(item => item.id !== folder.id)); setSets(sets.filter(item => item.folderId !== folder.id));
    } catch { setError('Could not permanently delete this folder.'); }
  };
  const retryPicture = () => { setPictureAnswers({}); setPictureSubmitted(false); };

  return <main className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => { setFolderId(null); setView('home'); }}><span className="brand-mark"><Layers3 size={19}/></span><span>kizmo<span className="brand-dot">.</span></span></button>{view === 'create' ? <button className="round-button" aria-label="Close editor" onClick={() => setView('folder')}><X size={19}/></button> : <span className="top-flower">✿</span>}</header>
    {error && <div className="notice" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><X size={15}/></button></div>}

    {view === 'home' && <section className="home-page">
      <div className="welcome"><span className="hello-tag"><Sparkles size={14}/> your study nook</span><h1>STUDY WELLS MAHH BABYY🥰😍</h1><p>Keep picture and text quizzes together in folders.</p><button className="primary-button" onClick={() => { setFolderName(''); setFolderModal('create'); }}><Plus size={17}/> New folder</button></div>
      <div className="sets-heading"><h2>{archiveMode ? 'Archive' : 'Your folders'}</h2><div className="home-data-actions"><button className="soft-button archive-toggle" onClick={() => setArchiveMode(value => !value)}><Archive size={14}/>{archiveMode ? 'Folders' : 'Archive'}{folders.some(folder => folder.archived) && !archiveMode ? ` · ${folders.filter(folder => folder.archived).length}` : ''}</button><button className="soft-button data-action" onClick={() => void exportBackup()}><Download size={14}/> Export</button><button className="soft-button data-action" onClick={() => backupRef.current?.click()}><Upload size={14}/> Import</button><input ref={backupRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={event => void importBackup(event.target.files?.[0])}/></div></div>
      {loading ? <div className="empty-card">Loading…</div> : folders.filter(folder => Boolean(folder.archived) === archiveMode).length ? <div className="folder-grid">{folders.filter(folder => Boolean(folder.archived) === archiveMode).map(folder => {
        const count = sets.filter(set => set.folderId === folder.id).length;
        return <div className="folder-item" key={folder.id}><button className="folder-card" disabled={archiveMode} onClick={() => { setFolderId(folder.id); setView('folder'); }}>
          <span className="folder-art"><FolderOpen size={28}/><small>{count} {count === 1 ? 'quiz' : 'quizzes'}</small></span>
          <strong>{folder.title}</strong><span className="folder-caption">{count} {count === 1 ? 'quiz' : 'quizzes'}</span>
        </button><div className="folder-item-actions">{archiveMode ? <><button className="soft-button" onClick={() => void setFolderArchived(folder, false)}><RotateCcw size={14}/> Restore</button><button className="icon-action delete-action" aria-label={`Delete ${folder.title} forever`} title="Delete forever" onClick={() => void deleteFolderForever(folder)}><Trash2 size={16}/></button></> : <button className="icon-action" aria-label={`Archive ${folder.title}`} title="Archive folder" onClick={() => void setFolderArchived(folder, true)}><Archive size={16}/></button>}</div></div>;
      })}</div> : <div className="empty-card"><div className="empty-flower">?</div><h3>{archiveMode ? 'Archive is empty' : 'Create your first folder'}</h3>{!archiveMode && <><p>Put picture and text quizzes together in one place.</p><button className="soft-button" onClick={() => { setFolderName(''); setFolderModal('create'); }}><Plus size={16}/> New folder</button></>}</div>}
    </section>}

    {view === 'folder' && activeFolder && <section className="home-page folder-page">
      <button className="back-link" onClick={() => { setFolderId(null); setView('home'); }}><ArrowLeft size={16}/> All folders</button>
      <div className="folder-heading"><div><span className="hello-tag"><FolderOpen size={14}/> FOLDER</span><h1>{activeFolder.title}</h1><p>{folderSets.length} {folderSets.length === 1 ? 'quiz' : 'quizzes'}</p></div><div className="folder-heading-actions"><button className="soft-button" onClick={() => { setFolderName(activeFolder.title); setFolderModal('rename'); }}><Pencil size={15}/> Rename</button><button className="soft-button" onClick={() => void setFolderArchived(activeFolder, true)}><Archive size={14}/> Archive</button><button className="soft-button" disabled={!folderSets.length} onClick={startFolderPractice}>Practice all</button><div className="new-menu-wrap"><button className="primary-button" onClick={() => setShowNewMenu(value => !value)}><Plus size={16}/> New <ChevronDown size={14}/></button>{showNewMenu && <div className="new-menu"><button onClick={() => { startCreate('quiz'); setShowNewMenu(false); }}>Quiz</button><button onClick={() => { startCreate('flashcard'); setShowNewMenu(false); }}>Flashcard</button></div>}</div></div></div>
      {folderSets.some(item => item.image && item.kind !== 'flashcard') && <div className="folder-content-section"><h2 className="folder-type-heading">Image quizzes</h2><div className="set-grid">{folderSets.filter(item => item.image && item.kind !== 'flashcard').map(item => <article className="set-card" key={item.id}><button className="set-preview" onClick={() => startStudy(item)}><img src={item.image} alt=""/><span className="mask-count">{item.masks.length} {item.masks.length === 1 ? 'cover' : 'covers'}</span></button><div className="set-card-row set-card-actions"><button className="study-link" onClick={() => startStudy(item)}>Practice quiz <ArrowRight size={15}/></button><button className="icon-action delete-action" onClick={() => void deleteSet(item.id)} aria-label="Delete quiz"><Trash2 size={16}/></button></div></article>)}</div></div>}
      {folderSets.some(item => item.kind === 'flashcard') && <div className="folder-content-section"><div className="set-grid">{folderSets.filter(item => item.kind === 'flashcard').map(item => <article className="flashcard-deck" key={item.id}><button className="flashcard-deck-open" onClick={() => startStudy(item)}><Layers3 size={20}/><strong>Flashcards</strong><span>{item.masks.length} cards</span></button><button className="icon-action delete-action" onClick={() => void deleteSet(item.id)} aria-label="Delete flashcards"><Trash2 size={16}/></button></article>)}</div></div>}
      {folderSets.some(item => item.kind === 'fillblank') && <div className="folder-content-section"><h2 className="folder-type-heading">Fill in the blank</h2><div className="set-grid">{folderSets.filter(item => item.kind === 'fillblank').map(item => <article className="flashcard-deck" key={item.id}><button className="flashcard-deck-open" onClick={() => startStudy(item)}><ListChecks size={20}/><strong>Passage</strong><span>{item.masks.length} blanks</span></button><button className="icon-action delete-action" onClick={() => void deleteSet(item.id)} aria-label="Delete fill-in-the-blank quiz"><Trash2 size={16}/></button></article>)}</div></div>}
      {folderSets.some(item => !item.image && item.kind !== 'flashcard' && item.kind !== 'fillblank') && <div className="folder-content-section"><h2 className="folder-type-heading">Text quizzes</h2><div className="question-list">{folderSets.filter(item => !item.image && item.kind !== 'flashcard' && item.kind !== 'fillblank').flatMap(item => item.masks.map((question, index) => <button className="folder-question" key={`${item.id}-${question.id}`} onClick={() => startStudy(item, index)}><span className="folder-question-text">{question.question}</span><span className="folder-question-action">Answer <ArrowRight size={14}/></span></button>))}</div></div>}
      {!folderSets.length && <div className="empty-card folder-empty"><div className="empty-flower">?</div><h3>This folder is empty</h3><p>Add picture quizzes and text questions here.</p><button className="primary-button" onClick={() => startCreate('quiz')}><Plus size={16}/> Create a quiz</button></div>}
    </section>}

    {view === 'create' && <section className="editor-page"><div className="editor-heading"><div><span className="hello-tag">NEW</span><h1>{createKind === 'flashcard' ? 'Make flashcards' : 'Make a quiz'}</h1></div><button className="primary-button save-button" onClick={event => void saveSet(event as unknown as FormEvent)} disabled={saving}>{saving ? 'Adding…' : <><Plus size={16}/> Add</>}</button></div>{createKind === 'quiz' && <div className="type-switch"><button className={quizType === 'picture' ? 'type-option active' : 'type-option'} onClick={() => changeQuizType('picture')}><ImagePlus size={15}/>Picture</button><button className={quizType === 'text' ? 'type-option active' : 'type-option'} onClick={() => changeQuizType('text')}><Layers3 size={15}/>Text</button><button className={quizType === 'fillblank' ? 'type-option active' : 'type-option'} onClick={() => changeQuizType('fillblank')}><ListChecks size={15}/>Fill in the blank</button></div>}
      {createKind === 'quiz' && quizType === 'fillblank' ? <div className="fillblank-builder">{!blankTextConfirmed ? <div className="fillblank-paste"><label htmlFor="fillblank-text">Passage</label><textarea id="fillblank-text" value={blankTextDraft} onChange={event => setBlankTextDraft(event.target.value)} placeholder="Paste a passage here" rows={10}/><button className="primary-button" onClick={confirmBlankText}>Start blanking <ArrowRight size={16}/></button></div> : <><div className="fillblank-tools"><p>Highlight one or more words, then add them as a blank.</p><div><button className="soft-button" onClick={() => { setBlankTextDraft(confirmedBlankText); setBlankTextConfirmed(false); setSelectedTextRange(null); }}>Edit text</button><button className="primary-button" disabled={!selectedTextRange} onClick={addFillBlank}><Plus size={15}/> Add blank</button></div></div><div ref={blankPassageRef} className="fillblank-editor-passage" onMouseUp={captureBlankSelection} onTouchEnd={() => window.setTimeout(captureBlankSelection, 0)}>{blankEditorSegments.map((part, index) => part.mark ? <mark className="fillblank-mark-editor" data-number={part.index} key={part.mark.id}>{part.text}</mark> : <span key={`passage-${index}`}>{part.text}</span>)}</div>{masks.length > 0 && <div className="fillblank-mark-list">{masks.map((mark, index) => <div className="answer-row" key={mark.id}><span className="answer-number">{index + 1}</span><span className="fillblank-answer-preview">{mark.answer}</span><button className="icon-action" aria-label={`Remove blank ${index + 1}`} onClick={() => setMasks(previous => previous.filter(item => item.id !== mark.id))}><X size={15}/></button></div>)}</div>}</>}</div> : createKind === 'flashcard' ? <div className="flashcard-builder"><label htmlFor="flashcard-front">Front</label><textarea id="flashcard-front" value={flashcardFrontDraft} onChange={event => setFlashcardFrontDraft(event.target.value)} placeholder="Write a front or paste your notes here" rows={4}/><label htmlFor="flashcard-back">Back</label><textarea id="flashcard-back" value={flashcardBackDraft} onChange={event => setFlashcardBackDraft(event.target.value)} placeholder="Write the answer or sentence here" rows={4}/><p>Fill both fields, or paste bullet forms and a sentence into just one. Bullets stay together on the front.</p>{(flashcardPreview.front || flashcardPreview.back) && <div className="flashcard-preview"><strong>Preview</strong><article><span>Front</span><b>{flashcardPreview.front || 'Add a front'}</b><small>Back: {flashcardPreview.back || 'Add a sentence'}</small></article></div>}</div> : quizType === 'picture' ? (
        <div className="picture-builder">
          <div className="editor-tools">{image && <span>Drag to cover parts</span>}</div>
          {image ? (
            <div className="image-editor">
              <div ref={stageRef} className="image-stage" style={{ aspectRatio: imageRatio }} onPointerDown={beginDraw} onPointerMove={moveDraw} onPointerUp={finishDraw} onPointerCancel={() => { setDrawing(null); setMaskEdit(null); }}>
                <img src={image} alt="Your quiz diagram" draggable={false} onLoad={event => setImageRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
                {masks.map((mask, index) => (
                  <div data-mask="true" key={mask.id} className={`mask-box ${selectedMask === mask.id ? 'selected' : ''}`} style={{ left: `${mask.x}%`, top: `${mask.y}%`, width: `${mask.w}%`, height: `${mask.h}%` }} onPointerDown={event => beginMaskMove(event, mask)} onClick={() => setSelectedMask(mask.id)} role="group" aria-label={`Cover ${answerLabel(index)}`}>
                    <span className="mask-label">{mask.answer || answerLabel(index)}</span>
                    {corners.map(corner => <button type="button" key={corner} className={`resize-handle handle-${corner}`} aria-label={`Resize cover ${answerLabel(index)}`} onPointerDown={event => beginMaskResize(event, mask, corner)} />)}
                  </div>
                ))}
                {drawing && <div className="mask-box drawing" style={{ left: `${Math.min(drawing.start.x, drawing.end.x)}%`, top: `${Math.min(drawing.start.y, drawing.end.y)}%`, width: `${Math.abs(drawing.end.x - drawing.start.x)}%`, height: `${Math.abs(drawing.end.y - drawing.start.y)}%` }} />}
              </div>
              <button className="change-image" onClick={() => fileRef.current?.click()}>Change picture</button>
            </div>
          ) : (
            <button className="upload-box" onClick={() => fileRef.current?.click()}>
              <span className="upload-icon"><ImagePlus size={22} /></span>
              <strong>Choose a picture</strong>
              <span>PNG, JPG or WEBP ? up to 12 MB</span>
            </button>
          )}
          <input ref={fileRef} className="visually-hidden" type="file" accept="image/*" onChange={event => handleImage(event.target.files?.[0])} />
          {image && <div className="answers-panel">
            <div className="answers-heading"><strong>Hidden answers</strong><span>{masks.length}</span></div>
            {masks.length === 0 ? <p className="helper-copy">Drag on the picture to draw your first cover.</p> : masks.map((mask, index) => (
              <div key={mask.id} className={`answer-row ${selectedMask === mask.id ? 'answer-selected' : ''}`}>
                <span className="answer-number">{index + 1}</span>
                <input aria-label={`Answer for cover ${index + 1}`} value={mask.answer} onFocus={() => setSelectedMask(mask.id)} onChange={event => setMasks(previous => previous.map(item => item.id === mask.id ? { ...item, answer: event.target.value } : item))} placeholder="Type the answer" />
                <button className="icon-action" aria-label={`Remove cover ${index + 1}`} onClick={() => { setMasks(previous => previous.filter(item => item.id !== mask.id)); if (selectedMask === mask.id) setSelectedMask(null); }}><X size={15} /></button>
              </div>
            ))}
          </div>}
        </div>
      ) : (
        <div className="text-builder">
          <div className="pdf-import-panel">
            <div><strong>Make questions from a PDF</strong><span>Choose a study guide and AI will draft questions with answers.</span></div>
            <input ref={pdfRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={event => { const file = event.target.files?.[0] ?? null; setPdfFile(file); setError(file && file.size > 8 * 1024 * 1024 ? 'Choose a PDF smaller than 8 MB.' : ''); event.currentTarget.value = ''; }} />
            <div className="pdf-import-controls"><button className="soft-button" onClick={() => pdfRef.current?.click()} disabled={generatingPdfQuiz}><Upload size={15}/>{pdfFile ? pdfFile.name : 'Choose PDF'}</button><label>Questions<select value={pdfQuestionCount} onChange={event => setPdfQuestionCount(Number(event.target.value))} disabled={generatingPdfQuiz}>{[5, 10, 15, 20].map(count => <option key={count} value={count}>{count}</option>)}</select></label><button className="primary-button" onClick={() => void generatePdfQuiz()} disabled={!pdfFile || pdfFile.size > 8 * 1024 * 1024 || generatingPdfQuiz}>{generatingPdfQuiz ? 'Making questions…' : 'Generate'}</button></div>
            <small>Your PDF is sent to Gemini, including scanned pages. The free tier may use submitted content to improve Google products. Kizmo saves only the quiz, not the PDF.</small>
          </div>
          <div className="text-entry">
            <input value={questionDraft} onChange={event => setQuestionDraft(event.target.value)} placeholder="Question" aria-label="Question" />
            <input value={answerDraft} onChange={event => setAnswerDraft(event.target.value)} placeholder="Answer" aria-label="Answer" />
            <button className="soft-button" onClick={addTextCard}><Plus size={15} /> Add</button>
          </div>
          {masks.length > 0 && <div className="answers-panel">
            <div className="answers-heading"><strong>Questions</strong><span>{masks.length}</span></div>
            {masks.map((item, index) => <div className="text-question-row" key={item.id}>
              <span className="answer-number">{index + 1}</span>
              <div><input value={item.question ?? ''} aria-label={`Question ${index + 1}`} onChange={event => setMasks(previous => previous.map(card => card.id === item.id ? { ...card, question: event.target.value } : card))} placeholder="Question"/><input value={item.answer} aria-label={`Answer ${index + 1}`} onChange={event => setMasks(previous => previous.map(card => card.id === item.id ? { ...card, answer: event.target.value } : card))} placeholder="Answer"/></div>
              <button className="icon-action" aria-label={`Remove question ${index + 1}`} onClick={() => setMasks(previous => previous.filter(card => card.id !== item.id))}><X size={15} /></button>
            </div>)}
          </div>}
        </div>
      )}
      <div className="editor-bottom"><button className="soft-button" onClick={() => setView('folder')}>Cancel</button><button className="primary-button" onClick={event => void saveSet(event as unknown as FormEvent)} disabled={saving}>{saving ? 'Adding…' : <>Add {createKind === 'flashcard' ? 'flashcards' : 'quiz'} <ArrowRight size={16}/></>}</button></div></section>}

    {view === 'study' && active && <section className="practice-page">
      {shouldCelebrate && <ConfettiCelebration key={folderPracticeComplete ? 'folder-complete' : 'quiz-complete'}/>}
      <div className="practice-top">
        <button className="round-button" aria-label="Back to folder" onClick={() => setView('folder')}><ArrowLeft size={18}/></button>
        <div><span>{mixedPractice ? `${practiceTaskIndex + 1} of ${practiceTasks.length} in this folder` : active.kind === 'fillblank' ? `${active.masks.length} blanks` : active.image ? `${active.masks.length} answers` : `${cardIndex + 1} of ${active.masks.length}`}</span></div>
        <span className="practice-flower">?</span>
      </div>
      {folderPracticeComplete ? <div className="practice-finish-screen"><div className="finish-sticker">✿</div><span>FOLDER COMPLETE</span><h1>You did it!</h1><p>You made it through all {practiceTasks.length} study rounds.</p><button className="primary-button" onClick={() => { setFolderPracticeComplete(false); setPracticeTasks([]); setPracticeTaskIndex(0); setView('folder'); }}>Back to folder <ArrowRight size={16}/></button></div> : active.kind === 'flashcard' ? quizComplete ? <div className="quiz-result"><div className="empty-flower">✓</div><h2>Deck complete!</h2><p>{active.masks.length} cards reviewed</p><button className="primary-button" onClick={() => mixedPractice ? nextPracticeTask() : setView('folder')}>{mixedPractice ? 'Continue' : 'Back to folder'} <ArrowRight size={16}/></button></div> : <div className="flashcard-study"><div className="flashcard-flip-scene"><div className={`flashcard-flipper ${flashcardRevealed ? 'is-flipped' : ''}`}><article className="flashcard-face flashcard-front" aria-hidden={flashcardRevealed}><span>Front</span><p>{activeMask?.question}</p><small>Think of the answer, then flip ✿</small></article><article className="flashcard-face flashcard-back" aria-hidden={!flashcardRevealed}><span>Back</span><p>{activeMask?.answer}</p><Flower2 className="flashcard-corner-flower" size={34} aria-hidden="true"/><small key={activeMask?.id} className="flashcard-cheer" aria-live="polite">{flashcardCheer}</small></article></div></div><div className="flashcard-controls"><button className="soft-button" disabled={cardIndex === 0} onClick={previousFlashcard}>Previous</button><span>{cardIndex + 1} / {active.masks.length}</span>{!flashcardRevealed ? <button className="primary-button" onClick={() => setFlashcardRevealed(true)}>Show answer <ArrowRight size={16}/></button> : <button className="primary-button" onClick={nextMask}>{cardIndex === active.masks.length - 1 ? 'Finish deck' : 'Next card'} <ArrowRight size={16}/></button>}</div></div> : active.kind === 'fillblank' ? <div className="fillblank-practice"><div className="fillblank-passage">{blankPracticeSegments.map((part, index) => part.mark ? <mark className={`fillblank-practice-mark ${pictureSubmitted ? (pictureAnswers[part.mark.id]?.trim().toLocaleLowerCase() === part.mark.answer.trim().toLocaleLowerCase() ? 'blank-correct' : 'blank-incorrect') : ''}`} key={part.mark.id}>{pictureSubmitted ? part.text : part.index}</mark> : <span key={`fill-text-${index}`}>{part.text}</span>)}</div><div className="fillblank-answer-list">{activeBlankMarks.map((mark, index) => {
        const correct = pictureAnswers[mark.id]?.trim().toLocaleLowerCase() === mark.answer.trim().toLocaleLowerCase();
        return <label className={`fillblank-answer-row ${pictureSubmitted ? (correct ? 'answer-correct' : 'answer-incorrect') : ''}`} key={mark.id}><span>{index + 1}</span><input value={pictureAnswers[mark.id] ?? ''} disabled={pictureSubmitted} onChange={event => setPictureAnswers(previous => ({ ...previous, [mark.id]: event.target.value }))} placeholder="Your answer" aria-label={`Answer blank ${index + 1}`}/>{pictureSubmitted && <small>{correct ? 'Correct' : `Answer: ${mark.answer}`}</small>}</label>;
      })}</div><div className="image-submit-row">{pictureSubmitted && <span>{activeBlankMarks.filter(mark => pictureAnswers[mark.id]?.trim().toLocaleLowerCase() === mark.answer.trim().toLocaleLowerCase()).length} / {activeBlankMarks.length} correct</span>}<button className="primary-button" disabled={!pictureSubmitted && activeBlankMarks.some(mark => !pictureAnswers[mark.id]?.trim())} onClick={pictureSubmitted ? mixedPractice ? nextPracticeTask : retryPicture : submitPictureAnswers}>{pictureSubmitted ? mixedPractice ? 'Next' : 'Try again' : 'Check answers'} <ArrowRight size={16}/></button></div></div> : active.image ? <>
        <div className="practice-image" style={{ aspectRatio: imageRatio }}>
          <img src={active.image} alt="Quiz diagram" onLoad={event => setImageRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}/>
          {active.masks.map((mask, index) => {
            const correct = pictureAnswers[mask.id]?.trim().toLocaleLowerCase() === mask.answer.trim().toLocaleLowerCase();
            const resultClass = pictureSubmitted ? (correct ? 'submitted-correct' : 'submitted-incorrect') : '';
            return <div key={mask.id} className={`practice-mask ${resultClass}`} style={{ left: `${mask.x}%`, top: `${mask.y}%`, width: `${mask.w}%`, height: `${mask.h}%` }} aria-label={`Covered answer ${answerLabel(index)}`}>
              {!pictureSubmitted && <span>{answerLabel(index)}</span>}
            </div>;
          })}
        </div>
        <div className="image-answer-list">
          {active.masks.map((mask, index) => {
            const correct = pictureAnswers[mask.id]?.trim().toLocaleLowerCase() === mask.answer.trim().toLocaleLowerCase();
            return <label key={mask.id} className={`image-answer-row ${pictureSubmitted ? (correct ? 'answer-correct' : 'answer-incorrect') : ''}`}>
              <span className="image-answer-letter">{answerLabel(index)}:</span>
              <input value={pictureAnswers[mask.id] ?? ''} disabled={pictureSubmitted} onChange={event => setPictureAnswers(previous => ({ ...previous, [mask.id]: event.target.value }))} placeholder="Your answer" aria-label={`Answer ${answerLabel(index)}`}/>
              {pictureSubmitted && <small>{correct ? 'Correct' : `Answer: ${mask.answer}`}</small>}
            </label>;
          })}
        </div>
        <div className="image-submit-row">
          {pictureSubmitted && <span>{active.masks.filter(mask => pictureAnswers[mask.id]?.trim().toLocaleLowerCase() === mask.answer.trim().toLocaleLowerCase()).length} / {active.masks.length} correct</span>}
          <button className="primary-button" disabled={!pictureSubmitted && active.masks.some(mask => !pictureAnswers[mask.id]?.trim())} onClick={pictureSubmitted ? mixedPractice ? nextPracticeTask : retryPicture : submitPictureAnswers}>{pictureSubmitted ? mixedPractice ? 'Next' : 'Try again' : 'Check answers'} <ArrowRight size={16}/></button>
        </div>
      </> : quizComplete ? <div className="quiz-result"><div className="empty-flower">✓</div><h2>Quiz complete!</h2><p>{quizScore} / {active.masks.length} correct</p><button className="primary-button" onClick={() => setView('folder')}>Back to folder <ArrowRight size={16}/></button></div> : <>
        <div className="text-prompt">{activeMask?.question}</div>
        {activeMask && (textChoices[activeMask.id]?.length > 1 ? <div className="text-choice-area">
          <div className="text-choice-list">
            {textChoices[activeMask.id].map((choice, index) => {
              const correct = choice.toLocaleLowerCase() === activeMask.answer.trim().toLocaleLowerCase();
              const selected = selectedChoice === choice;
              const stateClass = choiceChecked ? (correct ? 'choice-correct' : selected ? 'choice-incorrect' : '') : selected ? 'choice-selected' : '';
              return <button key={`${activeMask.id}-${choice}`} className={`text-choice ${stateClass}`} onClick={() => !choiceChecked && setSelectedChoice(choice)} disabled={choiceChecked}>
                <span>{answerLabel(index)}</span><strong>{choice}</strong>{choiceChecked && correct && <Check size={16} />}
              </button>;
            })}
          </div>
          <div className="text-choice-footer">
            {choiceChecked && <span className={selectedChoice?.toLocaleLowerCase() === activeMask.answer.trim().toLocaleLowerCase() ? 'choice-result good' : 'choice-result bad'}>{selectedChoice?.toLocaleLowerCase() === activeMask.answer.trim().toLocaleLowerCase() ? 'Correct!' : `Answer: ${activeMask.answer}`}</span>}
            <button className="primary-button" disabled={!choiceChecked && !selectedChoice?.trim()} onClick={() => choiceChecked ? nextMask() : checkTextAnswer()}>{choiceChecked ? mixedPractice ? 'Continue' : singleQuestion ? 'Back to folder' : cardIndex === active.masks.length - 1 ? 'Finish quiz' : 'Next question' : 'Check answer'} <ArrowRight size={16}/></button>
          </div>
        </div> : <div className="text-choice-area"><label className={`identification-answer ${choiceChecked ? selectedChoice?.trim().toLocaleLowerCase() === activeMask.answer.trim().toLocaleLowerCase() ? 'choice-correct' : 'choice-incorrect' : ''}`}><span>Your answer</span><input value={selectedChoice ?? ''} disabled={choiceChecked} onChange={event => setSelectedChoice(event.target.value)} placeholder="Type your answer" />{choiceChecked && <small>{selectedChoice?.trim().toLocaleLowerCase() === activeMask.answer.trim().toLocaleLowerCase() ? 'Correct!' : `Answer: ${activeMask.answer}`}</small>}</label><div className="text-choice-footer"><button className="primary-button" disabled={!choiceChecked && !selectedChoice?.trim()} onClick={() => choiceChecked ? nextMask() : checkTextAnswer()}>{choiceChecked ? mixedPractice ? 'Continue' : singleQuestion ? 'Back to folder' : cardIndex === active.masks.length - 1 ? 'Finish quiz' : 'Next question' : 'Check answer'} <ArrowRight size={16}/></button></div></div>)}
      </>}
    </section>}
    {folderModal && <div className="folder-modal-backdrop" onClick={() => setFolderModal(null)}>
      <form className="folder-modal" onSubmit={folderModal === 'create' ? createFolder : renameFolder} onClick={event => event.stopPropagation()}>
        <button className="modal-close" type="button" aria-label="Close" onClick={() => setFolderModal(null)}><X size={18}/></button>
        <div className="modal-icon"><FolderOpen size={20}/></div>
        <div className="eyebrow"><span className="eyebrow-dot"/> FOLDER</div>
        <h2>{folderModal === 'create' ? 'Create a folder' : 'Rename folder'}</h2>
        <p>Keep picture and text quizzes together.</p>
        <label htmlFor="folder-name">Folder name</label>
        <input id="folder-name" autoFocus maxLength={80} placeholder="e.g. Biology" value={folderName} onChange={event => setFolderName(event.target.value)} />
        <div className="modal-actions">
          <button className="soft-button" type="button" onClick={() => setFolderModal(null)}>Cancel</button>
          <button className="primary-button" type="submit">{folderModal === 'create' ? 'Create folder' : 'Save name'}</button>
        </div>
      </form>
    </div>}
  </main>;
}

export default App;
