"""Static dev server that tells the browser never to cache, so edits show up on a normal reload."""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    import functools
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5175
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(NoCacheHandler, directory=root)
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
