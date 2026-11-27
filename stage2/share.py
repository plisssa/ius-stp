"""Временный доступ трёх участников через HTTPS. Остановка: Ctrl+C."""
import sys
import argparse
import base64
import hashlib
import threading
import os
import re
import secrets
import shutil
import subprocess
from http.server import ThreadingHTTPServer
from pathlib import Path
import app


def credentials():
    folder = app.ROOT / "team-access"
    folder.mkdir(mode=0o700,exist_ok=True)
    passwords = {}
    for login in ("elizaveta","maria","vlad"):
        path = folder / (login+".txt")
        if not path.exists():
            with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"w") as f:
                f.write(f"{login}\n{secrets.token_urlsafe(24)}\n")
        name,password = path.read_text().strip().splitlines()
        if name != login or len(password)<20:
            raise ValueError(f"Проверьте файл доступа для {login}")
        passwords[login] = password
    return passwords


def ssh_command(port):
    # Отпечаток опубликован в https://localhost.run/docs/security .
    known = app.ROOT / "team-access" / "localhost-run.known_hosts"
    scan = subprocess.run(["ssh-keyscan","-T","10","-t","ed25519","localhost.run"],capture_output=True,text=True,timeout=18)
    for line in scan.stdout.splitlines():
        fields = line.split()
        if len(fields) != 3 or fields[:2] != ["localhost.run","ssh-ed25519"]:
            continue
        fingerprint = base64.b64encode(hashlib.sha256(base64.b64decode(fields[2])).digest()).decode().rstrip("=")
        if fingerprint == "pG6qrBxubYfWa1Zadu/V0NUgjEDiBds/7e2xzte/QNM":
            known.write_text(line+"\n")
            break
    else:
        raise SystemExit("Не удалось получить и проверить ключ SSH localhost.run.")
    return ["ssh","-F","/dev/null","-T","-o","IdentityFile=none","-o","IdentityAgent=none","-o","PubkeyAuthentication=no",
            "-o","StrictHostKeyChecking=yes","-o","UserKnownHostsFile="+str(known),"-o","BatchMode=yes",
            "-o","ExitOnForwardFailure=yes","-o","ConnectTimeout=10","-o","ServerAliveInterval=30",
            "-R",f"80:127.0.0.1:{port}","nokey@localhost.run"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider",choices=("cloudflare","localhost.run"),default="cloudflare")
    provider = parser.parse_args().provider
    app.ACCOUNTS = app.load_accounts(credentials())
    app.init()
    with ThreadingHTTPServer(("127.0.0.1",0),app.Handler) as server:
        if provider == "cloudflare":
            if not shutil.which("cloudflared"):
                raise SystemExit("Установите cloudflared: brew install cloudflared")
            command = ["cloudflared","tunnel","--no-autoupdate","--url",f"http://127.0.0.1:{server.server_port}"]
            domain = r"https://[a-z0-9-]+\.trycloudflare\.com\b"
        else:
            command = ssh_command(server.server_port)
            domain = r"https://[a-z0-9-]+\.(?:lhr\.life|localhost\.run|lhr\.rocks)\b"
        tunnel = subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        startup_timeout = threading.Timer(90,tunnel.terminate)
        startup_timeout.start()
        try:
            for line in tunnel.stdout:
                match = re.search(domain,line)
                if match:
                    app.ORIGIN = match.group()
                ready = provider == "localhost.run" or "Registered tunnel connection" in line
                if ready and app.ORIGIN.startswith("https://"):
                    print(app.ORIGIN,flush=True)
                    break
                if "ERR" in line:
                    print(line.strip(),file=sys.stderr,flush=True)
            else:
                raise SystemExit(f"{provider}: соединение с узлом провайдера не установлено.")
            startup_timeout.cancel()
            def monitor():
                for entry in tunnel.stdout:
                    if "ERR" in entry:
                        print(entry.strip(),file=sys.stderr,flush=True)
                server.shutdown()
            threading.Thread(target=monitor,daemon=True).start()
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            startup_timeout.cancel()
            tunnel.terminate()
            tunnel.wait()
