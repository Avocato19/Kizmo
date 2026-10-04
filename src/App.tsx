import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { Archive, ArrowLeft, ArrowRight, Check, Download, FolderOpen, ImagePlus, Layers3, Pencil, Plus, RotateCcw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { readSnapshot } from './storage';
import { supabase, supabaseConfigured } from './lib/supabase';

type Mask = { id: string; x: number; y: number; w: number; h: number; answer: string; question?: string };
type StudySet = { id: string; title: string; image: string; masks: Mask[]; createdAt: string; folderId: string };
type StudyFolder = { id: string; title: string; createdAt: string; archived?: boolean };
type PracticeTask = { set: StudySet; questionIndex: number | null };
type View = 'home' | 'folder' | 'create' | 'study';
type Point = { x: number; y: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type MaskEdit = { id: string; mode: 'move' | 'resize'; corner?: Corner; start: Point; original: Mask };
const corners: Corner[] = ['nw', 'ne', 'sw', 'se'];
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
const setFromRow = (row: { id: string; title: string; image: string; masks: Mask[]; created_at: string; folder_id: string }): StudySet => ({ id: row.id, title: row.title, image: row.image, masks: row.masks, createdAt: row.created_at, folderId: row.folder_id });
const folderToRow = (folder: StudyFolder) => ({ id: folder.id, title: folder.title, created_at: folder.createdAt, archived: Boolean(folder.archived) });
const setToRow = (item: StudySet) => ({ id: item.id, title: item.title, image: item.image, masks: item.masks, created_at: item.createdAt, folder_id: item.folderId });

function App() {
  const [sets, setSets] = useState<StudySet[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [archiveMode, setArchiveMode] = useState(false);
  const [folderModal, setFolderModal] = useState<'create' | 'rename' | null>(null);
  const [folderName, setFolderName] = useState('');
  const [view, setView] = useState<View>('home');
  const [active, setActive] = useState<StudySet | null>(null);
  const [practiceTasks, setPracticeTasks] = useState<PracticeTask[]>([]);
  const [practiceTaskIndex, setPracticeTaskIndex] = useState(0);
  const [mixedPractice, setMixedPractice] = useState(false);
  const [singleQuestion, setSingleQuestion] = useState(false);
  const [image, setImage] = useState('');
  const [imageRatio, setImageRatio] = useState(4 / 3);
  const [quizType, setQuizType] = useState<'picture' | 'text'>('picture');
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const backupRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeMask = active?.masks[cardIndex % (active.masks.length || 1)];
  const activeFolder = folders.find(folder => folder.id === folderId) ?? null;
  const folderSets = sets.filter(set => set.folderId === folderId);

  const loadSets = async () => {
    try {
      if (!supabaseConfigured || !supabase) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to connect Supabase.');
      const [folderResult, setResult] = await Promise.all([
        supabase.from('folders').select('id,title,created_at,archived').order('created_at', { ascending: false }),
        supabase.from('study_sets').select('id,title,image,masks,created_at,folder_id').order('created_at', { ascending: false }),
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
      supabase.from('study_sets').select('id,title,image,masks,created_at,folder_id'),
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

  const startCreate = () => {
    if (!folderId) { setError('Open a folder first.'); return; }
    setImage(''); setMasks([]); setSelectedMask(null);
    setQuestionDraft(''); setAnswerDraft(''); setQuizType('picture'); setView('create'); setError('');
  };
  const changeQuizType = (type: 'picture' | 'text') => {
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
  const saveSet = async (event: FormEvent) => {
    event.preventDefault();
    if (masks.length === 0 || masks.some(mask => !mask.answer.trim() || (!image && !mask.question?.trim()))) {
    setError(masks.length === 0 ? quizType === 'picture' ? 'Draw at least one cover on the image.' : 'Add at least one question.' : 'Add an answer for each item.'); return;
    }
    if (quizType === 'picture' && !image) { setError('Add an image first.'); return; }
    if (!folderId) { setError('Open a folder first.'); return; }
    setSaving(true); setError('');
    const item: StudySet = { id: crypto.randomUUID(), title: '', image, masks, createdAt: new Date().toISOString(), folderId };
    try {
      if (!supabase) throw new Error('Set your Supabase URL and anon key first.');
      const result = await supabase.from('study_sets').insert(setToRow(item)); if (result.error) throw result.error;
      const nextSets = [item, ...sets];
      setSets(nextSets); setImage(''); setMasks([]); setSelectedMask(null); setView('folder');
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
    setTextChoices(task.set.image ? {} : choicesFor(task.set)); setSelectedChoice(null); setChoiceChecked(false);
    setSingleQuestion(task.questionIndex !== null); setView('study');
  };
  const startStudy = (item: StudySet, questionIndex: number | null = null) => {
    setMixedPractice(false); setPracticeTasks([]); setPracticeTaskIndex(0);
    loadPracticeTask({ set: item, questionIndex });
  };
  const startFolderPractice = () => {
    const tasks: PracticeTask[] = folderSets.flatMap((set): PracticeTask[] => set.image ? [{ set, questionIndex: null }] : set.masks.map((_, questionIndex) => ({ set, questionIndex })));
    if (!tasks.length) return;
    setPracticeTasks(tasks); setPracticeTaskIndex(0); setMixedPractice(true); loadPracticeTask(tasks[0]);
  };
  const nextPracticeTask = () => {
    const nextIndex = practiceTaskIndex + 1;
    if (nextIndex >= practiceTasks.length) {
      setMixedPractice(false); setPracticeTasks([]); setView('folder'); return;
    }
    setPracticeTaskIndex(nextIndex); loadPracticeTask(practiceTasks[nextIndex]);
  };
  const nextMask = () => {
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
      <div className="folder-heading"><div><span className="hello-tag"><FolderOpen size={14}/> FOLDER</span><h1>{activeFolder.title}</h1><p>{folderSets.length} {folderSets.length === 1 ? 'quiz' : 'quizzes'}</p></div><div className="folder-heading-actions"><button className="soft-button" onClick={() => { setFolderName(activeFolder.title); setFolderModal('rename'); }}><Pencil size={15}/> Rename</button><button className="soft-button" onClick={() => void setFolderArchived(activeFolder, true)}><Archive size={14}/> Archive</button><button className="soft-button" disabled={!folderSets.length} onClick={startFolderPractice}>Practice all</button><button className="primary-button" onClick={startCreate}><Plus size={16}/> New quiz</button></div></div>
      {folderSets.some(item => item.image) && <div className="folder-content-section"><div className="set-grid">{folderSets.filter(item => item.image).map(item => <article className="set-card" key={item.id}><button className="set-preview" onClick={() => startStudy(item)}><img src={item.image} alt=""/><span className="mask-count">{item.masks.length} {item.masks.length === 1 ? 'cover' : 'covers'}</span></button><div className="set-card-row set-card-actions"><button className="study-link" onClick={() => startStudy(item)}>Practice quiz <ArrowRight size={15}/></button><button className="icon-action delete-action" onClick={() => void deleteSet(item.id)} aria-label="Delete quiz"><Trash2 size={16}/></button></div></article>)}</div></div>}
      {folderSets.some(item => !item.image) && <div className="folder-content-section"><div className="question-list">{folderSets.filter(item => !item.image).flatMap(item => item.masks.map((question, index) => <button className="folder-question" key={`${item.id}-${question.id}`} onClick={() => startStudy(item, index)}><span className="folder-question-text">{question.question}</span><span className="folder-question-action">Answer <ArrowRight size={14}/></span></button>))}</div></div>}
      {!folderSets.length && <div className="empty-card folder-empty"><div className="empty-flower">?</div><h3>This folder is empty</h3><p>Add picture quizzes and text questions here.</p><button className="primary-button" onClick={startCreate}><Plus size={16}/> Create a quiz</button></div>}
    </section>}

    {view === 'create' && <section className="editor-page"><div className="editor-heading"><div><span className="hello-tag">NEW</span><h1>Make a quiz</h1></div><button className="primary-button save-button" onClick={event => void saveSet(event as unknown as FormEvent)} disabled={saving}>{saving ? 'Adding…' : <><Plus size={16}/> Add</>}</button></div><div className="type-switch"><button className={quizType === 'picture' ? 'type-option active' : 'type-option'} onClick={() => changeQuizType('picture')} aria-label="Picture quiz"><ImagePlus size={15}/></button><button className={quizType === 'text' ? 'type-option active' : 'type-option'} onClick={() => changeQuizType('text')} aria-label="Text quiz"><Layers3 size={15}/></button></div>
      {quizType === 'picture' ? (
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
          <div className="text-entry">
            <input value={questionDraft} onChange={event => setQuestionDraft(event.target.value)} placeholder="Question" aria-label="Question" />
            <input value={answerDraft} onChange={event => setAnswerDraft(event.target.value)} placeholder="Answer" aria-label="Answer" />
            <button className="soft-button" onClick={addTextCard}><Plus size={15} /> Add</button>
          </div>
          {masks.length > 0 && <div className="answers-panel">
            <div className="answers-heading"><strong>Questions</strong><span>{masks.length}</span></div>
            {masks.map((item, index) => <div className="text-question-row" key={item.id}>
              <span className="answer-number">{index + 1}</span>
              <div><strong>{item.question}</strong><small>{item.answer}</small></div>
              <button className="icon-action" aria-label={`Remove question ${index + 1}`} onClick={() => setMasks(previous => previous.filter(card => card.id !== item.id))}><X size={15} /></button>
            </div>)}
          </div>}
        </div>
      )}
      <div className="editor-bottom"><button className="soft-button" onClick={() => setView('folder')}>Cancel</button><button className="primary-button" onClick={event => void saveSet(event as unknown as FormEvent)} disabled={saving}>{saving ? 'Adding…' : <>Add quiz <ArrowRight size={16}/></>}</button></div></section>}

    {view === 'study' && active && <section className="practice-page">
      <div className="practice-top">
        <button className="round-button" aria-label="Back to folder" onClick={() => setView('folder')}><ArrowLeft size={18}/></button>
        <div><span>{mixedPractice ? `${practiceTaskIndex + 1} of ${practiceTasks.length} in this folder` : active.image ? `${active.masks.length} answers` : `${cardIndex + 1} of ${active.masks.length}`}</span></div>
        <span className="practice-flower">?</span>
      </div>
      {active.image ? <>
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
