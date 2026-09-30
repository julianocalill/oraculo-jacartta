#!/usr/bin/env python3
"""Servidor local do analisador de prints Shopee Ads. Escuta apenas 127.0.0.1."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

from analysis import analyze, extract_metrics


HERE = Path(__file__).resolve().parent
MAX_BODY = 12 * 1024 * 1024
MAX_IMAGE = 10 * 1024 * 1024
OCR_SOURCE = HERE / "ocr.swift"
OCR_BINARY = Path(tempfile.gettempdir()) / f"oraculo-ads-ocr-{hashlib.sha256(OCR_SOURCE.read_bytes()).hexdigest()[:12]}"


def ensure_ocr() -> Path:
    if sys.platform != "darwin":
        raise RuntimeError("O reconhecimento de texto desta versão requer macOS.")
    if OCR_BINARY.exists():
        return OCR_BINARY
    env = os.environ.copy()
    sdk = Path("/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk")
    if sdk.exists():
        env["SDKROOT"] = str(sdk)
    cache = Path(tempfile.gettempdir()) / "oraculo-ads-swift-module-cache"
    cache.mkdir(exist_ok=True)
    command = ["swiftc", "-module-cache-path", str(cache), "-framework", "AppKit", "-framework", "Vision", str(OCR_SOURCE), "-o", str(OCR_BINARY)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=120, env=env)
    if result.returncode:
        raise RuntimeError("Não foi possível preparar o OCR nativo: " + result.stderr[-650:])
    return OCR_BINARY


def read_image(image_b64: str, mime: str) -> dict:
    if mime not in ("image/png", "image/jpeg"):
        raise ValueError("Envie um print PNG ou JPEG.")
    try:
        image = base64.b64decode(image_b64, validate=True)
    except (ValueError, base64.binascii.Error):
        raise ValueError("A imagem recebida não é válida.") from None
    if len(image) > MAX_IMAGE or not image:
        raise ValueError("O print deve ter no máximo 10 MB.")
    if mime == "image/png" and not image.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("O arquivo não é um PNG válido.")
    if mime == "image/jpeg" and not image.startswith(b"\xff\xd8\xff"):
        raise ValueError("O arquivo não é um JPEG válido.")
    suffix = ".png" if mime == "image/png" else ".jpg"
    path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="oraculo-ads-print-", suffix=suffix, delete=False) as temp:
            temp.write(image)
            path = Path(temp.name)
        result = subprocess.run([str(ensure_ocr()), str(path)], capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError("O macOS não conseguiu ler este print. Tente exportá-lo novamente em PNG.")
        lines = json.loads(result.stdout)
        reading = extract_metrics(lines)
        reading["ocr_lines"] = [line["text"] for line in sorted(lines, key=lambda line: (round(line["y"], 2), line["x"]))[:120]]
        return reading
    finally:
        if path:
            path.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, data: dict) -> None:
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(encoded)

    def _file(self, name: str, mime: str) -> None:
        content = (HERE / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self) -> None:
        routes = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/styles.css": ("styles.css", "text/css; charset=utf-8"),
        }
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "ads-print-analyzer"})
        elif self.path in routes:
            self._file(*routes[self.path])
        else:
            self._json(404, {"error": "Rota não encontrada."})

    def do_POST(self) -> None:
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if host.split(":", 1)[0] not in ("127.0.0.1", "localhost"):
            self._json(403, {"error": "Este aplicativo aceita somente localhost."})
            return
        if origin and origin not in (f"http://{host}", f"https://{host}"):
            self._json(403, {"error": "Origem não permitida."})
            return
        if self.path not in ("/api/read", "/api/analyze"):
            self._json(404, {"error": "Rota não encontrada."})
            return
        size = self.headers.get("Content-Length")
        if not size or not size.isdigit() or int(size) > MAX_BODY:
            self._json(413, {"error": "Requisição muito grande (máximo 12 MB)."})
            return
        try:
            payload = json.loads(self.rfile.read(int(size)))
            if not isinstance(payload, dict):
                raise ValueError("Dados inválidos.")
            if self.path == "/api/read":
                result = read_image(payload.get("image", ""), payload.get("mime", ""))
            else:
                result = analyze(payload, datetime.now(ZoneInfo("America/Sao_Paulo")).date())
            self._json(200, result)
        except (ValueError, RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
            self._json(422, {"error": str(error)})
        except Exception:
            self._json(500, {"error": "Falha inesperada ao analisar o print."})


def main() -> None:
    port = int(os.environ.get("ADS_PRINT_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Analisador Shopee Ads em http://127.0.0.1:{port}", flush=True)
    print("O print é processado localmente e descartado após a leitura.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
