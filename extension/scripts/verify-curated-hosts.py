"""Anonymous public hostname checks. No browser profile, cookies or URL query logs.

Input is a reviewed catalog JSON export, never browser navigation data. Results
separate reachability from ownership/authenticated compatibility. Redirects are
followed without a cookie jar; only hostname/status metadata is retained.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import ssl
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe(hostname):
    opener = urllib.request.build_opener(NoRedirect())
    url = 'https://' + hostname + '/'
    steps = []
    for _ in range(5):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ['https', 'http'] or parsed.username or parsed.password or not parsed.hostname:
            return dict(hostname=hostname, steps=steps, outcome='UNSUPPORTED_REDIRECT')
        try:
            request = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'AtlasCuratedVerification/1.0'})
            try:
                response = opener.open(request, timeout=7)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.code
                steps.append(dict(hostname=parsed.hostname, status=status, https=parsed.scheme == 'https'))
                if status in [301, 302, 303, 307, 308] and response.headers.get('Location'):
                    url = urllib.parse.urljoin(url, response.headers['Location'])
                    continue
                return dict(hostname=hostname, steps=steps, outcome='HTTP_RESPONSE')
        except (TimeoutError, urllib.error.URLError, ssl.SSLError, OSError) as error:
            cause = getattr(error, 'reason', error)
            code = 'TLS_ERROR' if isinstance(cause, ssl.SSLError) else 'NETWORK_UNAVAILABLE'
            return dict(hostname=hostname, steps=steps, outcome=code)
    return dict(hostname=hostname, steps=steps, outcome='REDIRECT_LIMIT')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalog', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    entries = json.loads(args.catalog.read_text(encoding='utf-8'))
    hosts = sorted({h for e in entries for h in [e['hostname'], *e.get('aliases', []), *e.get('destinations', [])]})
    with ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(probe, hosts))
    report = dict(date=datetime.now(timezone.utc).date().isoformat(), services=entries,
                  exactHostnames=len(hosts), anonymous=True, credentialsUsed=False,
                  authenticatedBrowserCompatibilityTested=False, results=results)
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('Checked', len(hosts), 'exact public hosts; results:', args.output)
    for result in results:
        last = result['steps'][-1] if result['steps'] else None
        if result['outcome'] != 'HTTP_RESPONSE' or last['status'] >= 400:
            print(result['hostname'], result['outcome'], last['status'] if last else '-')


if __name__ == '__main__':
    main()
