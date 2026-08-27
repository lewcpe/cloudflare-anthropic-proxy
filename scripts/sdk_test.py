#!/usr/bin/env python3
import os
import sys

try:
    import anthropic
except ImportError:
    print("Error: anthropic package is required. Run with `uv run --with anthropic python scripts/sdk_test.py`")
    sys.exit(1)

proxy_api_key = os.environ.get("PROXY_API_KEY", "proxy-secret")
base_url = os.environ.get("PROXY_BASE_URL", "http://localhost:8787")

client = anthropic.Anthropic(
    api_key=proxy_api_key,
    base_url=base_url,
)

print(f"Testing non-streaming request to {base_url} exposing claude-sonnet-5...")
response = client.messages.create(
    model="claude-sonnet-5",
    max_tokens=300,
    messages=[{"role": "user", "content": "What is the origin of the phrase Hello, World"}],
)

print("Response received:")
print(f"ID: {response.id}")
print(f"Model: {response.model}")
print(f"Content: {response.content[0].text if response.content else ''}")

print("\nTesting streaming request...")
with client.messages.stream(
    model="claude-sonnet-5",
    max_tokens=300,
    messages=[{"role": "user", "content": "Tell me a short 1-sentence joke."}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
    print()

print("\nAll SDK checks passed!")
