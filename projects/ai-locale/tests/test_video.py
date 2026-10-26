"""Montaggio video locale: produce davvero un MP4 e lo misura con ffprobe.

Se ffmpeg non c'e', i test si saltano invece di dichiarare un successo finto.
"""
import unittest
from pathlib import Path

from helpers import cleanup, temp_settings
from test_tools import make_ctx, run

from backend.app import video as V
from backend.app.tools import builtin
from backend.app.tools.registry import ToolError

HAS_FFMPEG = bool(V.ffmpeg_exe())
HAS_FFPROBE = bool(V.ffprobe_exe())   # facoltativo: senza, si misura con ffmpeg


class PureHelpersTest(unittest.TestCase):
    """Parti che non richiedono ffmpeg."""

    def test_srt_and_vtt_use_the_right_separators(self):
        srt, vtt = V.build_subtitles([(0.0, 1.5, "primo"), (1.5, 3.25, "secondo")])
        self.assertIn("00:00:00,000 --> 00:00:01,500", srt)
        self.assertIn("00:00:01,500 --> 00:00:03,250", srt)
        self.assertTrue(vtt.startswith("WEBVTT"))
        self.assertIn("00:00:01.500 --> 00:00:03.250", vtt)
        self.assertNotIn(",", vtt.splitlines()[2])      # il VTT usa il punto

    def test_timestamps_cross_the_minute_and_hour(self):
        self.assertEqual(V.ts_srt(61.5), "00:01:01,500")
        self.assertEqual(V.ts_srt(3661.25), "01:01:01,250")

    def test_chunk_words_splits_on_punctuation_and_length(self):
        parts = V.chunk_words("Una frase breve. Poi un'altra parte un po' piu' lunga da spezzare")
        self.assertTrue(all(len(p.split()) <= 5 for p in parts), parts)
        self.assertEqual(" ".join(parts).split(),
                         "Una frase breve. Poi un'altra parte un po' piu' lunga da spezzare".split())

    def test_cover_crops_to_the_exact_frame(self):
        from PIL import Image
        out = V.cover(Image.new("RGB", (400, 100), (1, 2, 3)), 200, 200)
        self.assertEqual(out.size, (200, 200))

    def test_slug_is_safe_for_filenames(self):
        self.assertEqual(V.slug("Pizzeria da Gino! 2026"), "pizzeria-da-gino-2026")
        self.assertTrue(V.slug("///"))


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg non disponibile in questo ambiente")
class MontageTest(unittest.TestCase):
    def setUp(self):
        self.s, self.tmp = temp_settings()
        self.studio = V.VideoStudio(self.s)
        self.wd = self.s.workspace_dir

    def tearDown(self):
        cleanup(self.tmp)

    def test_status_reports_ffmpeg(self):
        st = self.studio.status()
        self.assertTrue(st["ffmpeg"])
        self.assertIsNone(st["hint"])

    def test_makes_a_real_vertical_video_with_subtitle_files(self):
        from PIL import Image
        bg = self.wd / "sfondo.png"
        Image.new("RGB", (1600, 900), (30, 60, 100)).save(bg)
        out = self.wd / "corto.mp4"
        rep = run(self.studio.make(
            scenes=[{"narration": "Prima scena con immagine vera.", "image": str(bg), "seconds": 2},
                    {"narration": "Seconda scena, cartoncino disegnato.", "seconds": 1.5}],
            out_path=out, workdir=self.wd, aspect="9:16", title="Prova"))

        self.assertTrue(out.is_file())
        self.assertEqual(rep["scenes_used"], 2)
        self.assertEqual((rep["width"], rep["height"]), (1080, 1920))

        m = rep["measured"]                                  # misura reale, non dichiarata
        self.assertAlmostEqual(m["seconds"], 3.5, delta=0.5)
        self.assertEqual((m["width"], m["height"]), (1080, 1920))
        self.assertEqual(m["video_codec"], "h264")
        self.assertEqual(m["audio_codec"], "aac")
        self.assertGreater(m["size_bytes"], 10_000)

        srt = out.with_suffix(".srt")
        vtt = out.with_suffix(".vtt")
        self.assertTrue(srt.is_file() and vtt.is_file())
        self.assertIn("Prima scena", srt.read_text(encoding="utf-8"))
        # i tempi sono globali: il sottotitolo della 2a scena inizia dopo la 1a
        self.assertRegex(srt.read_text(encoding="utf-8"), r"00:00:0[2-9]")

    def test_horizontal_aspect_changes_the_frame(self):
        out = self.wd / "largo.mp4"
        rep = run(self.studio.make(scenes=[{"narration": "Scena unica.", "seconds": 1.2}],
                                   out_path=out, workdir=self.wd, aspect="16:9"))
        self.assertEqual((rep["measured"]["width"], rep["measured"]["height"]), (1920, 1080))

    def test_measuring_works_without_ffprobe(self):
        """Su Windows imageio-ffmpeg porta solo ffmpeg: la misura deve funzionare lo stesso."""
        out = self.wd / "senza-ffprobe.mp4"
        run(self.studio.make(scenes=[{"narration": "Una scena.", "seconds": 1.2}],
                             out_path=out, workdir=self.wd, aspect="16:9"))
        vero = V.ffprobe_exe
        V.ffprobe_exe = lambda: None
        try:
            info = run(self.studio.probe(out))
        finally:
            V.ffprobe_exe = vero
        self.assertEqual(info["measured_with"], "ffmpeg")
        self.assertEqual((info["width"], info["height"]), (1920, 1080))
        self.assertAlmostEqual(info["seconds"], 1.2, delta=0.4)
        self.assertEqual(info["video_codec"], "h264")

    def test_probe_measures_an_existing_file(self):
        out = self.wd / "misura.mp4"
        run(self.studio.make(scenes=[{"narration": "Una scena.", "seconds": 1.0}],
                             out_path=out, workdir=self.wd))
        info = run(self.studio.probe(out))
        self.assertGreater(info["seconds"], 0.5)
        self.assertEqual(info["fps"], 30.0)

    def test_missing_image_is_reported_not_hidden(self):
        out = self.wd / "mancante.mp4"
        rep = run(self.studio.make(
            scenes=[{"narration": "Scena con immagine inesistente.", "image": str(self.wd / "boh.png"),
                     "seconds": 1.0}], out_path=out, workdir=self.wd))
        self.assertTrue(out.is_file())
        self.assertTrue(any("non trovata" in n for n in rep["notes"]), rep["notes"])

    def test_refuses_an_empty_scene_list(self):
        with self.assertRaises(ValueError):
            run(self.studio.make(scenes=[], out_path=self.wd / "x.mp4", workdir=self.wd))

    def test_refuses_too_many_scenes(self):
        many = [{"narration": "a", "seconds": 1.0}] * (V.MAX_SCENES + 1)
        with self.assertRaises(ValueError):
            run(self.studio.make(scenes=many, out_path=self.wd / "x.mp4", workdir=self.wd))

    def test_leaves_no_temporary_folder_behind(self):
        out = self.wd / "pulizia.mp4"
        run(self.studio.make(scenes=[{"narration": "Scena.", "seconds": 1.0}], out_path=out, workdir=self.wd))
        self.assertFalse((self.wd / ".video").exists() and any((self.wd / ".video").iterdir()))


