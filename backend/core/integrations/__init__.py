"""
Tashqi tizim mijozlari. Node'dagi `lib/integrations/` ning ko'chirmasi.

Bitta ataylab qilingan o'zgarish bor: Node'da `fetch` ga TIMEOUT berilmagan,
ya'ni Jira javob bermay qolsa so'rov cheksiz osilib turardi. Bu yerda
`TIMEOUT` qo'yildi — reja hujjatida shunday kelishilgan (5-bosqich).
Qolgan hamma narsa: xato matnlari, status tekshiruvlari, zaxira endpointlar —
bayt-ma-bayt o'sha.
"""
from __future__ import annotations

TIMEOUT = 15.0


class IntegrationError(Exception):
    """
    Node `throw new Error(msg)` ning o'rni.

    Marshrutlar `err.message` ni o'qiydi — Python'da `str(exc)` shu matnni
    beradi, shuning uchun alohida maydon kerak emas.
    """
