#!/usr/bin/env bash
set -e

# Load .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$ROOT_DIR/.env" ]; then
  export $(grep -v '^#' "$ROOT_DIR/.env" | xargs)
fi

API_KEY="${GATEWAY_API_KEY:-$PROXY_API_KEY}"
BASE_URL="${ANTHROPIC_BASE_URL:-http://localhost:8787}"

if [ -z "$API_KEY" ]; then
  echo "Error: GATEWAY_API_KEY or PROXY_API_KEY not found in .env"
  exit 1
fi

echo "Running Claude Code CLI configured to proxy at: $BASE_URL"

PROMPT='chceck typo """## Xiaomi เปิดตัว Xiaomi AI Cube พีซีรัน AI ระดับ 200B ในบ้าน แต่ยังไม่มีกำหนดขาย

Xiaomi เปิดตัว Xiaomi AI Cube พีซีต้นแบบที่รวมเอาชิปทั้งสามตัวที่เปิดตัวในวันนี้มาเป็นชิปสำหรับรัน AI ในบ้าน ตัวเครื่องมีหน่วยความจำรวม 160GB สามารถรันโมเดลได้สูงสุด 200B

ชิปทั้งสามตัวที่ใส่ไว้ใน AI Cube ได้แก่

- XRING O3 ชิปโทรศัพท์มือถือรุ่นสูงสุด ซีพียู 10 คอร์ใหญ่ และกราฟิก 16 คอร์ ใช้หน่วยความจำ LPDDR6 แบนด์วิดท์ 113.8GB/s ส่วน NPU มีพลังประมวลผล 200TOPS และเวกเตอร์ประมวลผลได้ 3.13TFLOPS (ไม่ระบุชนิดข้อมูล)
- XRING O100 ชิปเร่งความเร็วปัญญาประดิษฐ์โดยเฉพา ความเร็วในการส่งผ่านข้อมูลสูงถึง 1.22TB/s แต่จำกัดหน่วยความจำในชิป 28,672 ชุด (ไม่บอกหน่วย และคาดว่าเป็น SRAM ในตัวชิป)
- XRING D100 ชิปเร่งความเร็วปัญญาประดิษฐ์ที่มีซีพียู 20 คอร์และ NPU 16 คอร์ ใส่แรมได้สูงสุด 160GB

ตอนนี้ Xiaomi AI Cube ยังเป็นเครื่องต้นแบบเท่านั้นและยังไม่มีกำหนดว่าจะขายจริงหรือไม่ อย่างไรก็ดี ชิป O3 จะใช้งานในโทรศัพท์เรือธงรุ่นต่อไป ส่วน D100 และ O100 น่าจะใส่ในรถยนต์, โทรศัพท์, หรือหุ่นยนต์ภายในปี 2027

ที่มา — [Times of India](https://timesofindia.indiatimes.com/technology/tech-news/xiaomi-launches-xring-o3-o100-and-d100-in-house-chips-for-phones-ai-and-cars/articleshow/133463349.cms), [Gizmo China](https://www.gizmochina.com/2026/08/24/xiaomi-announces-ai-cube-mini-pc-with-xring-o3-o100-and-d100-to-run-llms-locally/)"""'

ANTHROPIC_BASE_URL="$BASE_URL" \
ANTHROPIC_API_KEY="$API_KEY" \
ANTHROPIC_MODEL="claude-sonnet-5" \
claude -p "$PROMPT" < /dev/null
