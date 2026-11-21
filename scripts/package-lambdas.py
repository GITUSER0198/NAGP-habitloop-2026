"""Build the Node.js 22 Lambda ZIPs in the project root.

Each ZIP holds one file, handler.js: the esbuild bundle (lambdas/<name>/dist/handler.js)
with the shared library, jose and the AWS SDK clients inlined, so no node_modules ship.
"""

import os
from pathlib import Path
import shutil
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[2]
FUNCTIONS = ("event-normalizer", "analytics-updater")


def npm(*arguments: str) -> None:
    executable = shutil.which("npm")
    if executable is None:
        raise SystemExit("Node.js 22 with npm must be on PATH to package the Lambdas.")
    subprocess.run([executable, *arguments], cwd=ROOT, check=True)


def build() -> None:
    """Install if needed, then bundle the shared library and both handlers."""
    if not (ROOT / "node_modules").is_dir():
        npm("ci", "--no-audit", "--no-fund")
    npm("run", "build", "-w", "@habitloop/shared")
    for function in FUNCTIONS:
        npm("run", "build", "-w", f"@habitloop/{function}")


def package(function: str, output: Path) -> None:
    bundle = ROOT / "lambdas" / function / "dist" / "handler.js"
    if not bundle.is_file():
        raise SystemExit(f"Missing {bundle}; the esbuild step did not produce it.")
    # Replace only this function's prior build, atomically and without stale copies.
    pending = output.with_suffix(".zip.part")
    try:
        with ZipFile(pending, "w", compression=ZIP_DEFLATED) as archive:
            info = ZipInfo("handler.js", (2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, bundle.read_bytes())
        os.replace(pending, output)
    finally:
        pending.unlink(missing_ok=True)


def main() -> None:
    print("[1 of 3] Building the shared library and Lambda bundles", flush=True)
    build()
    for index, function in enumerate(FUNCTIONS, start=2):
        print(f"[{index} of 3] Packaging {function} for Node.js 22", flush=True)
        package(function, ROOT / f"{function}.zip")
    print("Lambda packages ready in the project root.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
