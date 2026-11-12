import { useCallback, useEffect, useRef, useState } from "react";
import type { PdfBoard } from "@writalin/workspaces";
import type { QuizQuestion } from "@writalin/vault";
import { aiApi, ApiError } from "./api";
import { completeLines, parseTutorLine, speakable, speechLang } from "./tutorBoard";

export interface TutorMsg {
  id: string;
  from: "you" | "tutor";
  text: string;
  /** Still talking or drawing. */
  working?: boolean;
  error?: boolean;
  /** Sent while the tutor was busy; it is read once the tutor finishes. */
  queued?: boolean;
  /** Cut short at the end of a point, because the student said something. */
  interrupted?: boolean;
  /** How many things this reply put on the board (they can be taken back). */
  drawn?: number;
  undone?: boolean;
  /** What the tutor was reading, e.g. "page 4 of Biology.pdf". */
  using?: string;
  /** What this reply saved with the app's tools. */
  saved?: { cards: number; notes: number; tasks: number; timer?: boolean };
  /** What the student was pointing at when they asked, e.g. "page 2: “3. Solve for x”". */
  pointing?: string;
  /** Said into the microphone rather than typed. */
  spoken?: boolean;
  /** A quiz this reply made, ready to play. */
  quiz?: QuizQuestion[];
}

export interface TutorHost {
  /** The PDF to write and draw on; opens an empty one when there is none. */
  board: () => Promise<PdfBoard | null>;
  /** What is open beside the board; the tutor uses it only when it fits the question. */
  material: (board: PdfBoard, question: string) => Promise<{ text: string; label: string } | null>;
  /** The app's study tools. */
  tools: {
    card: (question: string, answer: string) => Promise<void> | void;
    note: (markdown: string) => Promise<void> | void;
    task: (text: string, due?: string) => Promise<void> | void;
    timer: () => void;
  };
  /** What the student is pointing at on a page right now (cursor, finger or selection), if anything. */
  pointing: () => Promise<{ label: string; text: string; page: number; board: PdfBoard } | null>;
  /** The student's own standing instructions for the tutor. */
  instructions: () => string;
}

