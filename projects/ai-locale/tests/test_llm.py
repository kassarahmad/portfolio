import asyncio
import json
import unittest

from helpers import ROOT  # noqa: F401  (configura sys.path)

from backend.app.llm import LLMClient, LLMError, ThinkFilter, extract_json, httpx, parse_text_tool_calls


def sse(chunks):
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return body.encode()


class ThinkFilterTest(unittest.TestCase):
    def test_removes_think_split_across_chunks(self):
        f = ThinkFilter()
        out = "".join(f.feed(c) for c in ["Ciao <thi", "nk>ragiono", " ancora</th", "ink> mondo"]) + f.flush()
        self.assertEqual(out, "Ciao  mondo")
        self.assertEqual(f.reasoning, "ragiono ancora")

    def test_plain_text_untouched(self):
        f = ThinkFilter()
        self.assertEqual(f.feed("a < b e c <t") + f.flush(), "a < b e c <t")


class ExtractJsonTest(unittest.TestCase):
    def test_fenced_and_noisy(self):
        self.assertEqual(extract_json('Ecco:\n```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(extract_json('<think>x</think> testo {"a": {"b": "}"}} fine'), {"a": {"b": "}"}})

    def test_invalid(self):
        with self.assertRaises(ValueError):
            extract_json("nessun json qui")

    def test_text_tool_calls(self):
        content, calls = parse_text_tool_calls('ok <tool_call>{"name": "read_file", "arguments": {"path": "a.txt"}}</tool_call>')
        self.assertEqual(content, "ok")
        self.assertEqual(calls[0].name, "read_file")
        self.assertEqual(calls[0].arguments, {"path": "a.txt"})


class ClientTest(unittest.TestCase):
    def run_async(self, coro):
        return asyncio.run(coro)

    def test_streaming_content_tokens_and_usage(self):
        seen = {}

        def handler(request):
            seen["payload"] = json.loads(request.content)
            return httpx.Response(200, content=sse([
                {"choices": [{"delta": {"content": "<think>hmm</think>Cia"}}]},
                {"choices": [{"delta": {"content": "o!"}}]},
                {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3}},
            ]), headers={"content-type": "text/event-stream"})

        async def go():
            c = LLMClient("http://x/v1", "m", transport=httpx.MockTransport(handler))
            toks = []

            async def on_token(t):
                toks.append(t)
            r = await c.chat([{"role": "user", "content": "hi"}], on_token=on_token)
            await c.aclose()
            return r, toks
        r, toks = self.run_async(go())
        self.assertEqual(r.content, "Ciao!")
        self.assertEqual("".join(toks), "Ciao!")
        self.assertEqual(r.reasoning, "hmm")
        self.assertEqual((r.prompt_tokens, r.completion_tokens), (12, 3))
        self.assertTrue(seen["payload"]["stream"])

    def test_tool_call_deltas_are_accumulated(self):
        def handler(request):
            return httpx.Response(200, content=sse([
                {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "read_", "arguments": '{"pa'}}]}}]},
                {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"name": "file", "arguments": 'th": "a.txt"}'}}]}}]},
            ]))

        async def go():
            c = LLMClient("http://x/v1", "m", transport=httpx.MockTransport(handler))
            r = await c.chat([{"role": "user", "content": "x"}], tools=[{"type": "function"}])
            await c.aclose()
            return r
        r = self.run_async(go())
        self.assertEqual(len(r.tool_calls), 1)
        self.assertEqual(r.tool_calls[0].name, "read_file")
        self.assertEqual(r.tool_calls[0].arguments, {"path": "a.txt"})

    def test_tools_fall_back_to_non_streaming(self):
        calls = []

        def handler(request):
            body = json.loads(request.content)
            calls.append(body["stream"])
            if body["stream"]:
                return httpx.Response(400, text="streaming with tools not supported")
            return httpx.Response(200, json={"choices": [{"message": {"content": "", "tool_calls": [
                {"id": "c9", "function": {"name": "list_files", "arguments": "{\"path\": \".\"}"}}]}}],
                "usage": {"completion_tokens": 7}})

        async def go():
            c = LLMClient("http://x/v1", "m", transport=httpx.MockTransport(handler))
            r = await c.chat([{"role": "user", "content": "x"}], tools=[{"type": "function"}])
            await c.aclose()
            return r
        r = self.run_async(go())
        self.assertEqual(calls, [True, False])
        self.assertEqual(r.tool_calls[0].name, "list_files")
        self.assertEqual(r.tool_calls[0].arguments, {"path": "."})
        self.assertEqual(r.completion_tokens, 7)

    def test_http_error_raises_llm_error(self):
        async def go():
            c = LLMClient("http://x/v1", "m", transport=httpx.MockTransport(lambda r: httpx.Response(500, text="boom")))
            try:
                await c.chat([{"role": "user", "content": "x"}])
            finally:
                await c.aclose()
        with self.assertRaises(LLMError):
            self.run_async(go())

    def test_context_overflow_compacts_and_retries(self):
        sizes = []

        def handler(request):
            body = json.loads(request.content)
            n = sum(len(m["content"]) for m in body["messages"])
            sizes.append(n)
            if n > 8000:
                err = {"error": {"code": 400, "message": f"request ({n // 3} tokens) exceeds the available context "
                                 f"size (2048 tokens), try increasing it", "type": "exceed_context_size_error"}}
                return httpx.Response(400, json=err)
            return httpx.Response(200, content=sse([{"choices": [{"delta": {"content": "ok"}}]}]),
                                  headers={"content-type": "text/event-stream"})

        async def go():
            c = LLMClient("http://x/v1", "m", transport=httpx.MockTransport(handler))
            msgs = [{"role": "system", "content": "Sei un agente."},
                    {"role": "user", "content": "domanda"},
                    {"role": "tool", "content": "A" * 30000}]
            r = await c.chat(msgs, max_tokens=256)
            r2 = await c.chat(msgs, max_tokens=256)  # il limite imparato evita il secondo errore
            await c.aclose()
            return r, r2, c
        r, r2, c = self.run_async(go())
        self.assertEqual(r.content, "ok")
        self.assertEqual(r2.content, "ok")
        self.assertEqual(c.context_tokens, 2048)
        self.assertLessEqual(sizes[-1], 8000)
        self.assertEqual(len(sizes), 3)  # errore, riprova riuscita, seconda chiamata subito riuscita

    def test_connect_error_message(self):
        def handler(request):
            raise httpx.ConnectError("refused", request=request)

        async def go():
            c = LLMClient("http://x/v1", "m", transport=httpx.MockTransport(handler))
            try:
                await c.chat([{"role": "user", "content": "x"}])
            finally:
                await c.aclose()
        with self.assertRaises(LLMError) as cm:
            self.run_async(go())
        self.assertIn("avviato", str(cm.exception))

    def test_embeddings_sorted_by_index(self):
        def handler(request):
            return httpx.Response(200, json={"data": [{"index": 1, "embedding": [2.0]}, {"index": 0, "embedding": [1.0]}]})

        async def go():
            c = LLMClient("http://x/v1", "m", transport=httpx.MockTransport(handler))
            r = await c.embed(["a", "b"])
            await c.aclose()
            return r
        self.assertEqual(self.run_async(go()), [[1.0], [2.0]])