@unittest.skipUnless(HAS_FFMPEG, "ffmpeg non disponibile in questo ambiente")
class VideoToolsTest(unittest.TestCase):
    """Gli strumenti come li chiamano davvero gli agenti."""

    def setUp(self):
        self.s, self.tmp = temp_settings()
        self.ctx, self.approvals = make_ctx(self.s, video=V.VideoStudio(self.s), voice=None)
        self.registry = builtin.build_registry()

    def tearDown(self):
        cleanup(self.tmp)

    def test_make_video_and_video_info_agree(self):
        out = run(builtin.make_video(self.ctx, scenes=[{"narration": "Scena di prova.", "seconds": 1.5}],
                                     output="clip.mp4", narrate=False))
        self.assertIn("Video montato", out)
        self.assertIn("misurata con ffprobe", out)
        info = run(builtin.video_info(self.ctx, path="clip.mp4"))
        self.assertIn("1080x1920", info)
        self.assertIn("h264", info)

    def test_accepts_scenes_as_a_json_string(self):
        out = run(builtin.make_video(self.ctx, scenes='[{"narration": "Da stringa.", "seconds": 1.0}]',
                                     output="stringa.mp4", narrate=False))
        self.assertIn("Video montato", out)

    def test_adds_the_mp4_extension(self):
        run(builtin.make_video(self.ctx, scenes=[{"narration": "x", "seconds": 1.0}],
                               output="senza_estensione", narrate=False))
        self.assertTrue((self.s.workspace_dir / "senza_estensione.mp4").is_file())

    def test_registers_the_file_among_the_artifacts(self):
        run(builtin.make_video(self.ctx, scenes=[{"narration": "x", "seconds": 1.0}],
                               output="artefatto.mp4", narrate=False))
        touched = self.ctx.run.touched
        self.assertTrue(any(t.endswith("artefatto.mp4") for t in touched), touched)
        self.assertTrue(any(t.endswith(".srt") for t in touched), touched)

    def test_overwriting_asks_for_approval(self):
        run(builtin.make_video(self.ctx, scenes=[{"narration": "x", "seconds": 1.0}],
                               output="due.mp4", narrate=False))
        run(builtin.make_video(self.ctx, scenes=[{"narration": "y", "seconds": 1.0}],
                               output="due.mp4", narrate=False))
        self.assertTrue(any(t == "make_video" for t, _ in self.approvals), self.approvals)

    def test_refuses_to_write_outside_the_workspace(self):
        with self.assertRaises(ToolError):
            run(builtin.make_video(self.ctx, scenes=[{"narration": "x"}], output="../../fuori.mp4",
                                   narrate=False))

    def test_refuses_an_image_outside_the_workspace(self):
        with self.assertRaises(ToolError):
            run(builtin.make_video(self.ctx, scenes=[{"narration": "x", "image": "../../etc/hosts"}],
                                   output="x.mp4", narrate=False))

    def test_rejects_malformed_scenes(self):
        with self.assertRaises(ToolError):
            run(builtin.make_video(self.ctx, scenes="non json", output="x.mp4"))
        with self.assertRaises(ToolError):
            run(builtin.make_video(self.ctx, scenes=[], output="x.mp4"))

    def test_video_info_refuses_a_missing_file(self):
        with self.assertRaises(ToolError):
            run(builtin.video_info(self.ctx, path="non-esiste.mp4"))

    def test_the_tools_are_declared_in_the_registry(self):
        for name in ("make_video", "video_info"):
            self.assertIn(name, self.registry.tools)

    def test_without_a_studio_the_tool_says_so_instead_of_crashing(self):
        ctx, _ = make_ctx(self.s)                      # nessun VideoStudio nel contesto
        with self.assertRaises(ToolError):
            run(builtin.make_video(ctx, scenes=[{"narration": "x"}], output="x.mp4"))


if __name__ == "__main__":
    unittest.main()
