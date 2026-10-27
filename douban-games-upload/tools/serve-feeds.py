#!/usr/bin/env python3
"""Serve the feeds/ directory on http://127.0.0.1:8811 for local RSS readers.

Adds the missing .opml MIME type and disables client caching, so a reader
re-reading the feed always sees the freshly regenerated file.

    python tools/serve-feeds.py            # foreground
    python tools/serve-feeds.py --port 9000
"""

import argparse
import functools
import http.server
import mimetypes
import os

mimetypes.add_type("text/xml", ".opml")
mimetypes.add_type("application/rss+xml", ".xml")

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "feeds"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8811)
    ap.add_argument("--bind", default="127.0.0.1")
    args = ap.parse_args()
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        print(f"Serving {ROOT} at http://{args.bind}:{args.port}/", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
