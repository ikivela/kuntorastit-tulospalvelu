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
SCENARIOS = {
    "a-hyvaksytty": {
        "card": 123456,
        "punches": [(31, 95), (32, 79), (33, 89), (31, 88), (34, 93), (35, 88), (31, 89), (100, 85)],
        "description": "Yliopistokeskus-sprintti / A-rata / hyväksytty",
    },
    "a-hylatty": {
        "card": 654321,
        "punches": [(31, 102), (32, 86), (99, 93), (31, 89), (34, 96), (35, 92), (31, 93), (100, 91)],
        "description": "Yliopistokeskus-sprintti / A-rata / hylätty (väärä rasti 99)",
    },
    "halkokari-e-hyvaksytty": {
        "card": 54021,
        "punches": [(137, 265), (38, 238), (158, 252), (138, 231), (41, 246), (45, 224), (141, 259), (40, 243), (43, 235), (157, 267), (44, 229), (78, 248), (32, 236), (50, 218)],
        "description": "Halkokari 2026 / E-rata / hyväksytty",
    },
    "halkokari-e-hylatty": {
        "card": 32012,
        "punches": [(137, 265), (38, 238), (99, 252), (138, 231), (41, 246), (45, 224), (141, 259), (40, 243), (43, 235), (157, 267), (44, 229), (78, 248), (32, 236), (50, 218)],
        "description": "Halkokari 2026 / E-rata / hylätty (rastin 158 tilalla 99)",
    },
}


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


def make_frame(card_number: int, punches: list[tuple[int, int]]) -> bytes:
    if not 0 <= card_number <= 0xFFFFFF:
        raise ValueError("card number must fit in 3 bytes (0..16777215)")
    decoded = bytearray(FRAME_LENGTH)
    decoded[0:2] = b"\xff\xff"
    decoded[2:5] = card_number.to_bytes(3, "little")
    decoded[6] = 20  # production week
    decoded[7] = 126  # production year (2026 in the legacy format)
    if len(punches) > 50:
        raise ValueError("at most 50 punches fit in an EMIT 250 frame")
    for index, (control_code, time_seconds) in enumerate(punches):
        if not 0 <= control_code <= 0xFF or not 0 <= time_seconds <= 0xFFFF:
            raise ValueError("invalid control code or punch time")
        offset = 10 + index * 3
        decoded[offset] = control_code
        decoded[offset + 1 : offset + 3] = time_seconds.to_bytes(2, "little")
    decoded[-1] = (-sum(decoded[:-1])) & 0xFF
    return bytes(value ^ XOR_MASK for value in decoded)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--card", type=int, help="override scenario card number")
    parser.add_argument(
        "--scenario",
        choices=SCENARIOS,
        default="a-hyvaksytty",
        help="test scenario (default: a-hyvaksytty)",
    )
    parser.add_argument("--interval", type=float, default=3.0, help="seconds between frames (default: 3)")
    parser.add_argument("--once", action="store_true", help="send one frame and exit")
    parser.add_argument("--port", default="/dev/cu.usbserial-FTDBLBY5", help="physical serial device")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.interval <= 0:
        raise SystemExit("--interval must be positive")

    scenario = SCENARIOS[args.scenario]
    card_number = args.card if args.card is not None else scenario["card"]
    punches = scenario["punches"]
    port_name = args.port
    try:
        # macOS cu.* devices require a read/write open for correct modem-line
        # initialisation, even though the emulator only writes frames.
        port = os.open(port_name, os.O_RDWR | os.O_NOCTTY)
        configure_serial(port)
    except OSError as error:
        raise SystemExit(f"Sarjaportin avaaminen epäonnistui ({port_name}): {error}") from error

    print(f"Fyysinen sarjaportti: {port_name}", flush=True)
    print(f"Skenaario: {scenario['description']}", flush=True)
    print(f"Kortti: {card_number}, leimoja: {len(punches)}", flush=True)
    print("Lopeta painamalla Ctrl+C.", flush=True)

    sequence = 0
    try:
        while True:
            os.write(port, make_frame(card_number, punches))
            print(f"Lähetetty kortti {card_number} ({FRAME_LENGTH} tavua)", flush=True)
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
