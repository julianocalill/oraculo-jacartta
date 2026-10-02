"""Temporary localhost-only bridge to existing Ollama; no remote daemon/secrets.

python3 scripts/bia/ollama-ssh-local.py
Only classification-sized requests for the existing 7b model are forwarded.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import subprocess
import shlex

REMOTE = '''import json,subprocess,sys
payload=json.load(sys.stdin)
containers=subprocess.check_output(['docker','ps','--filter','name=ollama_open-webui.','--format','{{.ID}}'],text=True).splitlines()
if len(containers)!=1:raise SystemExit(1)
client="""import json,sys,urllib.request
value=json.load(sys.stdin)
request=urllib.request.Request('http://ollama:11434/api/generate',data=json.dumps(value).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=40) as response:print(json.dumps(json.load(response)))
"""
result=subprocess.run(['docker','exec','-i',containers[0],'python3','-c',client],input=json.dumps(payload),text=True,capture_output=True,timeout=45)
if result.returncode:raise SystemExit(1)
print(result.stdout)
'''


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # Backend only: no browser origins, alternative routes/models or tools.
        if self.path != '/api/generate' or self.headers.get('Origin'):
            return self.reply(403, {'error': 'Consulta não permitida'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 8000:
                return self.reply(413, {'error': 'Payload inválido'})
            value = json.loads(self.rfile.read(length))
            options = value.get('options', {})
            if (value.get('model') != 'qwen2.5-coder:7b' or value.get('stream') is not False
                    or 'tools' in value or not isinstance(value.get('prompt'), str)
                    or len(value['prompt']) > 2000 or options.get('num_predict') != 64
                    or options.get('num_ctx') != 2048):
                return self.reply(400, {'error': 'Somente classificação B.ia'})
            if set(value) - {'model', 'stream', 'prompt', 'format', 'options'}:
                return self.reply(400, {'error': 'Campos não permitidos'})
            remote = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                                     '-o', 'ConnectTimeout=10', '129.121.53.71', 'python3 -c ' + shlex.quote(REMOTE)],
                                    input=json.dumps(value), capture_output=True, text=True, timeout=50)
            if remote.returncode:
                return self.reply(503, {'error': 'Modelo indisponível'})
            self.reply(200, json.loads(remote.stdout))
        except (ValueError, TypeError, AttributeError, subprocess.SubprocessError):
            self.reply(503, {'error': 'Consulta indisponível'})
        except (BrokenPipeError, ConnectionResetError):
            pass


print('Proxy B.ia pronto em 127.0.0.1:11435; sem logs de perguntas ou credenciais.', flush=True)
ThreadingHTTPServer(('127.0.0.1', 11435), Handler).serve_forever()
