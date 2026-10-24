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
