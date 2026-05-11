#!/usr/bin/env python3
"""Install a skill from GitHub URL or local directory."""

import argparse
import json
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


def get_skills_dir() -> Path:
    """Get the skills directory."""
    cwd = Path(os.getcwd())
    skills_dir = cwd / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    return skills_dir


def install_from_local(local_path: str, skills_dir: Path) -> bool:
    """Install skill from a local directory."""
    src = Path(local_path).resolve()
    if not src.is_dir():
        print(f"Error: {local_path} is not a directory", file=sys.stderr)
        return False

    skill_md = src / "SKILL.md"
    if not skill_md.exists():
        print(f"Error: No SKILL.md found in {local_path}", file=sys.stderr)
        return False

    dest = skills_dir / src.name
    if dest.exists():
        print(f"Error: Skill {src.name} already exists at {dest}", file=sys.stderr)
        return False

    shutil.copytree(src, dest)
    print(f"Installed skill: {src.name} -> {dest}")
    return True


def install_from_url(url: str, skills_dir: Path) -> bool:
    """Install skill from a GitHub URL."""
    # Parse GitHub URL: https://github.com/owner/repo/tree/branch/path/to/skill
    parts = url.replace("https://github.com/", "").split("/")
    if len(parts) < 5 or "tree" not in parts:
        print(f"Error: Invalid GitHub URL format: {url}", file=sys.stderr)
        return False

    owner = parts[0]
    repo = parts[1]
    tree_idx = parts.index("tree")
    branch = parts[tree_idx + 1]
    skill_path = "/".join(parts[tree_idx + 2:])
    skill_name = Path(skill_path).name

    dest = skills_dir / skill_name
    if dest.exists():
        print(f"Error: Skill {skill_name} already exists at {dest}", file=sys.stderr)
        return False

    # Download via GitHub API
    api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{skill_path}?ref={branch}"
    try:
        req = urllib.request.Request(api_url, headers={"Accept": "application/vnd.github.v3+json"})
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"Error: Failed to fetch from GitHub API: {e}", file=sys.stderr)
        return False

    if not isinstance(data, list):
        data = [data]

    dest.mkdir(parents=True, exist_ok=True)

    for item in data:
        if item["type"] == "file":
            file_url = item["download_url"]
            file_name = item["name"]
            try:
                with urllib.request.urlopen(file_url) as resp:
                    content = resp.read()
                (dest / file_name).write_bytes(content)
                print(f"  Downloaded: {file_name}")
            except Exception as e:
                print(f"  Warning: Failed to download {file_name}: {e}", file=sys.stderr)

    print(f"Installed skill: {skill_name} -> {dest}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Install a skill")
    parser.add_argument("--url", help="GitHub URL to install from")
    parser.add_argument("--local", help="Local directory to install from")
    args = parser.parse_args()

    skills_dir = get_skills_dir()

    if args.url:
        success = install_from_url(args.url, skills_dir)
    elif args.local:
        success = install_from_local(args.local, skills_dir)
    else:
        print("Error: Provide --url or --local", file=sys.stderr)
        success = False

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
