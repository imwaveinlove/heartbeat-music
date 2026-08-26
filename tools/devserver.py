#!/usr/bin/env python3
"""Static file server for local development, with caching switched off.

python -m http.server sends Last-Modified but no Cache-Control, so browsers apply
their own heuristic caching and happily keep serving a stale .js after you edit
it. That turns every change into "why is nothing happening". This sends
no-store on everything instead.

Usage:  python tools/devserver.py [port]
"""

import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    # Conditional requests would still let the browser reuse a cached copy.
    def send_response(self, code, message=None):
        if code == 304:
            code = 200
        super().send_response(code, message)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s\n" % (fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    print('serving %s at http://localhost:%d (no-store)' % (root, port))
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()


if __name__ == '__main__':
    main()
