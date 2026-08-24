"""Policy retrieval. Two backends behind one interface, both returning section-pathed chunks.

qdrant    — Gemini embeddings + vector similarity search against the tenant's Qdrant cluster.
pageindex — structure-aware retrieval: the markdown heading tree is walked and Gemini reasons
            over the node paths to select relevant sections (PageIndex's tree-reasoning model),
            preserving each section's heading path.
"""
import hashlib
import logging
import re
import uuid
from typing import Any, Optional

import httpx

from lib import gemini

logger = logging.getLogger(__name__)
TIMEOUT = httpx.Timeout(30.0, connect=10.0)
MAX_CHUNK = 900


class RetrievalError(RuntimeError):
    pass


# ----------------------------------------------------------------- chunking
def split_sections(content: str) -> list[dict[str, str]]:
    """Split markdown into sections carrying their heading path (e.g. 'WFH Policy > 2. Minimum Service')."""
    lines = content.splitlines()
    sections: list[dict[str, str]] = []
    stack: list[tuple[int, str]] = []
    buf: list[str] = []

    def flush() -> None:
        body = "\n".join(buf).strip()
        if body:
            path = " > ".join(title for _, title in stack) or "Document"
            sections.append({"path": path, "text": body})
        buf.clear()

    for line in lines:
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            flush()
            level = len(m.group(1))
            title = m.group(2).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
        else:
            buf.append(line)
    flush()
    return sections


def chunk_policies(policies: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Flatten every policy into retrievable chunks with a stable id and a heading path."""
    chunks: list[dict[str, str]] = []
    for pol in policies:
        for sec in split_sections(pol.get("content", "")):
            text = sec["text"]
            parts = (
                [text]
                if len(text) <= MAX_CHUNK
                else [text[i : i + MAX_CHUNK] for i in range(0, len(text), MAX_CHUNK)]
            )
            for idx, part in enumerate(parts):
                source = f"{pol['title']} > {sec['path']}" if sec["path"] != "Document" else pol["title"]
                key = f"{pol['id']}:{sec['path']}:{idx}"
                chunks.append(
                    {
                        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, key)),
                        "policy_id": pol["id"],
                        "policy_title": pol["title"],
                        "source": source,
                        "text": part.strip(),
                    }
                )
    return chunks


# ----------------------------------------------------------------- qdrant
def _collection(company_id: str) -> str:
    return "aea_policies_" + hashlib.sha1(company_id.encode()).hexdigest()[:16]


async def _qdrant(client: httpx.AsyncClient, method: str, url: str, key: str, **kw) -> httpx.Response:
    res = await client.request(method, url, headers={"api-key": key}, **kw)
    if res.status_code >= 400:
        raise RetrievalError(f"Qdrant HTTP {res.status_code}: {res.text[:200]}")
    return res


async def qdrant_retrieve(
    *,
    query: str,
    chunks: list[dict[str, str]],
    endpoint: str,
    qdrant_key: str,
    gemini_key: str,
    company_id: str,
    limit: int = 4,
) -> list[dict[str, Any]]:
    if not chunks:
        return []
    base = endpoint.rstrip("/")
    name = _collection(company_id)

    vectors = await gemini.embed(gemini_key, [c["text"] for c in chunks] + [query])
    query_vec = vectors[-1]
    chunk_vecs = vectors[:-1]
    size = len(query_vec)

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        existing = await client.get(f"{base}/collections/{name}", headers={"api-key": qdrant_key})
        if existing.status_code == 404:
            await _qdrant(
                client, "PUT", f"{base}/collections/{name}", qdrant_key,
                json={"vectors": {"size": size, "distance": "Cosine"}},
            )
        elif existing.status_code >= 400:
            raise RetrievalError(f"Qdrant HTTP {existing.status_code}: {existing.text[:200]}")

        # A filterable payload key needs an explicit index. Idempotent, so run it every
        # time — an index created before this code shipped would otherwise be missing.
        await client.put(
            f"{base}/collections/{name}/index?wait=true",
            headers={"api-key": qdrant_key},
            json={"field_name": "company_id", "field_schema": "keyword"},
        )

        points = [
            {
                "id": c["id"],
                "vector": v,
                "payload": {
                    "text": c["text"],
                    "source": c["source"],
                    "policy_id": c["policy_id"],
                    "company_id": company_id,
                },
            }
            for c, v in zip(chunks, chunk_vecs)
        ]
        await _qdrant(
            client, "PUT", f"{base}/collections/{name}/points?wait=true", qdrant_key,
            json={"points": points},
        )
        res = await _qdrant(
            client, "POST", f"{base}/collections/{name}/points/query", qdrant_key,
            json={
                "query": query_vec,
                "limit": limit,
                "with_payload": True,
                # defence in depth: the collection is per-tenant AND filtered by company_id
                "filter": {"must": [{"key": "company_id", "match": {"value": company_id}}]},
            },
        )

    out: list[dict[str, Any]] = []
    for pt in res.json().get("result", {}).get("points", []):
        payload = pt.get("payload") or {}
        out.append(
            {
                "source": payload.get("source", "policy"),
                "text": payload.get("text", ""),
                "score": round(float(pt.get("score", 0.0)), 4),
                "backend": "qdrant",
            }
        )
    return out


# ----------------------------------------------------------------- pageindex
_SELECT_SCHEMA = {
    "type": "object",
    "properties": {
        "selected_paths": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["selected_paths"],
}


async def pageindex_retrieve(
    *,
    query: str,
    chunks: list[dict[str, str]],
    gemini_key: str,
    limit: int = 4,
) -> list[dict[str, Any]]:
    """Reason over the heading tree and return whole sections, heading path preserved."""
    if not chunks:
        return []
    tree = "\n".join(sorted({c["source"] for c in chunks}))
    result = await gemini.generate_json(
        gemini_key,
        "You perform structure-aware retrieval over a document heading tree. "
        "Select only the section paths whose content is needed to answer the question. "
        "Copy paths verbatim from the tree. Select at most 4.",
        f"Question:\n{query}\n\nHeading tree:\n{tree}",
        _SELECT_SCHEMA,
    )
    wanted = [p.strip() for p in result.get("selected_paths", []) if isinstance(p, str)]
    valid = {c["source"] for c in chunks}
    chosen = [p for p in wanted if p in valid][:limit]
    if not chosen:
        chosen = sorted(valid)[:1]

    out: list[dict[str, Any]] = []
    for path in chosen:
        text = "\n".join(c["text"] for c in chunks if c["source"] == path)
        out.append({"source": path, "text": text, "score": None, "backend": "pageindex"})
    return out
