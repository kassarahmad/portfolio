"""Archivi sicuri: i test costruiscono archivi davvero malevoli e verificano il rifiuto."""
import tarfile
import unittest
import zipfile
from pathlib import Path

from helpers import cleanup, temp_settings
from test_tools import make_ctx, run

from backend.app import archive as A
from backend.app.tools import builtin
from backend.app.tools.registry import ToolError


class ArchiveGuardsTest(unittest.TestCase):
    def setUp(self):
        self.s, self.tmp = temp_settings()
        self.wd = self.s.workspace_dir

    def tearDown(self):
        cleanup(self.tmp)

    # -- nomi pericolosi ---------------------------------------------------
    def test_rejects_zip_slip(self):
        z = self.wd / "slip.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("../../rubato.txt", "ciao")
        with self.assertRaises(A.ArchiveError) as cm:
            A.check(z)
        self.assertIn("..", str(cm.exception))

    def test_rejects_absolute_paths(self):
        z = self.wd / "assoluto.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("/etc/passwd", "x")
        with self.assertRaises(A.ArchiveError):
            A.check(z)

    def test_rejects_windows_drive_letters(self):
        z = self.wd / "unita.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("C:\\Windows\\system32\\evil.dll", "x")
        with self.assertRaises(A.ArchiveError) as cm:
            A.check(z)
        self.assertIn("unita", str(cm.exception))

    def test_rejects_backslash_traversal(self):
        z = self.wd / "backslash.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("..\\..\\fuori.txt", "x")
        with self.assertRaises(A.ArchiveError):
            A.check(z)

    def test_rejects_tar_symlinks(self):
        t = self.wd / "link.tar"
        with tarfile.open(t, "w") as f:
            info = tarfile.TarInfo("scorciatoia")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            f.addfile(info)
        with self.assertRaises(A.ArchiveError) as cm:
            A.read_entries(t)
        self.assertIn("collegamento", str(cm.exception))

    # -- bombe -------------------------------------------------------------
    def test_rejects_a_real_zip_bomb(self):
        z = self.wd / "bomba.zip"
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as f:
            f.writestr("grosso.bin", b"\0" * (60 * 1024 * 1024))   # 60 MB di zeri -> pochi KB
        self.assertLess(z.stat().st_size, 1024 * 1024)
        with self.assertRaises(A.ArchiveError) as cm:
            A.check(z)
        self.assertIn("bomb", str(cm.exception).lower())

    def test_small_archives_are_not_judged_by_ratio(self):
        """Un .txt ripetitivo da pochi KB comprime moltissimo ma non e' una bomba."""
        z = self.wd / "innocuo.zip"
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as f:
            f.writestr("note.txt", "riga ripetuta\n" * 20_000)
        info = A.check(z)
        self.assertGreater(info["ratio"], A.MAX_RATIO)     # il rapporto e' alto...
        self.assertEqual(info["files"], 1)                 # ...ma sotto 1 MB non viene rifiutato

    def test_rejects_a_declared_oversize_entry(self):
        z = self.wd / "gigante.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("piccolo.txt", "x")
        with self.assertRaises(A.ArchiveError):
            A.check(z, [A.Entry("enorme.bin", A.MAX_SINGLE + 1, 10, False)])

    def test_rejects_unknown_formats(self):
        with self.assertRaises(A.ArchiveError):
            A.kind(Path("archivio.rar"))

    def test_rejects_a_corrupt_archive(self):
        bad = self.wd / "rotto.zip"
        bad.write_bytes(b"non sono uno zip")
        with self.assertRaises(A.ArchiveError):
            A.read_entries(bad)

    # -- percorsi felici ---------------------------------------------------
    def test_round_trip_zip(self):
        (self.wd / "progetto").mkdir()
        (self.wd / "progetto" / "a.txt").write_text("primo", encoding="utf-8")
        (self.wd / "progetto" / "sotto").mkdir()
        (self.wd / "progetto" / "sotto" / "b.txt").write_text("secondo", encoding="utf-8")
        z = self.wd / "progetto.zip"
        rep = A.create([self.wd / "progetto"], z, self.wd)
        self.assertEqual(rep["files"], 2)

        out = A.extract(z, self.wd / "estratto")
        self.assertEqual(out["extracted"], 2)
        self.assertEqual((self.wd / "estratto" / "progetto" / "a.txt").read_text(encoding="utf-8"), "primo")
        self.assertEqual((self.wd / "estratto" / "progetto" / "sotto" / "b.txt").read_text(encoding="utf-8"),
                         "secondo")

    def test_round_trip_targz(self):
        (self.wd / "dati.txt").write_text("contenuto", encoding="utf-8")
        t = self.wd / "dati.tar.gz"
        with tarfile.open(t, "w:gz") as f:
            f.add(self.wd / "dati.txt", arcname="dati.txt")
        out = A.extract(t, self.wd / "da-tar")
        self.assertEqual((self.wd / "da-tar" / "dati.txt").read_text(encoding="utf-8"), "contenuto")
        self.assertEqual(out["extracted"], 1)

    def test_create_refuses_an_empty_selection(self):
        (self.wd / "vuota").mkdir()
        with self.assertRaises(A.ArchiveError):
            A.create([self.wd / "vuota"], self.wd / "x.zip", self.wd)

    def test_nothing_is_written_when_a_single_entry_is_bad(self):
        z = self.wd / "misto.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("buono.txt", "ok")
            f.writestr("../cattivo.txt", "no")
        dest = self.wd / "mai"
        with self.assertRaises(A.ArchiveError):
            A.extract(z, dest)
        self.assertFalse((dest / "buono.txt").exists())


