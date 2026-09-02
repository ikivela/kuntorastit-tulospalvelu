#!/usr/bin/env python3
"""Emulate the current EMIT 250 reader PoC over a virtual serial port.

The PoC decoder expects a 217-byte frame XOR-encoded with 0xDF.  This is
intentionally not a complete/validated EMIT protocol implementation.
"""

from __future__ import annotations

import argparse
import os
import sys
import termios
import time

FRAME_LENGTH = 217
XOR_MASK = 0xDF


def configure_serial(fd: int) -> None:
    attrs = termios.tcgetattr(fd)
    attrs[0] = 0
    attrs[1] = 0
    attrs[2] = termios.CLOCAL | termios.CREAD | termios.CS8 | termios.CSTOPB
    attrs[3] = 0
    attrs[4] = termios.B9600
    attrs[5] = termios.B9600
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    termios.tcflush(fd, termios.TCIOFLUSH)


def make_frame(card_number: int, sequence: int) -> bytes:
    if not 0 <= card_number <= 0xFFFFFF:
        raise ValueError("card number must fit in 3 bytes (0..16777215)")
    decoded = bytearray(FRAME_LENGTH)
    decoded[0:2] = b"\xff\xff"
    decoded[2:5] = card_number.to_bytes(3, "little")
    decoded[6] = 20  # production week
    decoded[7] = 126  # production year (2026 in the legacy format)
    decoded[10:13] = bytes((31, 0x2C, 0x01))  # control 31 at 300 seconds
    # Deterministic filler makes the raw frame easy to recognize in traces.
    for index in range(13, FRAME_LENGTH - 1):
        decoded[index] = (index + sequence) & 0xFF
    decoded[-1] = (-sum(decoded[:-1])) & 0xFF
    return bytes(value ^ XOR_MASK for value in decoded)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--card", type=int, default=123456, help="card number (default: 123456)")
    parser.add_argument("--interval", type=float, default=3.0, help="seconds between frames (default: 3)")
    parser.add_argument("--once", action="store_true", help="send one frame and exit")
    parser.add_argument("--port", default="/dev/cu.usbserial-FTDBLBY5", help="physical serial device")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.interval <= 0:
        raise SystemExit("--interval must be positive")

    port_name = args.port
    try:
        # macOS cu.* devices require a read/write open for correct modem-line
        # initialisation, even though the emulator only writes frames.
        port = os.open(port_name, os.O_RDWR | os.O_NOCTTY)
        configure_serial(port)
    except OSError as error:
        raise SystemExit(f"Sarjaportin avaaminen epäonnistui ({port_name}): {error}") from error

    print(f"Fyysinen sarjaportti: {port_name}", flush=True)
    
    print("Lopeta painamalla Ctrl+C.", flush=True)

    sequence = 0
    try:
        while True:
            os.write(port, make_frame(args.card, sequence))
            print(f"Lähetetty kortti {args.card} ({FRAME_LENGTH} tavua)", flush=True)
            if args.once:
                return 0
            sequence += 1
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("Emulaattori pysäytetty.", file=sys.stderr)
        return 0
    finally:
        os.close(port)


if __name__ == "__main__":
    raise SystemExit(main())
