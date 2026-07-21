import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  orderBy,
  type Firestore,
} from "firebase/firestore";
import type { Student, LessonEntry, MatchEntry } from "./types.ts";
import { FIREBASE_CONFIG } from "./firebase-config.ts";

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (FIREBASE_CONFIG) {
  app = initializeApp(FIREBASE_CONFIG);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
}

export function isFirebaseReady(): boolean {
  return app !== null;
}

function requireAuth(): Auth {
  if (!authInstance) throw new Error("Firebase が初期化されていません。設定を保存してください。");
  return authInstance;
}

function requireDb(): Firestore {
  if (!dbInstance) throw new Error("Firebase が初期化されていません。設定を保存してください。");
  return dbInstance;
}

export function signInWithGoogle(): Promise<User> {
  return signInWithPopup(requireAuth(), new GoogleAuthProvider()).then((r) => r.user);
}

export function signOutCoach(): Promise<void> {
  return signOut(requireAuth());
}

export function watchAuthState(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(requireAuth(), cb);
}

function studentDoc(studentId: string) {
  return doc(requireDb(), "students", studentId);
}

function studentsCol() {
  return collection(requireDb(), "students");
}

function lessonsCol(studentId: string) {
  return collection(requireDb(), "students", studentId, "lessons");
}

function matchesCol(studentId: string) {
  return collection(requireDb(), "students", studentId, "matches");
}

export async function createStudent(name: string): Promise<Student> {
  const now = Date.now();
  const ref = await addDoc(studentsCol(), {
    name,
    focusPoints: "",
    createdAt: now,
    updatedAt: now,
  });
  return { id: ref.id, name, focusPoints: "", createdAt: now, updatedAt: now };
}

export async function listStudents(): Promise<Student[]> {
  const snap = await getDocs(query(studentsCol(), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, "id">) }));
}

export async function getStudent(studentId: string): Promise<Student | null> {
  const snap = await getDoc(studentDoc(studentId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Student, "id">) };
}

export async function updateFocusPoints(studentId: string, focusPoints: string): Promise<void> {
  await updateDoc(studentDoc(studentId), { focusPoints, updatedAt: Date.now() });
}

export async function addLesson(studentId: string, transcript: string, summary: string): Promise<void> {
  const now = Date.now();
  await addDoc(lessonsCol(studentId), { transcript, summary, createdAt: now });
  await updateDoc(studentDoc(studentId), { updatedAt: now });
}

export async function listLessons(studentId: string): Promise<LessonEntry[]> {
  const snap = await getDocs(query(lessonsCol(studentId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LessonEntry, "id">) }));
}

export async function addMatch(
  studentId: string,
  data: { matchDate: string; opponent: string; result: string; reflection: string },
): Promise<void> {
  await addDoc(matchesCol(studentId), { ...data, createdAt: Date.now() });
}

export async function listMatches(studentId: string): Promise<MatchEntry[]> {
  const snap = await getDocs(query(matchesCol(studentId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MatchEntry, "id">) }));
}
