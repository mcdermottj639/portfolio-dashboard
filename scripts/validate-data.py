#!/usr/bin/env python3
"""Validate published JSON without network access, decryption, or payload logging.

No arguments checks data.json and every JSON file under data/, including the
three required public feeds. Explicit paths validate only those selected files.
This is a serialization gate, not a freshness, research, or trading approval.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = ('data.json', 'data/apex-targets.json', 'data/business.json', 'data/predictions.json')


class DataError(ValueError):
    """A safe-to-log category; never includes payload values or keys."""


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DataError('duplicate object key')
        result[key] = value
    return result


def finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise DataError('non-finite number')
    return number


def finite_int(value: str) -> int:
    # JSON integer literals also become JavaScript Numbers in the dashboard.
    number = int(value)
    try:
        if not math.isfinite(float(number)):
            raise DataError('non-finite number')
    except OverflowError:
        raise DataError('non-finite number') from None
    return number


def reject_constant(_value: str) -> None:
    raise DataError('non-standard numeric constant')


def validate_file(path: Path) -> None:
    if path.is_symlink():
        raise DataError('symlink is not a published JSON file')
    try:
        value = json.loads(path.read_text(encoding='utf-8'),
                           object_pairs_hook=unique_object,
                           parse_float=finite_float,
                           parse_int=finite_int,
                           parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        # The exception's normal string can contain private payload fragments.
        raise DataError(f'invalid JSON at line {exc.lineno}, column {exc.colno}') from None
    except UnicodeError:
        raise DataError('invalid UTF-8') from None
    except OSError:
        raise DataError('missing or unreadable file') from None
    except (RecursionError, ValueError) as exc:
        if isinstance(exc, DataError):
            raise
        raise DataError('unsupported JSON numeric value or nesting') from None
    if not isinstance(value, (dict, list)):
        raise DataError('root must be an object or array')


def discover_json(root: Path) -> set[str]:
    """Enumerate data entries without following or silently skipping links."""
    data = root / 'data'
    if data.is_symlink():
        raise DataError('symlink is not a published JSON path')
    if not data.exists():
        return set()  # Required missing feeds are rejected by validate_file.
    names: set[str] = set()
    pending = [data]
    try:
        while pending:
            directory = pending.pop()
            for path in directory.iterdir():
                if path.is_symlink():
                    raise DataError('symlink is not a published JSON path')
                if path.is_dir():
                    pending.append(path)
                elif path.suffix == '.json':
                    names.add(path.relative_to(root).as_posix())
    except OSError:
        raise DataError('missing or unreadable data directory') from None
    return names


def selected_files(root: Path, arguments: list[str]) -> list[Path]:
    names = arguments or sorted(set(REQUIRED) | discover_json(root))
    paths = []
    for name in names:
        candidate = root / name
        try:
            relative = candidate.resolve().relative_to(root.resolve())
        except ValueError:
            raise DataError('selected path is outside the repository') from None
        if relative.suffix != '.json' or not (relative == Path('data.json') or relative.parts[0] == 'data'):
            raise DataError('selected path must be data.json or a JSON file under data/')
        # Resolving for the boundary check must not silently follow a symlink.
        if any(p.is_symlink() for p in [candidate, *candidate.parents] if p != root.parent):
            raise DataError('symlink is not a published JSON path')
        paths.append(candidate)
    return sorted(set(paths))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='*', help='Optional published JSON paths relative to the repository root')
    args = parser.parse_args(argv)
    try:
        paths = selected_files(ROOT, args.paths)
    except DataError as exc:
        print(f'Data validation failed: {exc}', file=sys.stderr)
        return 1
    failed = 0
    for path in paths:
        try:
            validate_file(path)
        except DataError as exc:
            # Do not log filenames from untrusted payloads or the payload itself.
            print(f'Data validation failed: {json.dumps(path.relative_to(ROOT).as_posix())}: {exc}', file=sys.stderr)
            failed += 1
    print(f'Published JSON: {len(paths) - failed}/{len(paths)} files valid; no payload content logged.')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
