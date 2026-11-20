"""Build Python 3.12 x86_64 Linux Lambda ZIPs in the project root."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[2]
FUNCTIONS = ("event-normalizer", "analytics-updater")


def package(function: str, output: Path) -> None:
    """Resolve Linux wheels and add only shared source, dependencies and the handler."""
    source = ROOT / "lambdas" / function
    with tempfile.TemporaryDirectory(prefix="habitloop-lambda-") as directory:
        staging = Path(directory) / "package"
        requirements = Path(directory) / "requirements.txt"
        requirements.write_text(
            "\n".join(
                line for line in (source / "requirements.txt").read_text(encoding="utf-8").splitlines()
                if line.strip() != "habitloop-shared"
            ) + "\n", encoding="utf-8", newline="\n",
        )
        subprocess.run(
            [
                sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                "--no-compile", "--only-binary=:all:", "--platform", "manylinux2014_x86_64",
                "--implementation", "cp", "--python-version", "3.12", "--abi", "cp312",
                "--target", str(staging), "--requirement", str(requirements),
                # The shared package is copied below; resolve its dependencies from metadata.
                *shared_dependencies(function),
            ],
            check=True,
        )
        if function == "analytics-updater":
            shutil.copytree(
                ROOT / "services" / "shared" / "src" / "habitloop_shared",
                staging / "habitloop_shared",
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
        shutil.copy2(source / "handler.py", staging / "handler.py")
        # Always replace just this function's prior build, atomically and without stale copies.
        pending = output.with_suffix(".zip.part")
        try:
            with ZipFile(pending, "w", compression=ZIP_DEFLATED) as archive:
                for path in sorted(staging.rglob("*")):
                    if path.is_file() and "__pycache__" not in path.parts:
                        info = ZipInfo(path.relative_to(staging).as_posix(), (2020, 1, 1, 0, 0, 0))
                        info.compress_type = ZIP_DEFLATED
                        info.external_attr = 0o644 << 16
                        archive.writestr(info, path.read_bytes())
            os.replace(pending, output)
        finally:
            pending.unlink(missing_ok=True)


def shared_dependencies(function: str) -> list[str]:
    """Keep the shared dependency list owned by its existing pyproject.toml."""
    if function != "analytics-updater":
        return []
    import tomllib

    with (ROOT / "services" / "shared" / "pyproject.toml").open("rb") as stream:
        return list(tomllib.load(stream)["project"]["dependencies"])


def main() -> None:
    for index, function in enumerate(FUNCTIONS, start=1):
        print(f"[{index} of {len(FUNCTIONS)}] Packaging {function} for Python 3.12 Linux", flush=True)
        package(function, ROOT / f"{function}.zip")
    print("Lambda packages ready in the project root.", flush=True)


if __name__ == "__main__":
    main()
