#!/usr/bin/env python3
"""Read-only check of the proxyhub program on a Solana cluster. No wallet, no spending.

It answers, from public RPC data only:
  * is the program there, who can upgrade it, and when was it last deployed;
  * does the deployed code equal a given build (--so, or --sha256 with --size);
  * is an on-chain IDL published, and does it equal the committed idl/proxyhub.json.

Typical use after a devnet upgrade (CI uploads the artifact, see the Anchor job):
  python scripts/verify-devnet-program.py \\
      --so proxyhub.so --idl services/solana-programs/proxyhub/idl/proxyhub.json

  python scripts/verify-devnet-program.py --sha256 <hex> --size 1285040   # no file needed
  python scripts/verify-devnet-program.py                                 # just report state
  python scripts/verify-devnet-program.py --self-test                     # offline sanity checks

Options: --program-id, --rpc (or SOLANA_RPC_URL), --authority (expected upgrade authority).
Exit: 0 every requested check passed, 1 a check failed, 2 usage or RPC error.

Why the padding rule: an upgradeable program's data account is usually larger than the ELF
(it was extended, or deployed with --max-len), and the unused tail is zeros. `solana program
dump` writes that whole area, so hashing the dump of a correctly deployed program does NOT
equal the hash of the .so. The right comparison is: the first len(.so) bytes hash to the
expected value and every byte after them is zero.
"""
import argparse
import base64
import hashlib
import json
import os
import sys
import time
import urllib.request
import zlib

DEFAULT_PROGRAM_ID = "AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu"
DEFAULT_AUTHORITY = "6thzwmrfijDA5eukKzMAbQnL86RqdxiLx2maM94bRJcR"
DEFAULT_RPC = "https://api.devnet.solana.com"
LOADER = "BPFLoaderUpgradeab1e11111111111111111111111"
# Regression value for the default program id; see --self-test.
KNOWN_IDL_ADDRESS = "Cim8v6Je6mn1cy39NYsuoHcPz77eRFYq6EwkSMafnimA"

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def b58decode(s: str) -> bytes:
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    body = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + body


_P = 2**255 - 19
_D = -121665 * pow(121666, -1, _P) % _P


def _on_curve(b: bytes) -> bool:
    """True if the 32 bytes decode to an ed25519 point (so they are NOT a valid PDA)."""
    y = int.from_bytes(b, "little") & ((1 << 255) - 1)
    if y >= _P:
        return False
    x2 = (y * y - 1) * pow(_D * y * y + 1, -1, _P) % _P
    return x2 == 0 or pow(x2, (_P - 1) // 2, _P) == 1


def find_pda(seeds, program_id: bytes) -> bytes:
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b"".join(seeds) + bytes([bump]) + program_id + b"ProgramDerivedAddress").digest()
        if not _on_curve(h):
            return h
    raise ValueError("no PDA found")


def idl_address(program_id: str) -> str:
    """Anchor's IDL account: create_with_seed(PDA([], program), "anchor:idl", program)."""
    pid = b58decode(program_id)
    base = find_pda([], pid)
    return b58encode(hashlib.sha256(base + b"anchor:idl" + pid).digest())


def decode_idl_account(data: bytes):
    """IdlAccount = 8-byte discriminator, 32-byte authority, u32 length, zlib(JSON)."""
    if len(data) < 44:
        raise ValueError("IDL account too short")
    authority = b58encode(data[8:40])
    n = int.from_bytes(data[40:44], "little")
    if 44 + n > len(data):
        raise ValueError("IDL length field runs past the account data")
    return authority, json.loads(zlib.decompress(data[44 : 44 + n]))


class Rpc:
    def __init__(self, url):
        self.url = url

    def call(self, method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        last = None
        for attempt in range(5):
            try:
                req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json"})
                out = json.load(urllib.request.urlopen(req, timeout=60))
                if "error" in out:
                    raise RuntimeError(out["error"])
                return out["result"]
            except Exception as e:  # network blips and 429s are common on public endpoints
                last = e
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"RPC {method} failed: {last}")

    def account(self, address):
        r = self.call("getAccountInfo", [address, {"encoding": "base64"}])["value"]
        if r is None:
            return None
        return r["owner"], r["executable"], base64.b64decode(r["data"][0])


class Report:
    def __init__(self):
        self.failed = False

    def info(self, msg):
        print(f"  info  {msg}")

    def ok(self, msg):
        print(f"  PASS  {msg}")

    def bad(self, msg):
        self.failed = True
        print(f"  FAIL  {msg}")


