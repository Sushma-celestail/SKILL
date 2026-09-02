import mammoth, sys, os

docx_path = r"C:\Users\sushma.s\Desktop\Phases\PRD Internal Service Desk Tool_V1.docx"
out_path  = r"C:\Users\sushma.s\Desktop\Phases\phase2\PRD-service-desk-v1.md"

with open(docx_path, "rb") as f:
    result = mammoth.convert_to_markdown(f)

with open(out_path, "w", encoding="utf-8") as f:
    f.write(result.value)

print(f"Extracted to: {out_path}")
print(f"Characters: {len(result.value)}")
if result.messages:
    print(f"Warnings: {len(result.messages)}")
    for m in result.messages[:5]:
        print(f"  {m}")