class ArchiveToolsTest(unittest.TestCase):
    """Gli strumenti come li chiamano gli agenti."""

    def setUp(self):
        self.s, self.tmp = temp_settings()
        self.ctx, self.approvals = make_ctx(self.s)
        self.wd = self.s.workspace_dir
        (self.wd / "doc.txt").write_text("contenuto di prova", encoding="utf-8")

    def tearDown(self):
        cleanup(self.tmp)

    def test_create_inspect_extract(self):
        out = run(builtin.create_archive(self.ctx, paths=["doc.txt"], output="pacco.zip"))
        self.assertIn("Archivio creato", out)

        listing = run(builtin.inspect_archive(self.ctx, path="pacco.zip"))
        self.assertIn("doc.txt", listing)
        self.assertIn("Nessun problema rilevato", listing)

        done = run(builtin.extract_archive(self.ctx, path="pacco.zip", destination="aperto"))
        self.assertIn("Estratti 1 file", done)
        self.assertEqual((self.wd / "aperto" / "doc.txt").read_text(encoding="utf-8"), "contenuto di prova")
        self.assertTrue(any(t == "extract_archive" for t, _ in self.approvals), self.approvals)

    def test_inspect_reports_a_dangerous_archive_without_raising(self):
        z = self.wd / "cattivo.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("../fuori.txt", "x")
        listing = run(builtin.inspect_archive(self.ctx, path="cattivo.zip"))
        self.assertIn("ARCHIVIO RIFIUTATO", listing)

    def test_extract_refuses_a_dangerous_archive(self):
        z = self.wd / "cattivo.zip"
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("../fuori.txt", "x")
        with self.assertRaises(ToolError):
            run(builtin.extract_archive(self.ctx, path="cattivo.zip"))

    def test_extracting_is_refused_without_approval(self):
        ctx, _ = make_ctx(self.s, approve=False)
        run(builtin.create_archive(self.ctx, paths=["doc.txt"], output="p.zip"))
        with self.assertRaises(ToolError):
            run(builtin.extract_archive(ctx, path="p.zip"))

    def test_cannot_archive_outside_the_workspace(self):
        with self.assertRaises(ToolError):
            run(builtin.create_archive(self.ctx, paths=["../../etc/hosts"], output="fuga.zip"))

    def test_cannot_extract_outside_the_workspace(self):
        run(builtin.create_archive(self.ctx, paths=["doc.txt"], output="p.zip"))
        with self.assertRaises(ToolError):
            run(builtin.extract_archive(self.ctx, path="p.zip", destination="../../tmp/ovunque"))

    def test_registers_the_archive_among_the_artifacts(self):
        run(builtin.create_archive(self.ctx, paths=["doc.txt"], output="art.zip"))
        self.assertTrue(any(t.endswith("art.zip") for t in self.ctx.run.touched), self.ctx.run.touched)

    def test_accepts_a_single_path_as_a_string(self):
        out = run(builtin.create_archive(self.ctx, paths="doc.txt", output="uno.zip"))
        self.assertIn("1 file", out)

    def test_adds_the_zip_extension(self):
        run(builtin.create_archive(self.ctx, paths=["doc.txt"], output="senza"))
        self.assertTrue((self.wd / "senza.zip").is_file())

    def test_missing_archive_is_reported(self):
        with self.assertRaises(ToolError):
            run(builtin.inspect_archive(self.ctx, path="non-esiste.zip"))

    def test_the_tools_are_declared_in_the_registry(self):
        r = builtin.build_registry()
        for name in ("create_archive", "inspect_archive", "extract_archive"):
            self.assertIn(name, r.tools)


if __name__ == "__main__":
    unittest.main()