def check_program(rpc, args, rep):
    print(f"== program {args.program_id} ({args.rpc})")
    acct = rpc.account(args.program_id)
    if acct is None:
        rep.bad("program account does not exist")
        return None
    owner, executable, data = acct
    if owner != LOADER or not executable or int.from_bytes(data[:4], "little") != 2:
        rep.bad(f"not an upgradeable program (owner {owner}, executable {executable})")
        return None
    pd_addr = b58encode(data[4:36])
    rep.info(f"programdata account {pd_addr}")
    pd = rpc.account(pd_addr)
    if pd is None or int.from_bytes(pd[2][:4], "little") != 3:
        rep.bad("programdata account missing or malformed")
        return None
    raw = pd[2]
    slot = int.from_bytes(raw[4:12], "little")
    authority = b58encode(raw[13:45]) if raw[12] == 1 else None
    elf = raw[45:]
    trimmed = len(elf.rstrip(b"\0"))
    rep.info(f"last deployed slot {slot}")
    rep.info(f"ELF area {len(elf)} bytes; {trimmed} bytes once zero padding is ignored")
    rep.info(f"sha256 of the code without padding: {hashlib.sha256(elf[:trimmed]).hexdigest()}")
    if authority is None:
        rep.bad("program is immutable (upgrade authority removed)")
    elif authority == args.authority:
        rep.ok(f"upgrade authority is {authority}")
    else:
        rep.bad(f"upgrade authority is {authority}, expected {args.authority}")

    if args.sha256:
        want = args.sha256.lower()
        n = args.size
        if len(elf) < n:
            rep.bad(f"ELF area is {len(elf)} bytes, smaller than the {n}-byte build: not upgraded yet, "
                    f"or the data account was not extended (need at least {n - len(elf)} more bytes)")
        else:
            got = hashlib.sha256(elf[:n]).hexdigest()
            if got != want:
                rep.bad(f"first {n} bytes hash to {got}, expected {want}")
            elif any(elf[n:]):
                rep.bad(f"hash matches but bytes after offset {n} are not all zero (something else is stored there)")
            else:
                rep.ok(f"deployed code equals the build ({n} bytes, sha256 {want[:16]}...), padding is zeros")
    return slot


def check_idl(rpc, args, rep):
    addr = idl_address(args.program_id)
    print(f"== on-chain IDL account {addr}")
    acct = rpc.account(addr)
    if acct is None:
        (rep.bad if args.idl else rep.info)("no IDL published (AccountNotFound)")
        return
    try:
        authority, onchain = decode_idl_account(acct[2])
    except Exception as e:
        rep.bad(f"IDL account exists but could not be decoded: {e}")
        return
    rep.info(f"IDL authority {authority}; {len(json.dumps(onchain))} bytes of JSON")
    if args.idl:
        with open(args.idl, encoding="utf-8") as f:
            local = json.load(f)
        if onchain == local:
            rep.ok(f"on-chain IDL equals {args.idl}")
        else:
            rep.bad(f"on-chain IDL differs from {args.idl} (use `anchor idl upgrade`)")


def self_test():
    rep = Report()
    assert b58decode(b58encode(b"\0\0abc")) == b"\0\0abc"
    got = idl_address(DEFAULT_PROGRAM_ID)
    if got == KNOWN_IDL_ADDRESS:
        rep.ok(f"IDL address derivation matches the recorded value {got}")
    else:
        rep.bad(f"IDL address {got} != {KNOWN_IDL_ADDRESS}")
    sample = {"name": "proxyhub", "instructions": [{"name": "x", "args": []}]}
    blob = zlib.compress(json.dumps(sample).encode())
    data = b"\x18\x46\x62\xbf\x3a\x90\x7b\x9e" + b58decode(DEFAULT_AUTHORITY).rjust(32, b"\0") + len(blob).to_bytes(4, "little") + blob + b"\0" * 50
    auth, js = decode_idl_account(data)
    if auth == DEFAULT_AUTHORITY and js == sample:
        rep.ok("IDL account decoding round-trips (authority, length, zlib JSON, trailing slack)")
    else:
        rep.bad("IDL account decoding is wrong")
    elf = b"\x7fELF" + os.urandom(100)
    area = elf + b"\0" * 40
    ok = hashlib.sha256(area[: len(elf)]).digest() == hashlib.sha256(elf).digest() and not any(area[len(elf) :])
    (rep.ok if ok else rep.bad)("padding rule: prefix hash equals the build and the tail is zeros")
    return rep.failed


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--program-id", default=DEFAULT_PROGRAM_ID)
    ap.add_argument("--rpc", default=os.environ.get("SOLANA_RPC_URL", DEFAULT_RPC))
    ap.add_argument("--authority", default=DEFAULT_AUTHORITY, help="expected upgrade authority")
    ap.add_argument("--so", help="the built proxyhub.so to compare against the deployed code")
    ap.add_argument("--sha256", help="expected SHA-256 of the build (instead of --so)")
    ap.add_argument("--size", type=int, help="size in bytes of the build (with --sha256)")
    ap.add_argument("--idl", help="committed IDL JSON the on-chain IDL must equal")
    ap.add_argument("--self-test", action="store_true", help="offline sanity checks, no network")
    args = ap.parse_args()

    if args.self_test:
        sys.exit(1 if self_test() else 0)
    if args.so:
        with open(args.so, "rb") as f:
            blob = f.read()
        args.sha256, args.size = hashlib.sha256(blob).hexdigest(), len(blob)
        print(f"build {args.so}: {args.size} bytes, sha256 {args.sha256}")
    if bool(args.sha256) != bool(args.size):
        print("--sha256 and --size must be given together", file=sys.stderr)
        sys.exit(2)

    rep, rpc = Report(), Rpc(args.rpc)
    try:
        check_program(rpc, args, rep)
        check_idl(rpc, args, rep)
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(2)
    print("RESULT:", "FAILED" if rep.failed else "all requested checks passed")
    sys.exit(1 if rep.failed else 0)


if __name__ == "__main__":
    main()
