import secrets
from datetime import date
import bcrypt
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import veritabani as db

app = FastAPI(title="Yemekhane Otomasyonu API")

# Aşama 2 için bellek içi oturum deposu (Aşama 3'te Redis'e taşınacak)
OTURUMLAR: dict[str, int] = {}


class GirisIstegi(BaseModel):
    eposta: str
    sifre: str


class RezervasyonIstegi(BaseModel):
    menu_id: int


class BakiyeYukleIstegi(BaseModel):
    tutar: float


class DegerlendirmeIstegi(BaseModel):
    menu_id: int
    puan: int = Field(ge=1, le=5)
    yorum: str = ""


class MenuKaydetIstegi(BaseModel):
    yemekhane_id: int
    tarih: str
    ogun_id: int
    ogrenci_fiyati: float = Field(ge=0)
    personel_fiyati: float = Field(ge=0)
    yemek_idler: list[int]


@app.exception_handler(db.IsKuraliHatasi)
async def is_kurali_hata_yakalayici(_, exc: db.IsKuraliHatasi):
    return JSONResponse(status_code=400, content={"hata": str(exc)})


def _aktif_kullanici(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Oturum açmanız gerekiyor.")
    token = authorization.removeprefix("Bearer ").strip()
    kullanici_id = OTURUMLAR.get(token)
    if not kullanici_id:
        raise HTTPException(status_code=401, detail="Oturum geçersiz veya süresi dolmuş.")
    kullanici = db.kullanici_getir_kaynaktan(kullanici_id)
    if not kullanici:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı.")
    return kullanici


def _yonetici_kontrol(authorization: str | None) -> dict:
    kullanici = _aktif_kullanici(authorization)
    if kullanici["rol"] != "yonetici":
        raise HTTPException(status_code=403, detail="Bu işlem için yönetici yetkisi gerekir.")
    return kullanici


@app.get("/api/")
def kok():
    return {"durum": "calisiyor", "servis": "Yemekhane Web API"}


@app.post("/api/giris")
def giris(veri: GirisIstegi):
    kullanici = db.kullanici_bul_eposta(veri.eposta.strip().lower())
    if not kullanici or not kullanici.get("aktif"):
        return JSONResponse(status_code=401, content={"hata": "E-posta veya şifre hatalı."})

    sifre_dogru = bcrypt.checkpw(
        veri.sifre.encode("utf-8"),
        kullanici["sifre_hash"].encode("utf-8"),
    )
    if not sifre_dogru:
        return JSONResponse(status_code=401, content={"hata": "E-posta veya şifre hatalı."})

    token = secrets.token_hex(24)
    OTURUMLAR[token] = int(kullanici["id"])
    kullanici.pop("sifre_hash", None)
    return {"token": token, "kullanici": kullanici}


@app.post("/api/cikis")
def cikis(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        OTURUMLAR.pop(token, None)
    return {"mesaj": "Çıkış yapıldı."}


@app.get("/api/ben")
def ben(authorization: str | None = Header(default=None)):
    kullanici = _aktif_kullanici(authorization)
    return {"kullanici": kullanici}


@app.get("/api/sabitler")
def sabitler(authorization: str | None = Header(default=None)):
    _aktif_kullanici(authorization)
    return db.sabitler_getir()


@app.get("/api/gunun-menusu")
def gunun_menusu(
    yemekhane_id: int = Query(default=1),
    tarih: str = Query(default_factory=lambda: date.today().isoformat()),
    ogun_id: int = Query(default=2),
    authorization: str | None = Header(default=None),
):
    _aktif_kullanici(authorization)
    menu = db.gunun_menusu_getir(yemekhane_id, tarih, ogun_id)
    return {"menu": menu}


@app.get("/api/haftalik-menu")
def haftalik_menu(
    yemekhane_id: int = Query(default=1),
    authorization: str | None = Header(default=None),
):
    kullanici = _aktif_kullanici(authorization)
    menuler = db.haftalik_menuler_getir(yemekhane_id, int(kullanici["id"]))
    return {"menuler": menuler}


@app.post("/api/rezervasyonlar")
def yeni_rezervasyon(
    veri: RezervasyonIstegi,
    authorization: str | None = Header(default=None),
):
    kullanici = _aktif_kullanici(authorization)
    sonuc = db.rezervasyon_yap(int(kullanici["id"]), veri.menu_id)
    return {"mesaj": "Rezervasyon oluşturuldu.", **sonuc}


@app.post("/api/rezervasyonlar/{rezervasyon_id}/iptal")
def rezervasyon_iptal(
    rezervasyon_id: int,
    authorization: str | None = Header(default=None),
):
    kullanici = _aktif_kullanici(authorization)
    sonuc = db.rezervasyon_iptal(int(kullanici["id"]), rezervasyon_id)
    return {"mesaj": "Rezervasyon iptal edildi.", **sonuc}


@app.get("/api/rezervasyonlarim")
def rezervasyonlarim(authorization: str | None = Header(default=None)):
    kullanici = _aktif_kullanici(authorization)
    liste = db.rezervasyonlarim_getir(int(kullanici["id"]))
    return {"rezervasyonlar": liste}


@app.get("/api/bakiye")
def bakiye_bilgisi(authorization: str | None = Header(default=None)):
    kullanici = _aktif_kullanici(authorization)
    hareketler = db.bakiye_hareketleri_getir(int(kullanici["id"]))
    return {"bakiye": kullanici["bakiye"], "hareketler": hareketler}


@app.post("/api/bakiye/yukle")
def bakiye_yukle(
    veri: BakiyeYukleIstegi,
    authorization: str | None = Header(default=None),
):
    kullanici = _aktif_kullanici(authorization)
    sonuc = db.bakiye_yukle(int(kullanici["id"]), veri.tutar)
    return {"mesaj": "Bakiye yüklendi.", **sonuc}


@app.post("/api/degerlendirmeler")
def degerlendirme_ekle(
    veri: DegerlendirmeIstegi,
    authorization: str | None = Header(default=None),
):
    kullanici = _aktif_kullanici(authorization)
    db.degerlendirme_kaydet(int(kullanici["id"]), veri.menu_id, veri.puan, veri.yorum)
    return {"mesaj": "Değerlendirmeniz kaydedildi."}


@app.get("/api/yonetici/veriler")
def yonetici_verileri(authorization: str | None = Header(default=None)):
    _yonetici_kontrol(authorization)
    return {
        "yemekler": db.tum_yemekler_getir(),
        "menuler": db.yonetici_menuler_getir(),
    }


@app.post("/api/yonetici/menuler")
def yonetici_menu_olustur(
    veri: MenuKaydetIstegi,
    authorization: str | None = Header(default=None),
):
    _yonetici_kontrol(authorization)
    menu_id = db.yonetici_menu_kaydet(
        veri.yemekhane_id,
        veri.tarih,
        veri.ogun_id,
        veri.ogrenci_fiyati,
        veri.personel_fiyati,
        veri.yemek_idler,
    )
    return {"mesaj": "Menü kaydedildi.", "menu_id": menu_id}
