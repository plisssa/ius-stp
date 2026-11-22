"""Общий HTTPS-стенд внутри сети команды: python3 share_lan.py 192.168.x.x"""
import argparse
import ipaddress
import os
import ssl
import subprocess
from http.server import ThreadingHTTPServer
import app
from share import credentials

parser = argparse.ArgumentParser()
parser.add_argument("address",type=ipaddress.IPv4Address)
parser.add_argument("--port",type=int,default=8767)
args = parser.parse_args()
if not any(args.address in ipaddress.ip_network(n) for n in ("10.0.0.0/8","172.16.0.0/12","192.168.0.0/16")):
    parser.error("Укажите частный IPv4-адрес сетевого интерфейса")
app.ACCOUNTS = credentials()
folder = app.ROOT / "team-access"
certificate = folder / f"stp-{args.address}.crt"
key = folder / f"stp-{args.address}.key"
if not certificate.exists() or not key.exists():
    mask = os.umask(0o077)
    try:
        subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-sha256","-days","30",
                        "-subj","/CN=STP team demo","-addext",f"subjectAltName=IP:{args.address}",
                        "-addext","basicConstraints=critical,CA:FALSE","-addext","extendedKeyUsage=serverAuth",
                        "-keyout",str(key),"-out",str(certificate)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    finally:
        os.umask(mask)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.minimum_version = ssl.TLSVersion.TLSv1_2
context.load_cert_chain(certificate,key)
app.init()
app.ORIGIN = f"https://{args.address}:{args.port}"
with ThreadingHTTPServer((str(args.address),args.port),app.Handler) as server:
    server.socket = context.wrap_socket(server.socket,server_side=True)
    print(app.ORIGIN,flush=True)
    subprocess.run(["openssl","x509","-in",str(certificate),"-noout","-sha256","-fingerprint"],check=True)
    server.serve_forever()