if __name__ == "__main__":
    unittest.main()


class JsonFormatNegotiationTest(unittest.TestCase):
    """Server diversi chiedono il JSON in modi diversi: il client deve adattarsi.

    Difetto reale del 26/10/2026: LM Studio rifiuta response_format=json_object
    ("must be 'json_schema' or 'text'") e l'intera richiesta falliva.
    """

    def _client(self, rifiuta: set[str]):
        visti: list = []

        def handler(request):
            body = json.loads(request.content)
            fmt = (body.get("response_format") or {}).get("type")
            visti.append(fmt)
            if fmt in rifiuta:
                return httpx.Response(400, json={"error": "'response_format.type' must be 'json_schema' or 'text'"})
            return httpx.Response(200, content=sse([
                {"choices": [{"delta": {"content": "{\"ok\": true}"}}]},
                {"choices": [], "usage": {"prompt_tokens": 1, "completion_tokens": 1}},
            ]), headers={"content-type": "text/event-stream"})
        c = LLMClient("http://x/v1", "m", transport=httpx.MockTransport(handler))
        return c, visti

    def test_falls_back_to_json_schema(self):
        c, visti = self._client({"json_object"})
        out = asyncio.run(c.chat([{"role": "user", "content": "ciao"}], json_mode=True))
        self.assertEqual(out.content, '{"ok": true}')
        self.assertEqual(visti, ["json_object", "json_schema"])
        self.assertEqual(c.json_format, "json_schema")       # impara, e non riprova piu' lo stile sbagliato

    def test_falls_back_to_plain_text_if_both_are_refused(self):
        c, visti = self._client({"json_object", "json_schema"})
        out = asyncio.run(c.chat([{"role": "user", "content": "ciao"}], json_mode=True))
        self.assertEqual(out.content, '{"ok": true}')
        self.assertEqual(visti, ["json_object", "json_schema", None])
        self.assertEqual(c.json_format, "none")

    def test_a_server_that_accepts_json_object_is_left_alone(self):
        c, visti = self._client(set())
        asyncio.run(c.chat([{"role": "user", "content": "ciao"}], json_mode=True))
        self.assertEqual(visti, ["json_object"])
        self.assertEqual(c.json_format, "json_object")
