import type { ProjectState } from './types'

const DB_NAME = 'booklet-tool'
const DB_VERSION = 1
const STORE = 'projects'
const DRAFT_KEY = '__draft__'

interface Draft extends ProjectState {
  /** 源 PDF 字节，便于刷新后继续工作（仅本地 IndexedDB） */
  pdfBytes?: ArrayBuffer
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const r = fn(t.objectStore(STORE))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export async function saveProject(key: string, state: ProjectState): Promise<void> {
  const db = await openDb()
  try {
    await tx(db, 'readwrite', (s) => s.put(jsonClone(state), key))
  } finally {
    db.close()
  }
}

/** IndexedDB 不能结构化克隆 Vue 的响应式 Proxy，统一深拷贝为普通对象 */
function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export async function loadProject(key: string): Promise<ProjectState | undefined> {
  const db = await openDb()
  try {
    return (await tx(db, 'readonly', (s) => s.get(key))) as ProjectState | undefined
  } finally {
    db.close()
  }
}

export async function listProjects(): Promise<Array<{ key: string; state: ProjectState }>> {
  const db = await openDb()
  try {
    const keys = (await tx(db, 'readonly', (s) => s.getAllKeys())) as IDBValidKey[]
    const out: Array<{ key: string; state: ProjectState }> = []
    for (const k of keys) {
      if (k === DRAFT_KEY) continue
      const st = (await tx(db, 'readonly', (s) => s.get(k))) as ProjectState
      out.push({ key: String(k), state: st })
    }
    return out.sort((a, b) => b.state.updatedAt - a.state.updatedAt)
  } finally {
    db.close()
  }
}

export async function deleteProject(key: string): Promise<void> {
  const db = await openDb()
  try {
    await tx(db, 'readwrite', (s) => s.delete(key))
  } finally {
    db.close()
  }
}

export async function saveDraft(draft: Draft): Promise<void> {
  const db = await openDb()
  try {
    // ArrayBuffer 需保留，不能走 JSON：先复制普通字段再附加字节
    const { pdfBytes, ...rest } = draft
    const payload: Draft = jsonClone(rest)
    if (pdfBytes) payload.pdfBytes = pdfBytes.slice(0)
    await tx(db, 'readwrite', (s) => s.put(payload, DRAFT_KEY))
  } finally {
    db.close()
  }
}

export async function loadDraft(): Promise<Draft | undefined> {
  const db = await openDb()
  try {
    return (await tx(db, 'readonly', (s) => s.get(DRAFT_KEY))) as Draft | undefined
  } finally {
    db.close()
  }
}

export async function clearDraftPdf(): Promise<void> {
  const db = await openDb()
  try {
    const d = (await tx(db, 'readonly', (s) => s.get(DRAFT_KEY))) as Draft | undefined
    if (d) {
      delete d.pdfBytes
      await tx(db, 'readwrite', (s) => s.put(d, DRAFT_KEY))
    }
  } finally {
    db.close()
  }
}
