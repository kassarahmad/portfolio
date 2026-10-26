"""Generazione locale: percorsi, modelli mancanti, cancello della VRAM.

Qui non c'e' una GPU ne' sd-cli, quindi il motore viene simulato: si verifica che
i comandi costruiti siano giusti e che il modello di chat venga sempre rimesso.
La prova su hardware vero si fa sul PC, con i modelli scaricati.
"""
import asyncio
import re
import unittest
from pathlib import Path

from helpers import cleanup, temp_settings
from test_tools import make_ctx, run

from backend.app import genera as G
from backend.app.tools import builtin
from backend.app.tools.registry import ToolError


def prepara(settings, *, motore=True, immagini=True, video=True):
    """Crea finti file di modello, cosi' lo Studio li trova come sul PC vero."""
    tools = settings.models_dir.parent / "tools" / "sd"
    gen = settings.models_dir / "gen"
    for d in (tools, gen / "diffusion", gen / "vae", gen / "encoder"):
        d.mkdir(parents=True, exist_ok=True)
    if motore:
        (tools / "sd-cli.exe").write_bytes(b"")
    if immagini:
        (gen / "diffusion" / "z_image_turbo-Q4_K.gguf").write_bytes(b"")
        (gen / "vae" / "ae.safetensors").write_bytes(b"")
        (gen / "encoder" / "Qwen3-4B-Instruct-2507-Q4_K_M.gguf").write_bytes(b"")
    if video:
        (gen / "diffusion" / "Wan2.2-TI2V-5B-Q6_K.gguf").write_bytes(b"")
        (gen / "vae" / "wan2.2_vae.safetensors").write_bytes(b"")
        (gen / "encoder" / "umt5-xxl-encoder-Q5_K_M.gguf").write_bytes(b"")


class StatoTest(unittest.TestCase):
    def setUp(self):
        self.s, self.tmp = temp_settings()

    def tearDown(self):
        cleanup(self.tmp)

    def test_without_the_engine_it_says_what_to_run(self):
        st = G.Studio(self.s).status()
        self.assertFalse(st["engine"])
        self.assertIn("INSTALLA-GENERAZIONE", st["hint"])

    def test_it_names_exactly_which_files_are_missing(self):
        prepara(self.s, immagini=False)
        st = G.Studio(self.s).status()
        self.assertTrue(st["engine"])
        self.assertFalse(st["images"])
        self.assertTrue(st["videos"])
        self.assertEqual(len(st["missing_images"]), 3)
        self.assertEqual(st["missing_videos"], [])
        self.assertIn("immagini", st["hint"])            # dice quale meta' manca...
        self.assertNotIn("video (", st["hint"])          # ...e non si lamenta dell'altra
        self.assertIn("INSTALLA-GENERAZIONE", st["hint"])

    def test_everything_present_means_no_hint(self):
        prepara(self.s)
        st = G.Studio(self.s).status()
        self.assertTrue(st["images"] and st["videos"])
        self.assertIsNone(st["hint"])


class ComandoTest(unittest.TestCase):
    """Il comando passato a sd-cli: e' la parte che non si puo' sbagliare."""

    def setUp(self):
        self.s, self.tmp = temp_settings()
        prepara(self.s)
        self.studio = G.Studio(self.s)
        self.visti: list[list[str]] = []

        async def finto(argv, timeout):
            self.visti.append(argv)
            Path(argv[argv.index("-o") + 1]).write_bytes(b"finto")
            return 0, "ok"
        self.studio._esegui = finto

    def tearDown(self):
        cleanup(self.tmp)

    def test_image_command_has_the_three_models_and_the_turbo_settings(self):
        rep = run(self.studio.immagine(prompt="forno a legna", out_path=self.s.workspace_dir / "a.png"))
        argv = self.visti[0]
        self.assertIn("--diffusion-model", argv)
        self.assertIn("--vae", argv)
        self.assertIn("--llm", argv)                       # per Z-Image l'encoder e' --llm
        self.assertEqual(argv[argv.index("--cfg-scale") + 1], "1.0")
        self.assertEqual(argv[argv.index("--steps") + 1], "8")
        self.assertIn("--offload-to-cpu", argv)            # senza, 8 GB non bastano
        self.assertEqual((rep["width"], rep["height"]), (768, 1344))

    def test_video_command_uses_vid_gen_and_the_wan_settings(self):
        run(self.studio.clip(prompt="fiamme nel forno", out_path=self.s.workspace_dir / "c.mp4",
                             frames=49))
        argv = self.visti[0]
        self.assertEqual(argv[argv.index("-M") + 1], "vid_gen")   # obbligatorio per Wan
        self.assertIn("--t5xxl", argv)                            # per Wan l'encoder e' --t5xxl
        self.assertEqual(argv[argv.index("--flow-shift") + 1], "3.0")
        self.assertEqual(argv[argv.index("--video-frames") + 1], "49")
        self.assertIn("-n", argv)                                 # il negativo consigliato da Wan

    def test_frames_are_rounded_to_what_the_model_accepts(self):
        for chiesti, atteso in ((50, 49), (34, 33), (5, 5), (999, 121)):
            self.visti.clear()
            run(self.studio.clip(prompt="x", out_path=self.s.workspace_dir / "c.mp4", frames=chiesti))
            argv = self.visti[0]
            n = int(argv[argv.index("--video-frames") + 1])
            self.assertEqual(n, atteso, f"chiesti {chiesti}")
            self.assertEqual((n - 1) % 4, 0, "il modello vuole 4n+1 fotogrammi")

    def test_an_image_to_animate_is_passed_as_input(self):
        foto = self.s.workspace_dir / "foto.png"
        foto.write_bytes(b"x")
        run(self.studio.clip(prompt="x", out_path=self.s.workspace_dir / "c.mp4", image=foto))
        self.assertEqual(self.visti[0][self.visti[0].index("-i") + 1], str(foto))

    def test_steps_are_capped(self):
        run(self.studio.immagine(prompt="x", out_path=self.s.workspace_dir / "a.png", steps=500))
        self.assertEqual(int(self.visti[0][self.visti[0].index("--steps") + 1]), G.MAX_IMAGE_STEPS)

    def test_a_failed_run_is_an_error_not_a_silent_success(self):
        async def fallisce(argv, timeout):
            return 1, "CUDA out of memory"
        self.studio._esegui = fallisce
        with self.assertRaises(RuntimeError) as cm:
            run(self.studio.immagine(prompt="x", out_path=self.s.workspace_dir / "a.png"))
        self.assertIn("out of memory", str(cm.exception))


