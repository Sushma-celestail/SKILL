"""
Architecture Skill — PRD Preparation Pipeline
Phase 2 utility

Single command that does everything needed before an architecture run:
  Step 1: Convert .docx → .md  (if input is .docx)
  Step 2: Index the .md        (runs index_prd.js)
  Step 3: Print summary        (hash, requirement count, tier hint)

Usage:
  python phase2/prepare_prd.py --prd "path/to/YourPRD.docx"
  python phase2/prepare_prd.py --prd "path/to/YourPRD.md"   (skip conversion)

Output (written to phase2/indexes/):
  prd-index-<date>.json
  prd-source-hash-<date>.json
"""

import sys
import os
import argparse
import subprocess
import json

try:
    import mammoth
except ImportError:
    print("\n[ERROR] mammoth is not installed.")
    print("        Run: pip install mammoth\n")
    sys.exit(1)


# ── Step 1: Convert .docx to .md ─────────────────────────────────────────────

def convert_docx(docx_path: str, out_md: str) -> str:
    print(f"\n{'='*60}")
    print(f"  Step 1: Convert .docx to Markdown")
    print(f"{'='*60}")
    print(f"  Input:  {docx_path}")
    print(f"  Output: {out_md}")

    with open(docx_path, "rb") as f:
        result = mammoth.convert_to_markdown(f)

    os.makedirs(os.path.dirname(out_md) if os.path.dirname(out_md) else ".", exist_ok=True)
    with open(out_md, "w", encoding="utf-8") as f:
        f.write(result.value)

    size_kb = round(len(result.value) / 1024, 1)
    print(f"  Size:   {size_kb} KB")
    if result.messages:
        print(f"  Warnings: {len(result.messages)} (minor formatting issues from Word)")
    print(f"  Done ✅")
    return out_md


# ── Step 2: Index the Markdown PRD ───────────────────────────────────────────

def index_prd(md_path: str, out_dir: str, skill_version: str) -> dict:
    print(f"\n{'='*60}")
    print(f"  Step 2: Index PRD requirements")
    print(f"{'='*60}")
    print(f"  Input:  {md_path}")
    print(f"  Output: {out_dir}")

    # Find index_prd.js relative to this script
    script_dir   = os.path.dirname(os.path.abspath(__file__))
    indexer_path = os.path.join(script_dir, "index_prd.js")

    if not os.path.exists(indexer_path):
        print(f"  [ERROR] index_prd.js not found at: {indexer_path}")
        sys.exit(1)

    cmd = [
        "node", indexer_path,
        "--prd",           md_path,
        "--out",           out_dir,
        "--skill-version", skill_version,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(f"  [ERROR] index_prd.js failed:\n{result.stderr}")
        sys.exit(1)

    # Find the latest index file produced
    index_files = sorted([
        f for f in os.listdir(out_dir)
        if f.startswith("prd-index-") and f.endswith(".json")
    ], reverse=True)

    if not index_files:
        print("  [ERROR] No index file found after running indexer.")
        sys.exit(1)

    index_path = os.path.join(out_dir, index_files[0])
    with open(index_path, encoding="utf-8") as f:
        index_data = json.load(f)

    print(f"  Done ✅")
    return index_data


# ── Step 3: Print summary ─────────────────────────────────────────────────────

def print_summary(index_data: dict, prd_path: str) -> None:
    meta = index_data.get("metadata", {})
    reqs = meta.get("requirement_count", 0)
    sections = meta.get("section_count", 0)
    tokens = meta.get("estimated_tokens", 0)
    sha256 = meta.get("prd_sha256", "unknown")
    integrity = (meta.get("integrity_status")
                 or index_data.get("extraction_summary", {}).get("integrity_status")
                 or "unknown")

    # Simple tier hint based on requirement count
    if reqs >= 40:
        tier_hint = "Tier 3  (40+ requirements)"
    elif reqs >= 11:
        tier_hint = "Tier 2  (11–39 requirements)"
    else:
        tier_hint = "Tier 1  (<11 requirements)"

    print(f"\n{'='*60}")
    print(f"  Step 3: Summary")
    print(f"{'='*60}")
    print(f"  PRD file:          {os.path.basename(prd_path)}")
    print(f"  SHA-256:           {sha256[:32]}...")
    print(f"  Sections parsed:   {sections}")
    print(f"  Requirements:      {reqs}")
    print(f"  Estimated tokens:  ~{tokens:,}")
    print(f"  Integrity status:  {integrity.upper()}")
    print(f"  Tier hint:         {tier_hint}")
    print(f"\n  {'✅ Ready for architecture run.' if integrity == 'clean' else '⚠️  Check stale attachment warnings before proceeding.'}")
    print(f"\n{'='*60}")
    print(f"  NEXT STEP: Feed these two files to your AI:")
    print(f"    1. SKILL.md             ← system prompt / instructions")
    print(f"    2. {os.path.basename(prd_path)}  ← PRD input")
    print(f"\n  Include this hash in your prompt for traceability:")
    print(f"    PRD source hash: {sha256}")
    print(f"{'='*60}\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Prepare a PRD for the Architecture Skill (convert + index)."
    )
    parser.add_argument("--prd",   required=True,
                        help="Path to the PRD file (.docx or .md)")
    parser.add_argument("--out",   required=False, default=None,
                        help="Output folder for indexes (default: phase2/indexes/)")
    args = parser.parse_args()

    prd_path = os.path.abspath(args.prd)
    if not os.path.exists(prd_path):
        print(f"\n[ERROR] File not found: {prd_path}\n")
        sys.exit(1)

    # Resolve output directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir    = os.path.abspath(args.out) if args.out else os.path.join(script_dir, "indexes")

    # Read skill version from manifest
    skill_version = "unknown"
    manifest_path = os.path.join(script_dir, "..", "skill-manifest.json")
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, encoding="utf-8") as f:
                skill_version = json.load(f).get("skill_version", "unknown")
        except Exception:
            pass

    print(f"\nArchitecture Skill — PRD Preparation Pipeline")
    print(f"Skill version: {skill_version}")

    # ── Step 1: Convert if .docx ────────────────────────────────────────────
    ext = os.path.splitext(prd_path)[1].lower()
    if ext == ".docx":
        md_path = os.path.splitext(prd_path)[0] + ".md"
        prd_path = convert_docx(prd_path, md_path)
    elif ext == ".md":
        print(f"\n  Input is already Markdown — skipping conversion.")
    else:
        print(f"\n[ERROR] Unsupported file type: {ext}. Provide a .docx or .md file.\n")
        sys.exit(1)

    # ── Step 2: Index ───────────────────────────────────────────────────────
    index_data = index_prd(prd_path, out_dir, skill_version)

    # ── Step 3: Summary ─────────────────────────────────────────────────────
    print_summary(index_data, prd_path)


if __name__ == "__main__":
    main()
