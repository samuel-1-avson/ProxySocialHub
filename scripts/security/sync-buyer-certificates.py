#!/usr/bin/env python3
"""Copy Caddy's verified buyer certificate and roll only the two TLS gateways."""
import argparse
import fcntl
import os
from pathlib import Path
import subprocess
import time

SOURCE = Path('/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/proxy.proxyhubb.com')
DESTINATION = Path('/etc/proxyhubb/buyer-tls')
CONTAINERS = ('proxyhubb-edge-gateway-b-1', 'proxyhubb-edge-gateway-a-1')


def checked(args):
    return subprocess.check_output(args, stderr=subprocess.DEVNULL)


def write_atomic(path, data):
    temporary = path.with_name(path.name + '.new')
    fd = os.open(str(temporary), os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
    os.replace(str(temporary), str(path))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-restart', action='store_true')
    args = parser.parse_args()
    with open('/run/lock/proxyhubb-security-release.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        certificate = SOURCE / 'proxy.proxyhubb.com.crt'
        private_key = SOURCE / 'proxy.proxyhubb.com.key'
        checked(['openssl', 'x509', '-in', str(certificate), '-noout', '-checkend', '86400', '-checkhost', 'proxy.proxyhubb.com'])
        if checked(['openssl', 'x509', '-in', str(certificate), '-pubkey', '-noout']) != checked(['openssl', 'pkey', '-in', str(private_key), '-pubout']):
            raise RuntimeError('Buyer certificate and key do not match')
        new = {'fullchain.pem': certificate.read_bytes(), 'privatekey.pem': private_key.read_bytes()}
        DESTINATION.mkdir(parents=True, mode=0o700, exist_ok=True)
        os.chmod(str(DESTINATION), 0o700)
        previous = {name: (DESTINATION / name).read_bytes() if (DESTINATION / name).exists() else None for name in new}
        if all(previous[name] == value for name, value in new.items()):
            print('Buyer certificate is current')
            return
        for name, value in new.items():
            write_atomic(DESTINATION / name, value)
        if args.no_restart:
            print('Buyer certificate installed; gateway restart deferred to release')
            return
        restarted = []
        try:
            for container in CONTAINERS:
                checked(['docker', 'restart', '--time', '45', container])
                restarted.append(container)
                for _ in range(90):
                    state = checked(['docker', 'inspect', '--format', '{{.State.Health.Status}}', container]).decode().strip()
                    if state == 'healthy':
                        break
                    time.sleep(1)
                else:
                    raise RuntimeError('Gateway certificate reload failed its health check')
        except Exception:
            if all(value is not None for value in previous.values()):
                for name, value in previous.items():
                    write_atomic(DESTINATION / name, value)
                for container in restarted:
                    checked(['docker', 'restart', '--time', '45', container])
            raise
        print('Buyer certificate refreshed; both gateways are healthy')


if __name__ == '__main__':
    main()
