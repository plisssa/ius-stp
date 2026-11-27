"""Изолированный MCP-процесс: единственный канал — Unix-сокет приложения."""
import io
import os
from pathlib import Path
from socketserver import StreamRequestHandler, ThreadingUnixStreamServer
from mcp_stdio import serve


class Handler(StreamRequestHandler):
    def handle(self):
        output = io.TextIOWrapper(self.wfile, encoding="utf-8", write_through=True)
        try:
            serve(self.rfile, output)
        finally:
            output.detach()


if __name__ == "__main__":
    endpoint = Path(os.environ["STP_MCP_SOCKET"])
    if endpoint.is_socket():
        endpoint.unlink()
    with ThreadingUnixStreamServer(str(endpoint), Handler) as server:
        os.chmod(endpoint, 0o660)
        server.serve_forever()