class VramTest(unittest.TestCase):
    """Il modello di chat va sempre rimesso: anche se la generazione fallisce."""

    def setUp(self):
        self.s, self.tmp = temp_settings()
        prepara(self.s)
        self.studio = G.Studio(self.s)
        self.eventi: list[str] = []

        class FintoServer:
            def __init__(self, eventi):
                self.eventi, self.model_file = eventi, "modello.gguf"

            def running(self):
                return "stop" not in self.eventi

            async def stop(self):
                self.eventi.append("stop")

            async def start(self, m):
                self.eventi.append(f"start:{m}")
        self.studio.gate.chat_server = FintoServer(self.eventi)

    def tearDown(self):
        cleanup(self.tmp)

    def test_the_chat_model_is_unloaded_and_put_back(self):
        async def finto(argv, timeout):
            Path(argv[argv.index("-o") + 1]).write_bytes(b"x")
            self.eventi.append("genera")
            return 0, "ok"
        self.studio._esegui = finto
        run(self.studio.immagine(prompt="x", out_path=self.s.workspace_dir / "a.png"))
        self.assertEqual(self.eventi, ["stop", "genera", "start:modello.gguf"])

    def test_the_chat_model_comes_back_even_when_generation_fails(self):
        async def esplode(argv, timeout):
            raise OSError("il motore e' morto")
        self.studio._esegui = esplode
        with self.assertRaises(OSError):
            run(self.studio.immagine(prompt="x", out_path=self.s.workspace_dir / "a.png"))
        self.assertEqual(self.eventi, ["stop", "start:modello.gguf"])

    def test_a_broken_gate_does_not_stop_the_generation(self):
        """Se non si riesce a liberare la VRAM si genera lo stesso, piu' lentamente."""
        async def rotto():
            raise RuntimeError("niente server")
        self.studio.gate.chat_server = None
        self.studio.gate._client = rotto

        async def finto(argv, timeout):
            Path(argv[argv.index("-o") + 1]).write_bytes(b"x")
            return 0, "ok"
        self.studio._esegui = finto
        rep = run(self.studio.immagine(prompt="x", out_path=self.s.workspace_dir / "a.png"))
        self.assertIn("non liberata", rep["vram"])


