"""Accesso a SQLite: conversazioni, run degli agenti, memoria, documenti, impostazioni."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import TUNABLES, coerce_tunable

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    run_id TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at REAL NOT NULL,
    finished_at REAL,
    error TEXT,
    stats TEXT
);
CREATE TABLE IF NOT EXISTS run_events (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    ts REAL NOT NULL,
    PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection TEXT NOT NULL,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    pages INTEGER,
    chunks INTEGER NOT NULL DEFAULT 0,
    embedded INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    page INTEGER,
    text TEXT NOT NULL,
    embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    run_id TEXT,
    agent TEXT,
    tool TEXT NOT NULL,
    args TEXT,
    ok INTEGER NOT NULL,
    error TEXT
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'amber',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    run_id TEXT,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    versions INTEGER NOT NULL DEFAULT 1,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_conv ON artifacts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_proj ON artifacts(project_id);
"""

PROJECT_COLORS = ("amber", "sage", "sky", "rose", "violet", "slate", "teal", "clay")


def now() -> float:
    return time.time()


def new_id() -> str:
    return uuid.uuid4().hex[:16]


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._conn: sqlite3.Connection | None = None
        self.open()

    # -- connessione -------------------------------------------------------
    def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript(SCHEMA)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(messages)").fetchall()}
        if "attachments" not in cols:  # migrazione dalla versione precedente
            conn.execute("ALTER TABLE messages ADD COLUMN attachments TEXT")
        ccols = {r[1] for r in conn.execute("PRAGMA table_info(conversations)").fetchall()}
        if "project_id" not in ccols:  # migrazione: conversazioni nei progetti
            conn.execute("ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL")
        self._conn = conn

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError("database chiuso")
        return self._conn

    def execute(self, sql: str, params: tuple | list = ()) -> sqlite3.Cursor:
        with self._lock:
            return self.conn.execute(sql, params)

    def query(self, sql: str, params: tuple | list = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple | list = ()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def backup_to(self, target: Path) -> None:
        with self._lock:
            dst = sqlite3.connect(target)
            try:
                self.conn.backup(dst)
            finally:
                dst.close()

    def stats(self) -> dict:
        out = {}
        for table in ("conversations", "messages", "runs", "memories", "documents", "chunks", "projects", "artifacts"):
            out[table] = self.one(f"SELECT COUNT(*) AS n FROM {table}")["n"]
        out["size_bytes"] = self.path.stat().st_size if self.path.exists() else 0
        wal = self.path.with_name(self.path.name + "-wal")
        if wal.exists():
            out["size_bytes"] += wal.stat().st_size
        out["path"] = str(self.path)
        return out

    # -- conversazioni ------------------------------------------------------
    def create_conversation(self, title: str = "Nuova conversazione", project_id: str | None = None) -> dict:
        cid, t = new_id(), now()
        if project_id and not self.get_project(project_id):
            project_id = None
        self.execute("INSERT INTO conversations (id, title, created_at, updated_at, project_id) VALUES (?,?,?,?,?)",
                     (cid, title[:120], t, t, project_id))
        if project_id:
            self.touch_project(project_id)
        return {"id": cid, "title": title[:120], "created_at": t, "updated_at": t, "project_id": project_id}

    def list_conversations(self, q: str = "", project_id: str | None = None) -> list[dict]:
        where, params = [], []
        if q:
            like = f"%{q}%"
            where.append("(c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id "
                         "AND m.content LIKE ?))")
            params += [like, like]
        if project_id:
            where.append("c.project_id = ?")
            params.append(project_id)
        sql = ("SELECT c.*, (SELECT COUNT(*) FROM artifacts a WHERE a.conversation_id = c.id) AS artifacts "
               "FROM conversations c" + (" WHERE " + " AND ".join(where) if where else "") +
               " ORDER BY c.updated_at DESC LIMIT 300")
        return self.query(sql, params)

    def set_conversation_project(self, cid: str, project_id: str | None) -> None:
        self.execute("UPDATE conversations SET project_id=? WHERE id=?", (project_id, cid))
        self.execute("UPDATE artifacts SET project_id=? WHERE conversation_id=?", (project_id, cid))

    # -- progetti -------------------------------------------------------------
    def create_project(self, name: str, description: str = "", instructions: str = "", color: str = "amber") -> dict:
        pid, t = new_id(), now()
        color = color if color in PROJECT_COLORS else "amber"
        self.execute("INSERT INTO projects VALUES (?,?,?,?,?,?,?)",
                     (pid, name[:80], description[:500], instructions[:8000], color, t, t))
        return self.get_project(pid)

    def get_project(self, pid: str) -> dict | None:
        return self.one("SELECT * FROM projects WHERE id=?", (pid,))

    def list_projects(self) -> list[dict]:
        return self.query(
            """SELECT p.*,
                 (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id) AS conversations,
                 (SELECT COUNT(*) FROM artifacts a WHERE a.project_id = p.id) AS artifacts
               FROM projects p ORDER BY p.updated_at DESC""")

    def update_project(self, pid: str, **fields: Any) -> dict | None:
        allowed = {"name": 80, "description": 500, "instructions": 8000, "color": 20}
        sets, params = [], []
        for k, v in fields.items():
            if k not in allowed or v is None:
                continue
            v = str(v)[:allowed[k]]
            if k == "color" and v not in PROJECT_COLORS:
                continue
            if k == "name" and not v.strip():
                continue
            sets.append(f"{k}=?")
            params.append(v)
        if sets:
            self.execute(f"UPDATE projects SET {', '.join(sets)}, updated_at=? WHERE id=?", (*params, now(), pid))
        return self.get_project(pid)

    def touch_project(self, pid: str) -> None:
        self.execute("UPDATE projects SET updated_at=? WHERE id=?", (now(), pid))

    def delete_project(self, pid: str) -> None:
        # le conversazioni e gli artefatti restano, fuori dal progetto
        self.execute("UPDATE conversations SET project_id=NULL WHERE project_id=?", (pid,))
        self.execute("UPDATE artifacts SET project_id=NULL WHERE project_id=?", (pid,))
        self.execute("DELETE FROM projects WHERE id=?", (pid,))

    # -- artefatti ------------------------------------------------------------
    def upsert_artifact(self, *, path: str, title: str, kind: str, size: int, conversation_id: str | None,
                        project_id: str | None, run_id: str | None) -> dict:
        t = now()
        row = self.one("SELECT * FROM artifacts WHERE path=? AND conversation_id IS ?", (path, conversation_id))
        if row:
            self.execute("UPDATE artifacts SET size=?, kind=?, run_id=?, versions=versions+1, updated_at=?, "
                         "project_id=? WHERE id=?", (size, kind, run_id, t, project_id, row["id"]))
            return self.get_artifact(row["id"])
        cur = self.execute(
            "INSERT INTO artifacts (conversation_id, project_id, run_id, path, title, kind, size, versions, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)",
            (conversation_id, project_id, run_id, path, title[:200], kind, size, t, t))
        return self.get_artifact(cur.lastrowid)

    def get_artifact(self, aid: int) -> dict | None:
        return self.one("""SELECT a.*, c.title AS conversation_title, p.name AS project_name, p.color AS project_color
                           FROM artifacts a LEFT JOIN conversations c ON c.id = a.conversation_id
                           LEFT JOIN projects p ON p.id = a.project_id WHERE a.id=?""", (aid,))

    def list_artifacts(self, *, conversation_id: str | None = None, project_id: str | None = None,
                       kind: str | None = None, q: str = "", limit: int = 300) -> list[dict]:
        where, params = [], []
        if conversation_id:
            where.append("a.conversation_id=?")
            params.append(conversation_id)
        if project_id:
            where.append("a.project_id=?")
            params.append(project_id)
        if kind:
            where.append("a.kind=?")
            params.append(kind)
        if q:
            where.append("(a.title LIKE ? OR a.path LIKE ?)")
            params += [f"%{q}%", f"%{q}%"]
        sql = ("""SELECT a.*, c.title AS conversation_title, p.name AS project_name, p.color AS project_color
                  FROM artifacts a LEFT JOIN conversations c ON c.id = a.conversation_id
                  LEFT JOIN projects p ON p.id = a.project_id""" +
               (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY a.updated_at DESC LIMIT ?")
        return self.query(sql, (*params, limit))

    def delete_artifact(self, aid: int) -> bool:
        return self.execute("DELETE FROM artifacts WHERE id=?", (aid,)).rowcount > 0

    def get_conversation(self, cid: str) -> dict | None:
        return self.one("SELECT * FROM conversations WHERE id=?", (cid,))

    def rename_conversation(self, cid: str, title: str) -> None:
        self.execute("UPDATE conversations SET title=?, updated_at=? WHERE id=?", (title[:120], now(), cid))

    def delete_conversation(self, cid: str) -> None:
        self.execute("DELETE FROM conversations WHERE id=?", (cid,))

    def add_message(self, cid: str, role: str, content: str, run_id: str | None = None,
                    attachments: list[str] | None = None) -> int:
        t = now()
        cur = self.execute(
            "INSERT INTO messages (conversation_id, role, content, run_id, created_at, attachments) VALUES (?,?,?,?,?,?)",
            (cid, role, content, run_id, t, json.dumps(attachments) if attachments else None))
        self.execute("UPDATE conversations SET updated_at=? WHERE id=?", (t, cid))
        return cur.lastrowid

    def messages(self, cid: str, limit: int | None = None) -> list[dict]:
        if limit:
            rows = list(reversed(self.query(
                "SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?", (cid, limit))))
        else:
            rows = self.query("SELECT * FROM messages WHERE conversation_id=? ORDER BY id", (cid,))
        for r in rows:
            r["attachments"] = json.loads(r["attachments"]) if r.get("attachments") else []
        return rows

    # -- audit ----------------------------------------------------------------
    def add_audit(self, run_id: str | None, agent: str, tool: str, args: str, ok: bool, error: str = "") -> None:
        self.execute("INSERT INTO audit (ts, run_id, agent, tool, args, ok, error) VALUES (?,?,?,?,?,?,?)",
                     (now(), run_id, agent, tool, args, 1 if ok else 0, error))

    def audit_log(self, limit: int = 200) -> list[dict]:
        return self.query("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,))

    # -- run ----------------------------------------------------------------
    def create_run(self, run_id: str, cid: str) -> None:
        self.execute("INSERT INTO runs (id, conversation_id, status, started_at) VALUES (?,?,?,?)",
                     (run_id, cid, "running", now()))

    def finish_run(self, run_id: str, status: str, error: str | None = None, stats: dict | None = None) -> None:
        self.execute("UPDATE runs SET status=?, finished_at=?, error=?, stats=? WHERE id=?",
                     (status, now(), error, json.dumps(stats or {}), run_id))

    def get_run(self, run_id: str) -> dict | None:
        r = self.one("SELECT * FROM runs WHERE id=?", (run_id,))
        if r and r.get("stats"):
            r["stats"] = json.loads(r["stats"])
        return r

    def add_event(self, run_id: str, seq: int, etype: str, data: dict) -> None:
        self.execute("INSERT INTO run_events VALUES (?,?,?,?,?)",
                     (run_id, seq, etype, json.dumps(data, ensure_ascii=False), now()))

    def events(self, run_id: str) -> list[dict]:
        rows = self.query("SELECT * FROM run_events WHERE run_id=? ORDER BY seq", (run_id,))
        return [{"seq": r["seq"], "type": r["type"], "data": json.loads(r["data"]), "ts": r["ts"]} for r in rows]

    def mark_interrupted_runs(self) -> int:
        cur = self.execute("UPDATE runs SET status='interrupted', finished_at=? WHERE status='running'", (now(),))
        return cur.rowcount

    # -- memoria ------------------------------------------------------------
    def list_memories(self) -> list[dict]:
        return self.query("SELECT * FROM memories ORDER BY updated_at DESC")

    def add_memory(self, content: str, source: str = "user") -> dict:
        t = now()
        cur = self.execute("INSERT INTO memories (content, source, created_at, updated_at) VALUES (?,?,?,?)",
                           (content.strip()[:2000], source, t, t))
        return self.one("SELECT * FROM memories WHERE id=?", (cur.lastrowid,))

    def update_memory(self, mid: int, content: str) -> bool:
        cur = self.execute("UPDATE memories SET content=?, updated_at=? WHERE id=?", (content.strip()[:2000], now(), mid))
        return cur.rowcount > 0

    def delete_memory(self, mid: int) -> bool:
        return self.execute("DELETE FROM memories WHERE id=?", (mid,)).rowcount > 0

    # -- impostazioni -------------------------------------------------------
    def get_tunables(self) -> dict[str, Any]:
        values = {k: v[0] for k, v in TUNABLES.items()}
        for row in self.query("SELECT key, value FROM settings"):
            if row["key"] in TUNABLES:
                try:
                    values[row["key"]] = coerce_tunable(row["key"], json.loads(row["value"]))
                except (ValueError, TypeError):
                    pass
        return values

    def set_tunables(self, updates: dict[str, Any]) -> dict[str, Any]:
        for key, value in updates.items():
            v = coerce_tunable(key, value)  # KeyError se la chiave non esiste
            self.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                         "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(v)))
        return self.get_tunables()
