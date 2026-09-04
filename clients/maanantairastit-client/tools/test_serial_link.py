#!/usr/bin/env python3
"""Verify a cross-connected pair of physical serial ports."""

from __future__ import annotations

import argparse
import os
import select
import time


def read_until(fd: int, expected: bytes, timeout: float) -> bytes:
    received = bytearray()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = max(0.0, deadline - time.monotonic())
        ready, _, _ = select.select([fd], [], [], remaining)
        if not ready:
            break
        try:
            received.extend(os.read(fd, 4096))
        except BlockingIOError:
            continue
        if expected in received:
            break
    return bytes(received)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port_a")
    parser.add_argument("port_b")
    parser.add_argument("--timeout", type=float, default=3.0)
    args = parser.parse_args()
    fds: list[int] = []
    try:
        for name in (args.port_a, args.port_b):
            fd = os.open(name, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
            fds.append(fd)
        a, b = fds
        # Flush stale input before the test.
        for fd in fds:
            try:
                while os.read(fd, 4096):
                    pass
            except (BlockingIOError, OSError):
                pass

        a_to_b = b"MAANANTAIRASTIT-LINK-A2B-123456\n"
        b_to_a = b"MAANANTAIRASTIT-LINK-B2A-654321\n"
        os.write(a, a_to_b)
        os.write(b, b_to_a)
        got_b = read_until(b, a_to_b, args.timeout)
        got_a = read_until(a, b_to_a, args.timeout)
        ok_b = a_to_b in got_b
        ok_a = b_to_a in got_a
        print(f"A -> B: {'OK' if ok_b else 'EI DATAA'}")
        print(f"B -> A: {'OK' if ok_a else 'EI DATAA'}")
        if not (ok_a and ok_b):
            print("Tarkista TX->RX ristiinkytkentä ja yhteinen GND.")
            return 1
        print("Kaapeliyhteys toimii molempiin suuntiin.")
        return 0
    except OSError as error:
        print(f"Portin avaaminen epäonnistui: {error}")
        return 2
    finally:
        for fd in fds:
            os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
