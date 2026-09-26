"""Hisobotni ko'rish va yuklab olish. Node'dagi `routes/report.js`."""
from __future__ import annotations

import json

from ..core.report import (
    build_report, render_csv, render_html, render_markdown,
)
from ..core.util import is_date, js_ready

TYPES = ["daily", "weekly", "monthly"]


def _opts(query: dict) -> dict:
    return {
        "type": query.get("type") if query.get("type") in TYPES else "daily",
        "date": query.get("date") if is_date(query.get("date")) else None,
        "from": query.get("from") if is_date(query.get("from")) else None,
        "to": query.get("to") if is_date(query.get("to")) else None,
    }


def preview_report(ctx):
    """Interfeysda ko'rsatish uchun JSON model."""
    return {"report": build_report(ctx["user"], _opts(ctx["query"]))}


def download_report(ctx):
    """Yuklab olish: html | md | csv | json."""
    report = build_report(ctx["user"], _opts(ctx["query"]))
    fmt = ctx["query"].get("format")
    if fmt not in ("html", "md", "csv", "json"):
        fmt = "html"

    p = report["period"]
    slug = p["from"] if p["from"] == p["to"] else f"{p['from']}_{p['to']}"
    base = f"pomodoro-hisobot-{slug}"

    if fmt == "md":
        return {"__raw": {"contentType": "text/markdown; charset=utf-8",
                          "filename": base + ".md", "body": render_markdown(report)}}
    if fmt == "csv":
        return {"__raw": {"contentType": "text/csv; charset=utf-8",
                          "filename": base + ".csv", "body": render_csv(report)}}
    if fmt == "json":
        # Node: `JSON.stringify(report, null, 2)`
        body = json.dumps(js_ready(report), indent=2, ensure_ascii=False)
        return {"__raw": {"contentType": "application/json; charset=utf-8",
                          "filename": base + ".json", "body": body}}
    return {"__raw": {"contentType": "text/html; charset=utf-8",
                      "filename": base + ".html", "body": render_html(report)}}


def view_report(ctx):
    """Brauzerda ochish (chop etish / PDF uchun) — yuklab olmasdan."""
    return {"__html": render_html(build_report(ctx["user"], _opts(ctx["query"])))}
