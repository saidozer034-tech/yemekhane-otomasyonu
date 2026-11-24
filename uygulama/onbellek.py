import json
import os
import secrets
from datetime import datetime
import redis

OTURUM_SURESI_SN = 1800  # 30 dakika


def _redis_istemci():
    return redis.Redis(
        host=os.getenv("REDIS_HOST", "redis"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        decode_responses=True,
    )


def oturum_olustur(kullanici_id: int) -> str:
    token = secrets.token_hex(24)
    r = _redis_istemci()
    r.setex(f"oturum:{token}", OTURUM_SURESI_SN, str(kullanici_id))
    return token


def oturum_dogrula_ve_yenile(token: str) -> int | None:
    r = _redis_istemci()
    anahtar = f"oturum:{token}"
    kullanici_id = r.get(anahtar)
    if not kullanici_id:
        return None
    r.expire(anahtar, OTURUM_SURESI_SN)
    return int(kullanici_id)


def oturum_sil(token: str) -> None:
    r = _redis_istemci()
    r.delete(f"oturum:{token}")


def menu_anahtari(yemekhane_id: int, tarih: str, ogun_id: int) -> str:
    return f"menu:{yemekhane_id}:{tarih}:{ogun_id}"


def menu_getir(yemekhane_id: int, tarih: str, ogun_id: int) -> dict | None:
    r = _redis_istemci()
    ham = r.get(menu_anahtari(yemekhane_id, tarih, ogun_id))
    if not ham:
        return None
    return json.loads(ham)


def menu_kaydet(yemekhane_id: int, tarih: str, ogun_id: int, veri: dict) -> None:
    r = _redis_istemci()
    anahtar = menu_anahtari(yemekhane_id, tarih, ogun_id)
    simdi = datetime.now()
    gun_sonu = datetime.strptime(tarih, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    kalan = int((gun_sonu - simdi).total_seconds())
    ttl = kalan if kalan > 0 else 300
    r.setex(anahtar, ttl, json.dumps(veri, ensure_ascii=False))


def menu_sil(yemekhane_id: int, tarih: str, ogun_id: int) -> None:
    r = _redis_istemci()
    r.delete(menu_anahtari(yemekhane_id, tarih, ogun_id))
