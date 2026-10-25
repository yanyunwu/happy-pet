"""Generate the selected online neural cues; fail without substituting another voice.

Install voice-requirements.txt explicitly. An owned --target directory can be
selected with --python-package-directory (VOICE_PYTHON_PACKAGES in the PS wrapper).
An internet connection to the Microsoft Edge speech service is required.
"""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]


async def generate(output, package_directory):
    if sys.version_info < (3, 10):
        raise RuntimeError("Python 3.10+ is required for voice generation.")
    if package_directory:
        packages = Path(package_directory).resolve()
        if not packages.is_dir():
            raise RuntimeError(f"Python package directory does not exist: {packages}")
        sys.path.insert(0, str(packages))
    try:
        import edge_tts
    except ImportError as error:
        raise RuntimeError(
            "Install tools/voice-requirements.txt with your selected Python first. "
            "Use --python-package-directory for an explicit pip --target installation."
        ) from error

    spec = json.loads((ROOT / "art/woodland-voices.json").read_text(encoding="utf-8"))
    if edge_tts.__version__ != spec["toolVersion"]:
        raise RuntimeError(
            f"Expected edge-tts {spec['toolVersion']}; found {edge_tts.__version__}. "
            "Install tools/voice-requirements.txt with your selected Python."
        )
    output = Path(output).resolve()
    if not output.is_relative_to(ROOT) or output == ROOT:
        raise RuntimeError("Voice output must stay inside the minigame project.")
    names = [clip["name"] for clip in spec["clips"]]
    if len(set(names)) != len(names) or any(not re.fullmatch(r"voice-[a-z]+", name) for name in names):
        raise RuntimeError("Voice clip names must be unique voice-* filenames.")
    catalog = await asyncio.wait_for(edge_tts.list_voices(), timeout=30)
    voice = next((item for item in catalog if item["ShortName"] == spec["voice"]), None)
    if not voice or voice["Locale"] != spec["language"]:
        raise RuntimeError(f"The selected neural voice {spec['voice']} is unavailable.")

    output.mkdir(parents=True, exist_ok=True)
    # Finish every network request before replacing any previous source files.
    with tempfile.TemporaryDirectory(prefix="neural-voices-", dir=output) as temporary:
        staging = Path(temporary)
        hashes = {}
        for clip in spec["clips"]:
            source = staging / f"{clip['name']}.source.mp3"
            speech = edge_tts.Communicate(
                clip["text"], spec["voice"], rate=spec["rate"],
                pitch=spec["pitch"], volume=spec["volume"],
            )
            await asyncio.wait_for(speech.save(str(source)), timeout=55)
            if source.stat().st_size < 1024:
                raise RuntimeError(f"Speech service returned an empty clip: {clip['name']}")
            hashes[clip["name"]] = hashlib.sha256(source.read_bytes()).hexdigest()
            print(f"Synthesized {clip['name']} with {spec['voice']}.", flush=True)
        engine = {field: spec[field] for field in (
            "provider", "engine", "tool", "toolVersion", "voice", "language", "rate", "pitch", "volume",
        )}
        engine["sourceHashes"] = hashes
        (staging / "voice-engine.json").write_text(
            json.dumps(engine, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
        )
        for source in staging.iterdir():
            source.replace(output / source.name)
    print(f"Generated {len(names)} neural voice sources.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-directory", required=True)
    parser.add_argument("--python-package-directory")
    arguments = parser.parse_args()
    try:
        asyncio.run(generate(arguments.output_directory, arguments.python_package_directory))
    except (RuntimeError, asyncio.TimeoutError) as error:
        parser.exit(1, f"Neural voice generation failed: {error}\n")
