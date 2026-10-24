"""Browser automatizzato (Playwright + Chromium) per l'agente Navigatore.

- Sessione isolata: nessun profilo, cookie o password del tuo browser personale.
- Ogni elemento interattivo della pagina riceve un numero: l'agente clicca o
  scrive indicando quel numero (niente selettori inventati).
- Invii di moduli e tasti "submit" richiedono la tua approvazione.
- Il campo password è sempre vietato: l'agente non inserisce mai credenziali.
- Le richieste verso indirizzi locali/privati sono bloccate (SSRF).
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from .registry import ToolError
from .web import UNTRUSTED_HEADER, _is_public_ip

log = logging.getLogger("ailocale.browser")

SNAPSHOT_JS = r"""
() => {
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [contenteditable=true]';
  const out = [];
  let n = 0;
  document.querySelectorAll('[data-ailocale-id]').forEach(e => e.removeAttribute('data-ailocale-id'));
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
    if (n >= 80) break;
    n += 1;
    el.setAttribute('data-ailocale-id', String(n));
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let label = el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '';
    if (!label && el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) label = l.innerText; }
    const isSubmit = (tag === 'button' && (type === 'submit' || (!type && el.form))) || (tag === 'input' && (type === 'submit' || type === 'image'));
    out.push({ id: n, tag, type, label: label.replace(/\s+/g, ' ').trim().slice(0, 80), href: el.href || '', submit: isSubmit });
  }
  const text = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 8000);
  return { title: document.title, url: location.href, text, elements: out };
}
"""


class BrowserSession:
    def __init__(self, settings, allow_private: bool = False):
        self.settings = settings
        self.allow_private = allow_private  # solo per i test automatici con un server locale
        self._pw = None
        self._browser = None
        self._page = None
        self._lock = asyncio.Lock()
        self._dns: dict[str, bool] = {}
        self.elements: dict[int, dict] = {}

    @staticmethod
    def available() -> bool:
        try:
            import playwright.async_api  # noqa: F401
            return True
        except ImportError:
            return False

    async def _host_ok(self, host: str) -> bool:
        if self.allow_private:
            return True
        if host in self._dns:
            return self._dns[host]
        try:
            ipaddress.ip_address(host)
            ok = _is_public_ip(host)
        except ValueError:
            try:
                infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
                ok = all(_is_public_ip(i[4][0]) for i in infos)
            except socket.gaierror:
                ok = False
        self._dns[host] = ok
        return ok

    async def _guard(self, route):
        url = route.request.url
        p = urlparse(url)
        if p.scheme in ("data", "blob", "about"):
            await route.continue_()
            return
        if p.scheme not in ("http", "https") or not p.hostname or not await self._host_ok(p.hostname):
            await route.abort("blockedbyclient")
            return
        await route.continue_()

    async def page(self):
        if self._page is not None and not self._page.is_closed():
            return self._page
        if not self.available():
            raise ToolError("Il browser automatico non è installato: esegui `pip install playwright` e "
                            "`python -m playwright install chromium` (lo fa setup.ps1).")
        from playwright.async_api import async_playwright
        self._pw = await async_playwright().start()
        try:
            self._browser = await self._pw.chromium.launch(headless=self.settings.browser_headless)
        except Exception as exc:  # noqa: BLE001
            await self._pw.stop()
            self._pw = None
            raise ToolError(f"Impossibile avviare Chromium: {str(exc).splitlines()[0][:200]}") from exc
        ctx = await self._browser.new_context(viewport={"width": 1280, "height": 860}, locale="it-IT",
                                              accept_downloads=False)
        await ctx.route("**/*", self._guard)
        self._page = await ctx.new_page()
        log.info("browser avviato (headless=%s)", self.settings.browser_headless)
        return self._page

    async def close(self) -> None:
        try:
            if self._browser:
                await self._browser.close()
            if self._pw:
                await self._pw.stop()
        except Exception:  # noqa: BLE001
            pass
        self._browser = self._pw = self._page = None

    async def snapshot(self) -> str:
        page = await self.page()
        data = await page.evaluate(SNAPSHOT_JS)
        self.elements = {e["id"]: e for e in data["elements"]}
        lines = []
        for e in data["elements"]:
            kind = e["tag"] + (f"[{e['type']}]" if e["type"] else "")
            extra = " (INVIO MODULO)" if e["submit"] else ""
            target = f" -> {e['href'][:80]}" if e["href"] and e["tag"] == "a" else ""
            lines.append(f"[{e['id']}] {kind} {e['label']!r}{target}{extra}")
        return (f"{UNTRUSTED_HEADER}\nTITOLO: {data['title']}\nURL: {data['url']}\n\nTESTO DELLA PAGINA:\n{data['text']}\n\n"
                f"ELEMENTI INTERATTIVI (usa il numero con browser_click / browser_type):\n" + "\n".join(lines))

    async def open(self, url: str) -> str:
        if not urlparse(url).scheme:
            url = "https://" + url
        async with self._lock:
            page = await self.page()
            p = urlparse(url)
            if p.scheme not in ("http", "https") or not p.hostname or not await self._host_ok(p.hostname):
                raise ToolError("Per sicurezza non posso aprire indirizzi locali o di rete privata.")
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(600)
            except Exception as exc:  # noqa: BLE001
                raise ToolError(f"Impossibile aprire la pagina: {str(exc).splitlines()[0][:200]}") from exc
            return await self.snapshot()

    def element(self, element_id: int) -> dict:
        el = self.elements.get(int(element_id))
        if not el:
            raise ToolError("Elemento inesistente: apri o rileggi la pagina e usa un numero dell'elenco.")
        return el

    async def click(self, element_id: int) -> str:
        async with self._lock:
            page = await self.page()
            loc = page.locator(f'[data-ailocale-id="{int(element_id)}"]')
            try:
                await loc.click(timeout=8000)
                await page.wait_for_load_state("domcontentloaded", timeout=15000)
                await page.wait_for_timeout(600)
            except Exception as exc:  # noqa: BLE001
                raise ToolError(f"Click non riuscito: {str(exc).splitlines()[0][:200]}") from exc
            return await self.snapshot()

    async def type(self, element_id: int, text: str, submit: bool = False) -> str:
        el = self.element(element_id)
        if el["type"] == "password":
            raise ToolError("Per sicurezza gli agenti non inseriscono mai password o credenziali.")
        async with self._lock:
            page = await self.page()
            loc = page.locator(f'[data-ailocale-id="{int(element_id)}"]')
            try:
                await loc.fill(text[:2000], timeout=8000)
                if submit:
                    await loc.press("Enter")
                    await page.wait_for_load_state("domcontentloaded", timeout=15000)
                    await page.wait_for_timeout(800)
            except Exception as exc:  # noqa: BLE001
                raise ToolError(f"Scrittura non riuscita: {str(exc).splitlines()[0][:200]}") from exc
            return await self.snapshot()

    async def back(self) -> str:
        async with self._lock:
            page = await self.page()
            await page.go_back(wait_until="domcontentloaded", timeout=15000)
            return await self.snapshot()

    async def screenshot(self, folder: Path) -> Path:
        async with self._lock:
            page = await self.page()
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"screenshot-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}.png"
            await page.screenshot(path=str(path), full_page=False)
            return path