const newId = () => Math.random().toString(36).slice(2, 10);
/** Matches the server's limit on how much text one request may send, with room for the board. */
const MAX_MATERIAL = 40_000;
const VOICE_KEY = "writalin.tutor.voice";
const VOICE_NAME_KEY = "writalin.tutor.voiceName";
const readVoiceName = () => {
  try {
    return localStorage.getItem(VOICE_NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

/** Names that device voices commonly use for a woman's voice, to offer one first when nothing was picked. */
const WOMAN = /female|woman|samantha|victoria|karen|moira|tessa|fiona|allison|ava|susan|zira|hazel|aria|jenny|sonia|libby|michelle|emma|joanna|salli|kendra|kimberly|amy|google us english|google uk english female|laila|salma|hoda|zariyah|amira/i;

/**
 * The voice to read a sentence with: the one the student picked when it speaks
 * the sentence's language, else a woman's voice in that language when the
 * device has one, else any voice in that language.
 */
export function pickVoice<V extends { name: string; lang: string }>(voices: V[], lang: string, picked: string): V | undefined {
  const base = lang.slice(0, 2).toLowerCase();
  const fits = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(base));
  return fits.find((v) => v.name === picked) ?? fits.find((v) => WOMAN.test(v.name)) ?? fits.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? fits[0];
}

const synth = (): SpeechSynthesis | null => (typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined" ? window.speechSynthesis : null);
const readVoicePref = () => {
  try {
    return localStorage.getItem(VOICE_KEY) !== "off";
  } catch {
    return true;
  }
};

/** The browser's speech-to-text, where it has one (Chrome, Edge, Safari). */
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
const recognizer = (): (new () => Recognizer) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
/**
 * Below this the recogniser itself doubts the words. That is mostly speech
 * from across the room or over other people, so it is left out. (0 means the
 * browser gave no score.)
 */
const MIN_CONFIDENCE = 0.45;
const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "Allow the microphone for this site, then tap the microphone again.",
  "service-not-allowed": "Allow the microphone for this site, then tap the microphone again.",
  "audio-capture": "No microphone was found.",
  "no-speech": "I didn't hear anything. Tap the microphone and try again.",
  network: "Listening needs an internet connection.",
  "language-not-supported": "This browser can't listen in that language.",
};

/** One question from the student, with what they were pointing at when they asked. */
interface Asked {
  id: string;
  q: string;
  pointing?: string;
  /** The PDF and page they pointed at, so the tutor's cursor can read along there. */
  at?: { board: PdfBoard; page: number };
}

/** The right answer comes first from the tutor; the student sees the options mixed. */
function quizQuestion(question: string, options: string[]): QuizQuestion {
  const right = options[0]!;
  const mixed = [...options];
  for (let i = mixed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [mixed[i], mixed[j]] = [mixed[j]!, mixed[i]!];
  }
  return { question, options: mixed, correct: mixed.indexOf(right), answer: right };
}

/**
 * A tutoring session: the student writes, the tutor talks (aloud, with
 * captions), answers in the chat and works on the board live. It can be
 * paused, and questions sent while it is busy wait their turn. The
 * conversation lives only while the app is open.
 */
export function useTutor(host: TutorHost) {
  const [log, setLog] = useState<TutorMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [voice, setVoiceState] = useState(readVoicePref);
  /** The sentence being spoken, shown as a caption on the board. */
  const [caption, setCaption] = useState<string | null>(null);
  const hostNow = useRef(host);
  hostNow.current = host;
  const stopRef = useRef<AbortController | null>(null);
  /** What was asked and what the tutor replied (its commands), for the next question. */
  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  /** The marks each reply added, and the board they are on. */
  const work = useRef(new Map<string, { board: PdfBoard; ids: string[] }>());
  const busyNow = useRef(false);
  /** Questions sent while the tutor was busy, in order. */
  const queue = useRef<Asked[]>([]);
  const pausedNow = useRef(false);
  const resumers = useRef<(() => void)[]>([]);
  const voiceNow = useRef(voice);
  voiceNow.current = voice;
  /** The device's voices (they load a moment after the page), and the one the student picked. */
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  const [voiceName, setVoiceNameState] = useState(readVoiceName);
  const voiceNameNow = useRef(voiceName);
  voiceNameNow.current = voiceName;
  useEffect(() => {
    const s = synth();
    if (!s) return;
    const load = () => setVoices(s.getVoices().map((v) => ({ name: v.name, lang: v.lang })));
    load();
    s.addEventListener?.("voiceschanged", load);
    return () => s.removeEventListener?.("voiceschanged", load);
  }, []);
  /** Pick a voice by name ("" lets the app choose) and say a few words in it. */
  const setVoiceName = useCallback((name: string) => {
    setVoiceNameState(name);
    voiceNameNow.current = name;
    try {
      if (name) localStorage.setItem(VOICE_NAME_KEY, name);
      else localStorage.removeItem(VOICE_NAME_KEY);
    } catch {
      /* private mode: just not remembered */
    }
    const s = synth();
    if (!s || busyNow.current) return;
    const v = s.getVoices().find((x) => x.name === name);
    const u = new SpeechSynthesisUtterance(v?.lang.toLowerCase().startsWith("ar") ? "مرحبا، أنا معلمتك." : "Hi, I'm your tutor.");
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    s.cancel();
    s.speak(u);
  }, []);

  const patch = (id: string, change: (m: TutorMsg) => TutorMsg) => setLog((l) => l.map((m) => (m.id === id ? change(m) : m)));

  /** Resolves at once, or when the lesson is resumed. */
  const unpaused = () => (pausedNow.current ? new Promise<void>((r) => resumers.current.push(r)) : Promise.resolve());

  /** Read one sentence aloud with its caption. Resolves when it has been said (at once when the voice is off). */
  const speak = (text: string, stop: AbortSignal) =>
    new Promise<void>((resolve) => {
      const s = synth();
      const words = speakable(text);
      if (!s || !voiceNow.current || !words || stop.aborted) return resolve();
      const u = new SpeechSynthesisUtterance(words);
      u.lang = speechLang(words, (navigator.language || "en").split("@")[0]!);
      const v = pickVoice(s.getVoices(), u.lang, voiceNameNow.current);
      if (v) u.voice = v;
      let done = false;
      let spoken = 0;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(watch);
        stop.removeEventListener("abort", finish);
        setCaption((c) => (c === text ? null : c));
        resolve();
      };
      // Some browsers never say when they are done, so the wait also ends by itself.
      const limit = 4000 + words.length * 160;
      const watch = setInterval(() => {
        if (pausedNow.current) return;
        spoken += 250;
        if (spoken > limit || (spoken > 1200 && !s.speaking && !s.pending)) finish();
      }, 250);
      u.onend = finish;
      u.onerror = finish;
      stop.addEventListener("abort", finish);
      setCaption(text);
      try {
        s.speak(u);
      } catch {
        finish();
      }
    });

  const answer = async ({ q, pointing, at }: Asked) => {
    const id = newId();
    setLog((l) => [...l, { id, from: "tutor", text: "", working: true }]);
    const stop = new AbortController();
    stopRef.current = stop;
    let raw = "";
    /** The lines carried out so far: what the tutor remembers if it is cut short. */
    const did: string[] = [];
    let cut = false;
    let points = 0;
    try {
      const board = await hostNow.current.board();
      if (!board) throw new ApiError(0, "Open a PDF or a blank PDF first, so there is something to write on.");
      board.begin();
      const [about, material] = await Promise.all([board.describe(), hostNow.current.material(board, q).catch(() => null)]);
      if (material) patch(id, (m) => ({ ...m, using: material.label }));
      const ids: string[] = [];
      work.current.set(id, { board, ids });
      const saved = { cards: 0, notes: 0, tasks: 0, timer: false };
      const quiz: QuizQuestion[] = [];
      // Lines are carried out one after another, in the order they were written.
      let fed = 0;
      let chain: Promise<void> = Promise.resolve();
      // One sentence is spoken at a time; the board work after it goes on while it is said.
      let talking: Promise<void> = Promise.resolve();
      const feed = (lines: string[]) => {
        for (const line of lines.slice(fed)) {
          const step = parseTutorLine(line);
          if (!step) continue;
          chain = chain.then(async () => {
            await unpaused();
            // Stopped: the rest of the reply is dropped.
            if (stop.signal.aborted) return;
            if ("say" in step) {
              await talking;
              await unpaused();
              if (stop.signal.aborted) return;
              // A new `say` starts a new point. If the student said something meanwhile, stop here and hear them.
              if (points > 0 && queue.current.length) {
                cut = true;
                return stop.abort();
              }
              points++;
              did.push(line);
              patch(id, (m) => ({ ...m, text: m.text ? `${m.text}\n${step.say}` : step.say }));
              talking = speak(step.say, stop.signal);
              return;
            }
            if ("tool" in step) {
              did.push(line);
              const tools = hostNow.current.tools;
              if (step.tool === "card") {
                await tools.card(step.question, step.answer);
                saved.cards++;
              } else if (step.tool === "note") {
                await tools.note(step.text);
                saved.notes++;
              } else if (step.tool === "task") {
                await tools.task(step.text, step.due);
                saved.tasks++;
              } else if (step.tool === "timer") {
                tools.timer();
                saved.timer = true;
              } else {
                quiz.push(quizQuestion(step.question, step.options));
                return patch(id, (m) => ({ ...m, quiz: [...quiz] }));
              }
              return patch(id, (m) => ({ ...m, saved: { ...saved } }));
            }
            did.push(line);
            // Reading goes where the student pointed, when that is another PDF than the board.
            if (step.op === "read" && at) {
              if (at.board !== board && board.blank) return void (await at.board.apply({ ...step, page: at.page }));
              if (at.board === board) return void (await board.apply({ ...step, page: at.page }));
            }
            const added = await board.apply(step);
            if (added.length) {
              ids.push(...added);
              patch(id, (m) => ({ ...m, drawn: ids.length }));
            }
          }).catch(() => {});
        }
        fed = Math.max(fed, lines.length);
      };
      const material_ = (material?.text ?? "").slice(0, MAX_MATERIAL);
      const r = await aiApi.run("tutor", material_, q, { board: about, pointing: pointing && at ? `${pointing}\n${at.board === board ? "This is on the board page itself: `read` it and mark it there." : "This is on another PDF, open beside the board. You can `read` it with these positions (your cursor goes there), but write and draw only on the board; don't highlight it."}` : pointing, printed: !board.blank, history: history.current.slice(-8), extra: hostNow.current.instructions().trim().slice(0, 1000) || undefined, signal: stop.signal }, (soFar) => {
        raw = soFar;
        feed(completeLines(soFar));
      });
      raw = r.text;
      feed(completeLines(r.text, true));
      await chain;
      await talking;
      if (stop.signal.aborted) throw new DOMException("Stopped", "AbortError");
      history.current.push({ role: "user", content: q }, { role: "assistant", content: raw.slice(0, 5000) });
      patch(id, (m) => ({ ...m, working: false, text: m.text || (ids.length ? "It's on the board." : m.saved || m.quiz ? "Done." : "I have nothing to add.") }));
    } catch (e) {
      const stopped = stop.signal.aborted;
      // Stopped part-way: what's already on the board stays, and the tutor remembers what it got through.
      if (stopped && did.length) history.current.push({ role: "user", content: q }, { role: "assistant", content: did.join("\n").slice(0, 5000) });
      const message = stopped ? "" : e instanceof ApiError ? e.message : "Something went wrong. Try again.";
      patch(id, (m) => ({ ...m, working: false, error: !stopped, interrupted: cut || undefined, text: stopped ? m.text || "Stopped." : message }));
    } finally {
      stopRef.current = null;
    }
  };

  /** Ask the tutor. While it is busy the question waits, and is read as soon as the tutor finishes. */
  const send = useCallback(async (question: string, how: { spoken?: boolean } = {}) => {
    const q = question.trim();
    if (!q) return;
    const mine = newId();
    setLog((l) => [...l, { id: mine, from: "you", text: q, spoken: how.spoken, queued: busyNow.current || undefined }]);
    // What they are pointing at is taken now, not when a waiting question is finally read.
    const entry: Asked = { id: mine, q };
    const waiting = busyNow.current;
    if (waiting) queue.current.push(entry);
    const point = await hostNow.current.pointing().catch(() => null);
    if (point) {
      entry.pointing = point.text;
      entry.at = { board: point.board, page: point.page };
      patch(mine, (m) => ({ ...m, pointing: point.label }));
    }
    if (waiting || busyNow.current) {
      if (!waiting) queue.current.push(entry);
      return;
    }
    busyNow.current = true;
    setBusy(true);
    try {
      let next: Asked | undefined = entry;
      while (next) {
        const now = next;
        patch(now.id, (m) => ({ ...m, queued: undefined }));
        await answer(now);
        next = queue.current.shift();
      }
    } finally {
      busyNow.current = false;
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resume = useCallback(() => {
    pausedNow.current = false;
    setPaused(false);
    synth()?.resume();
    for (const r of resumers.current.splice(0)) r();
  }, []);

  /** Hold the lesson where it is: the voice stops mid-sentence and nothing more is drawn until it is resumed. */
  const pause = useCallback(() => {
    if (!busyNow.current) return;
    pausedNow.current = true;
    setPaused(true);
    synth()?.pause();
  }, []);

  /** Stop the reply; what is being drawn finishes at once. Questions that were waiting are dropped. */
  const stop = useCallback(() => {
    const waiting = new Set(queue.current.splice(0).map((x) => x.id));
    if (waiting.size) setLog((l) => l.filter((m) => !waiting.has(m.id)));
    stopRef.current?.abort();
    rec.current?.abort();
    synth()?.cancel();
    setCaption(null);
    resume();
    for (const w of work.current.values()) w.board.hurry();
  }, [resume]);

  // ----- listening: the student talks instead of typing -----
  const [listening, setListening] = useState(false);
  /** The words heard so far. */
  const [heard, setHeard] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const rec = useRef<Recognizer | null>(null);
  /**
   * Tap to talk; tap again (or just stop talking) and what was heard is sent.
   * The tutor holds still and stays quiet meanwhile, so its own voice is not
   * taken for the student's.
   */
  const listen = useCallback(() => {
    if (rec.current) return rec.current.stop();
    const Rec = recognizer();
    if (!Rec) return;
    const r = new Rec();
    const picked = synth()?.getVoices().find((v) => v.name === voiceNameNow.current);
    r.lang = (picked?.lang || navigator.language || "en-US").split("@")[0]!.replace("_", "-");
    r.continuous = false;
    r.interimResults = true;
    const held = busyNow.current && !pausedNow.current;
    let sure = "";
    let maybe = "";
    r.onresult = (e) => {
      sure = "";
      maybe = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        const best = res[0];
        if (!best) continue;
        if (!res.isFinal) maybe += best.transcript;
        else if (!(best.confidence > 0 && best.confidence < MIN_CONFIDENCE)) sure += best.transcript;
      }
      setHeard(`${sure}${maybe}`.trim());
    };
    r.onerror = (e) => {
      if (MIC_ERRORS[e.error]) setMicError(MIC_ERRORS[e.error]!);
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      setHeard("");
      if (held) resume();
      const said = `${sure}${maybe}`.trim();
      if (said) void send(said, { spoken: true });
    };
    setMicError(null);
    setHeard("");
    if (held) pause();
    else if (!busyNow.current) synth()?.cancel();
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch {
      if (held) resume();
      setMicError("The microphone could not be started.");
    }
  }, [pause, resume, send]);
  useEffect(() => () => rec.current?.abort(), []);

  const setVoice = useCallback((on: boolean) => {
    setVoiceState(on);
    try {
      localStorage.setItem(VOICE_KEY, on ? "on" : "off");
    } catch {
      /* private mode: just not remembered */
    }
    if (!on) {
      // The sentence being read is cut off; the lesson carries on in writing.
      synth()?.cancel();
      setCaption(null);
    }
  }, []);

  // Nothing keeps talking after the app is left.
  useEffect(() => () => void synth()?.cancel(), []);

  /** Take what a reply put on the board back off. */
  const undo = useCallback((id: string) => {
    const w = work.current.get(id);
    if (!w?.ids.length) return;
    w.board.remove(w.ids);
    work.current.delete(id);
    patch(id, (m) => ({ ...m, undone: true, drawn: 0 }));
  }, []);

  const clear = useCallback(() => {
    stop();
    history.current = [];
    work.current.clear();
    setLog([]);
  }, [stop]);

  return { log, busy, paused, voice, voices, voiceName, canSpeak: !!synth(), canListen: !!recognizer(), listening, heard, micError, listen, caption, send, stop, pause, resume, setVoice, setVoiceName, undo, clear };
}

export type Tutor = ReturnType<typeof useTutor>;
