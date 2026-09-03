"""
Architecture Skill — PRD Extractor
Phase 2 utility

Converts a PRD .docx file to Markdown so it can be:
  1. Attached to an AI tool that does not accept .docx
  2. Indexed by index_prd.js

Usage:
  python phase2/extract_prd.py --prd "path/to/YourPRD.docx"
  python phase2/extract_prd.py --prd "path/to/YourPRD.docx" --out "phase2/YourPRD.md"

If --out is omitted, the .md file is saved next to the .docx with the same name.
"""

import sys
import os
import argparse

try:
    import mammoth
except ImportError:
    print("mammoth is not installed. Run: pip install mammoth")
    sys.exit(1)


def extract(docx_path: str, out_path: str) -> None:
    if not os.path.exists(docx_path):
        print(f"File not found: {docx_path}")
        sys.exit(1)

    print(f"Extracting: {docx_path}")

    with open(docx_path, "rb") as f:
        result = mammoth.convert_to_markdown(f)

    os.makedirs(os.path.dirname(out_path) if os.path.dirname(out_path) else ".", exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(result.value)

    size_kb = round(len(result.value) / 1024, 1)
    print(f"Output:     {out_path}")
    print(f"Size:       {size_kb} KB")
    if result.messages:
        print(f"Warnings:   {len(result.messages)}")
        for m in result.messages[:5]:
            print(f"  {m}")
    print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Convert a PRD .docx to Markdown for the Architecture Skill."
    )
    parser.add_argument("--prd",  required=True, help="Path to the .docx PRD file")
    parser.add_argument("--out",  required=False, help="Output .md path (optional)")
    args = parser.parse_args()

    docx_path = os.path.abspath(args.prd)

    if args.out:
        out_path = os.path.abspath(args.out)
    else:
        # Default: same folder, same name, .md extension
        base = os.path.splitext(docx_path)[0]
        out_path = base + ".md"

    extract(docx_path, out_path)


if __name__ == "__main__":
    main()
