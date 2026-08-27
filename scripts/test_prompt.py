#!/usr/bin/env python3
import os
import sys
from pathlib import Path

# Load .env file
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

gateway_key = os.environ.get("GATEWAY_API_KEY") or os.environ.get("PROXY_API_KEY") or "proxy-secret"
base_url = os.environ.get("ANTHROPIC_BASE_URL") or os.environ.get("PROXY_BASE_URL") or "http://localhost:8787"

try:
    import anthropic
except ImportError:
    print("anthropic package not found. Installing/running with uv or pip recommended.")
    print("Example: uv run --with anthropic python scripts/test_prompt.py")
    sys.exit(1)

prompt_text = """chceck typo \"\"\"## Xiaomi เปิดตัว Xiaomi AI Cube พีซีรัน AI ระดับ 200B ในบ้าน แต่ยังไม่มีกำหนดขาย

Xiaomi เปิดตัว Xiaomi AI Cube พีซีต้นแบบที่รวมเอาชิปทั้งสามตัวที่เปิดตัวในวันนี้มาเป็นชิปสำหรับรัน AI ในบ้าน ตัวเครื่องมีหน่วยความจำรวม 160GB สามารถรันโมเดลได้สูงสุด 200B

ชิปทั้งสามตัวที่ใส่ไว้ใน AI Cube ได้แก่

- XRING O3 ชิปโทรศัพท์มือถือรุ่นสูงสุด ซีพียู 10 คอร์ใหญ่ และกราฟิก 16 คอร์ ใช้หน่วยความจำ LPDDR6 แบนด์วิดท์ 113.8GB/s ส่วน NPU มีพลังประมวลผล 200TOPS และเวกเตอร์ประมวลผลได้ 3.13TFLOPS (ไม่ระบุชนิดข้อมูล)
- XRING O100 ชิปเร่งความเร็วปัญญาประดิษฐ์โดยเฉพา ความเร็วในการส่งผ่านข้อมูลสูงถึง 1.22TB/s แต่จำกัดหน่วยความจำในชิป 28,672 ชุด (ไม่บอกหน่วย และคาดว่าเป็น SRAM ในตัวชิป)
- XRING D100 ชิปเร่งความเร็วปัญญาประดิษฐ์ที่มีซีพียู 20 คอร์และ NPU 16 คอร์ ใส่แรมได้สูงสุด 160GB

ตอนนี้ Xiaomi AI Cube ยังเป็นเครื่องต้นแบบเท่านั้นและยังไม่มีกำหนดว่าจะขายจริงหรือไม่ อย่างไรก็ดี ชิป O3 จะใช้งานในโทรศัพท์เรือธงรุ่นต่อไป ส่วน D100 และ O100 น่าจะใส่ในรถยนต์, โทรศัพท์, หรือหุ่นยนต์ภายในปี 2027

ที่มา — [Times of India](https://timesofindia.indiatimes.com/technology/tech-news/xiaomi-launches-xring-o3-o100-and-d100-in-house-chips-for-phones-ai-and-cars/articleshow/133463349.cms), [Gizmo China](https://www.gizmochina.com/2026/08/24/xiaomi-announces-ai-cube-mini-pc-with-xring-o3-o100-and-d100-to-run-llms-locally/)\"\"\""""

print(f"Connecting to proxy at: {base_url}")
print(f"Using API Key: {gateway_key[:8]}...{gateway_key[-4:] if len(gateway_key) > 12 else ''}")
print(f"Exposed Model: claude-sonnet-5\n")

client = anthropic.Anthropic(
    api_key=gateway_key,
    base_url=base_url,
)

print("Streaming response:")
print("=" * 60)
with client.messages.stream(
    model="claude-sonnet-5",
    max_tokens=4096,
    messages=[{"role": "user", "content": prompt_text}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
    print()
print("=" * 60)
print("Done.")
