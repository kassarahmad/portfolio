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
"""


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
        for table in ("conversations", "messages", "runs", "memories", "documents", "chunks"):
            out[table] = self.one(f"SELECT COUNT(*) AS n FROM {table}")["n"]
        out["size_bytes"] = self.path.stat().st_size if self.path.exists() else 0
        wal = self.path.with_name(self.path.name + "-wal")
        if wal.exists():
            out["size_bytes"] += wal.stat().st_size
        out["path"] = str(self.path)
        return out

    # -- conversazioni ------------------------------------------------------
    def create_conversation(self, title: str = "Nuova conversazione") -> dict:
        cid, t = new_id(), now()
        self.execute("INSERT INTO conversations VALUES (?,?,?,?)", (cid, title[:120], t, t))
        return {"id": cid, "title": title[:120], "created_at": t, "updated_at": t}

    def list_conversations(self, q: str = "") -> list[dict]:
        if q:
            like = f"%{q}%"
            return self.query(
                """SELECT DISTINCT c.* FROM conversations c
                   LEFT JOIN messages m ON m.conversation_id = c.id
                   WHERE c.title LIKE ? OR m.content LIKE ?
                   ORDER BY c.updated_at DESC LIMIT 200""", (like, like))
        return self.query("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200")

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