class StrumentiTest(unittest.TestCase):
    def setUp(self):
        self.s, self.tmp = temp_settings()
        prepara(self.s)
        self.studio = G.Studio(self.s)

        async def finto(argv, timeout):
            Path(argv[argv.index("-o") + 1]).write_bytes(b"x" * 2048)
            return 0, "ok"
        self.studio._esegui = finto
        self.ctx, self.approvals = make_ctx(self.s, genera=self.studio)

    def tearDown(self):
        cleanup(self.tmp)

    def test_the_tools_are_registered_and_owned_by_an_agent(self):
        from backend.app.agents import AGENTS
        r = builtin.build_registry()
        owned = {n for a in AGENTS.values() for n in a.tools}
        for nome in ("genera_immagine", "genera_clip"):
            self.assertIn(nome, r.tools)
            self.assertIn(nome, owned)

    def test_generating_an_image_registers_it_as_an_artifact(self):
        out = run(builtin.genera_immagine(self.ctx, prompt="forno", output="sfondo"))
        self.assertIn("Immagine generata", out)
        self.assertTrue((self.s.workspace_dir / "sfondo.png").is_file())
        self.assertTrue(any(t.endswith("sfondo.png") for t in self.ctx.run.touched))

    def test_a_clip_tells_how_long_the_video_is_and_how_long_it_took(self):
        out = run(builtin.genera_clip(self.ctx, prompt="fiamme", output="fuoco", seconds=2))
        self.assertIn("di video", out)
        self.assertIn("Tempo di calcolo", out)
        self.assertTrue((self.s.workspace_dir / "fuoco.mp4").is_file())

    def test_it_refuses_to_write_outside_the_workspace(self):
        with self.assertRaises(ToolError):
            run(builtin.genera_immagine(self.ctx, prompt="x", output="../../fuori.png"))

    def test_an_empty_prompt_is_refused(self):
        with self.assertRaises(ToolError):
            run(builtin.genera_immagine(self.ctx, prompt="   ", output="a.png"))

    def test_without_models_it_says_what_to_run_instead_of_failing_oddly(self):
        s2, tmp2 = temp_settings()
        try:
            prepara(s2, immagini=False)
            ctx, _ = make_ctx(s2, genera=G.Studio(s2))
            with self.assertRaises(ToolError) as cm:
                run(builtin.genera_immagine(ctx, prompt="x", output="a.png"))
            self.assertIn("INSTALLA-GENERAZIONE", str(cm.exception))
        finally:
            cleanup(tmp2)

    def test_overwriting_asks_for_approval(self):
        run(builtin.genera_immagine(self.ctx, prompt="x", output="a.png"))
        run(builtin.genera_immagine(self.ctx, prompt="y", output="a.png"))
        self.assertTrue(any(t == "genera_immagine" for t, _ in self.approvals))


if __name__ == "__main__":
    unittest.main()


class WslTest(unittest.TestCase):
    """Su Windows con Smart App Control il motore gira dentro WSL2.

    Misurato sul PC il 26/10/2026: nativo bloccato (STATUS_SYSTEM_INTEGRITY_POLICY_VIOLATION),
    dentro WSL un'immagine 768x1344 in 34,6 secondi sulla stessa GPU.
    """

    def setUp(self):
        self.s, self.tmp = temp_settings()
        prepara(self.s, motore=False)          # nessun eseguibile Windows: solo WSL
        (self.s.models_dir.parent / "tools" / "sd" / "wsl-path.txt").write_text(
            "/home/kassa/sd-cpp/build/bin/sd-cli\n", encoding="utf-8")
        self.studio = G.Studio(self.s)
        self.visti: list[list[str]] = []

        async def finto(argv, timeout):
            self.visti.append(argv)
            # il motore scrive sul percorso Windows: qui lo simuliamo
            Path(argv[argv.index("-o") + 1].replace("/mnt/c/", "C:/")).parent.mkdir(
                parents=True, exist_ok=True)
            return 0, "ok"
        self.studio._esegui = finto

    def tearDown(self):
        cleanup(self.tmp)

    def test_windows_paths_become_linux_paths(self):
        self.assertEqual(G.Studio.to_wsl(r"C:\Users\kassa\x.png"), "/mnt/c/Users/kassa/x.png")
        self.assertEqual(G.Studio.to_wsl(r"D:\modelli\m.gguf"), "/mnt/d/modelli/m.gguf")
        self.assertEqual(G.Studio.to_wsl("/home/kassa/sd"), "/home/kassa/sd")   # gia' Linux

    def test_the_engine_is_called_through_wsl(self):
        st = self.studio.status()
        self.assertTrue(st["engine"])
        self.assertEqual(st["mode"], "wsl")
        self.assertEqual(st["engine_path"], "/home/kassa/sd-cpp/build/bin/sd-cli")
        base, _ = self.studio._lancio()
        self.assertEqual(base, ["wsl.exe", "-e", "/home/kassa/sd-cpp/build/bin/sd-cli"])

    def test_every_path_in_the_command_is_translated(self):
        out = self.s.workspace_dir / "a.png"
        try:
            run(self.studio.immagine(prompt="x", out_path=out))
        except RuntimeError:
            pass                                # il file finto non viene creato: non importa
        argv = self.visti[0]
        self.assertEqual(argv[:2], ["wsl.exe", "-e"])
        for bandiera in ("--diffusion-model", "--vae", "--llm", "-o"):
            valore = argv[argv.index(bandiera) + 1]
            self.assertNotIn("\\", valore, f"{bandiera} e' rimasto un percorso Windows")
            self.assertFalse(re.match(r"^[A-Za-z]:", valore), f"{bandiera} ha la lettera di unita'")

    def test_the_native_engine_is_preferred_when_there_is_no_wsl_file(self):
        (self.s.models_dir.parent / "tools" / "sd" / "wsl-path.txt").unlink()
        (self.s.models_dir.parent / "tools" / "sd" / "sd-cli.exe").write_bytes(b"")
        studio = G.Studio(self.s)
        self.assertEqual(studio.status()["mode"], "nativo")
        base, _ = studio._lancio()
        self.assertEqual(len(base), 1)
        self.assertTrue(base[0].endswith("sd-cli.exe"))

    def test_an_empty_wsl_file_is_ignored(self):
        (self.s.models_dir.parent / "tools" / "sd" / "wsl-path.txt").write_text("  \n", encoding="utf-8")
        self.assertIsNone(G.Studio(self.s).wsl_bin())
