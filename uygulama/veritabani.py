import os
from decimal import Decimal
import pymysql
from pymysql.cursors import DictCursor


class IsKuraliHatasi(Exception):
    """Veritabanı stored procedure (SQLSTATE 45000 / kod 1644) iş kuralı hatası."""


def _baglan(host: str, autocommit: bool = True):
    return pymysql.connect(
        host=host,
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_KULLANICI", "yemekhane_app"),
        password=os.getenv("DB_SIFRE", "Uyg_2026"),
        database=os.getenv("DB_ADI", "yemekhane"),
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=autocommit,
    )


def okuma_baglantisi():
    return _baglan(os.getenv("DB_OKUMA_HOST", "mysql-replica"), autocommit=True)


def yazma_baglantisi(autocommit: bool = True):
    return _baglan(os.getenv("DB_YAZMA_HOST", "mysql-primary"), autocommit=autocommit)


def _serilestir(satir: dict) -> dict:
    sonuc = {}
    for k, v in satir.items():
        if isinstance(v, Decimal):
            sonuc[k] = float(v)
        elif hasattr(v, "isoformat"):
            sonuc[k] = v.isoformat(sep=" ") if hasattr(v, "hour") else v.isoformat()
        else:
            sonuc[k] = v
    return sonuc


def _yordam_cagir(sql: str, params: tuple) -> dict:
    conn = yazma_baglantisi(autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            satir = cur.fetchone()
            return _serilestir(satir) if satir else {}
    except pymysql.MySQLError as hata:
        if hata.args and hata.args[0] == 1644:
            raise IsKuraliHatasi(str(hata.args[1]))
        raise
    finally:
        conn.close()


def kullanici_bul_eposta(eposta: str) -> dict | None:
    conn = okuma_baglantisi()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, ad, soyad, eposta, sifre_hash, rol, ogrenci_no, bakiye, aktif
                  FROM kullanicilar
                 WHERE eposta = %s
                """,
                (eposta,),
            )
            satir = cur.fetchone()
            return _serilestir(satir) if satir else None
    finally:
        conn.close()


def kullanici_getir_kaynaktan(kullanici_id: int) -> dict | None:
    """Rezervasyon/iptal/yükleme sonrası güncel bakiye replikasyon gecikmesine takılmadan kaynaktan okunur."""
    conn = yazma_baglantisi(autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, ad, soyad, eposta, rol, ogrenci_no, bakiye
                  FROM kullanicilar
                 WHERE id = %s AND aktif = 1
                """,
                (kullanici_id,),
            )
            satir = cur.fetchone()
            return _serilestir(satir) if satir else None
    finally:
        conn.close()


def sabitler_getir() -> dict:
    conn = okuma_baglantisi()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, ad, konum, kapasite FROM yemekhaneler ORDER BY id")
            yemekhaneler = [_serilestir(s) for s in cur.fetchall()]
            cur.execute(
                """
                SELECT id, ad, sira,
                       TIME_FORMAT(son_saat, '%%H:%%i') AS son_saat,
                       TIME_FORMAT(servis_baslangic, '%%H:%%i') AS servis_baslangic,
                       TIME_FORMAT(servis_bitis, '%%H:%%i') AS servis_bitis
                  FROM ogunler
                 ORDER BY sira
                """
            )
            ogunler = [_serilestir(s) for s in cur.fetchall()]
            return {"yemekhaneler": yemekhaneler, "ogunler": ogunler}
    finally:
        conn.close()


def gunun_menusu_getir(yemekhane_id: int, tarih: str, ogun_id: int) -> dict | None:
    conn = okuma_baglantisi()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.*,
                       p.oy_sayisi,
                       p.ortalama_puan,
                       (d.rezervasyon_son > NOW()) AS rezervasyon_acik
                  FROM v_menu_doluluk d
                  LEFT JOIN v_menu_puan p ON p.menu_id = d.menu_id
                 WHERE d.yemekhane_id = %s AND d.tarih = %s AND d.ogun_id = %s
                """,
                (yemekhane_id, tarih, ogun_id),
            )
            ozet = cur.fetchone()
            if not ozet:
                return None

            cur.execute(
                """
                SELECT menu_id, ogrenci_fiyati, personel_fiyati,
                       yemek_id, yemek, kategori_id, kategori, kategori_sira,
                       kalori, vejetaryen, alerjenler, alerjen_idler
                  FROM v_menu_detay
                 WHERE menu_id = %s
                 ORDER BY kategori_sira, yemek
                """,
                (ozet["menu_id"],),
            )
            satirlar = [_serilestir(s) for s in cur.fetchall()]

            veri = _serilestir(ozet)
            veri["ogrenci_fiyati"] = satirlar[0]["ogrenci_fiyati"] if satirlar else 0.0
            veri["personel_fiyati"] = satirlar[0]["personel_fiyati"] if satirlar else 0.0
            veri["toplam_kalori"] = sum(int(s["kalori"]) for s in satirlar)
            veri["yemekler"] = satirlar
            return veri
    finally:
        conn.close()


def haftalik_menuler_getir(yemekhane_id: int, kullanici_id: int) -> list[dict]:
    conn = okuma_baglantisi()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.menu_id, d.tarih, d.yemekhane_id, d.yemekhane,
                       d.ogun_id, d.ogun, d.kapasite, d.rezerve, d.bos_yer,
                       d.doluluk_yuzde, d.rezervasyon_son,
                       m.ogrenci_fiyati, m.personel_fiyati,
                       (d.rezervasyon_son > NOW()) AS rezervasyon_acik,
                       r.id AS kullanici_rezervasyon_id,
                       r.durum AS kullanici_rezervasyon_durum
                  FROM v_menu_doluluk d
                  JOIN menuler m ON m.id = d.menu_id
                  LEFT JOIN rezervasyonlar r
                    ON r.menu_id = d.menu_id
                   AND r.kullanici_id = %s
                   AND r.durum IN ('aktif', 'kullanildi')
                 WHERE d.yemekhane_id = %s
                   AND d.tarih BETWEEN CURDATE() - INTERVAL 1 DAY AND CURDATE() + INTERVAL 7 DAY
                 ORDER BY d.tarih ASC, m.ogun_id ASC
                """,
                (kullanici_id, yemekhane_id),
            )
            return [_serilestir(s) for s in cur.fetchall()]
    finally:
        conn.close()


def rezervasyon_yap(kullanici_id: int, menu_id: int) -> dict:
    sonuc = _yordam_cagir("CALL sp_rezervasyon_yap(%s, %s)", (kullanici_id, menu_id))
    guncel = kullanici_getir_kaynaktan(kullanici_id)
    if guncel:
        sonuc["bakiye"] = guncel["bakiye"]
    return sonuc


def rezervasyon_iptal(kullanici_id: int, rezervasyon_id: int) -> dict:
    sonuc = _yordam_cagir("CALL sp_rezervasyon_iptal(%s, %s)", (kullanici_id, rezervasyon_id))
    guncel = kullanici_getir_kaynaktan(kullanici_id)
    if guncel:
        sonuc["bakiye"] = guncel["bakiye"]
    return sonuc


def rezervasyonlarim_getir(kullanici_id: int) -> list[dict]:
    conn = okuma_baglantisi()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.id, r.menu_id, r.durum, r.ucret, r.olusturma,
                       r.kullanma_zamani, r.iptal_zamani,
                       m.tarih, yh.ad AS yemekhane, o.ad AS ogun,
                       (TIMESTAMP(m.tarih, o.son_saat) > NOW()) AS iptal_edilebilir,
                       deg.id AS degerlendirme_id,
                       deg.puan AS verilen_puan,
                       deg.yorum AS verilen_yorum
                  FROM rezervasyonlar r
                  JOIN menuler m       ON m.id = r.menu_id
                  JOIN yemekhaneler yh ON yh.id = m.yemekhane_id
                  JOIN ogunler o       ON o.id = m.ogun_id
                  LEFT JOIN degerlendirmeler deg
                    ON deg.menu_id = r.menu_id AND deg.kullanici_id = r.kullanici_id
                 WHERE r.kullanici_id = %s
                 ORDER BY m.tarih DESC, o.sira DESC, r.id DESC
                """,
                (kullanici_id,),
            )
            return [_serilestir(s) for s in cur.fetchall()]
    finally:
        conn.close()


def bakiye_hareketleri_getir(kullanici_id: int) -> list[dict]:
    conn = okuma_baglantisi()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, tur, tutar, rezervasyon_id, aciklama, olusturma
                  FROM bakiye_hareketleri
                 WHERE kullanici_id = %s
                 ORDER BY olusturma DESC, id DESC
                 LIMIT 50
                """,
                (kullanici_id,),
            )
            return [_serilestir(s) for s in cur.fetchall()]
    finally:
        conn.close()


def bakiye_yukle(kullanici_id: int, tutar: float) -> dict:
    sonuc = _yordam_cagir("CALL sp_bakiye_yukle(%s, %s)", (kullanici_id, tutar))
    guncel = kullanici_getir_kaynaktan(kullanici_id)
    if guncel:
        sonuc["bakiye"] = guncel["bakiye"]
    return sonuc


def degerlendirme_kaydet(kullanici_id: int, menu_id: int, puan: int, yorum: str) -> None:
    if not (1 <= puan <= 5):
        raise IsKuraliHatasi("Puan 1 ile 5 arasında olmalıdır.")

    conn = yazma_baglantisi(autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM rezervasyonlar
                 WHERE kullanici_id = %s AND menu_id = %s AND durum = 'kullanildi'
                """,
                (kullanici_id, menu_id),
            )
            if not cur.fetchone():
                raise IsKuraliHatasi("Yalnızca kullandığınız menüleri değerlendirebilirsiniz.")

            cur.execute(
                """
                INSERT INTO degerlendirmeler (kullanici_id, menu_id, puan, yorum)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE puan = VALUES(puan), yorum = VALUES(yorum)
                """,
                (kullanici_id, menu_id, puan, yorum.strip() or None),
            )
    finally:
        conn.close()


def tum_yemekler_getir() -> list[dict]:
    conn = okuma_baglantisi()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT y.id, y.ad, y.kalori, y.vejetaryen,
                       k.id AS kategori_id, k.ad AS kategori, k.sira AS kategori_sira
                  FROM yemekler y
                  JOIN yemek_kategorileri k ON k.id = y.kategori_id
                 ORDER BY k.sira, y.ad
                """
            )
            return [_serilestir(s) for s in cur.fetchall()]
    finally:
        conn.close()


def yonetici_menuler_getir() -> list[dict]:
    conn = okuma_baglantisi()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.menu_id, d.tarih, d.yemekhane_id, d.yemekhane,
                       d.ogun_id, d.ogun, d.kapasite, d.rezerve, d.bos_yer, d.doluluk_yuzde,
                       m.ogrenci_fiyati, m.personel_fiyati,
                       p.oy_sayisi, p.ortalama_puan,
                       (SELECT GROUP_CONCAT(my.yemek_id ORDER BY my.yemek_id)
                          FROM menu_yemekleri my WHERE my.menu_id = d.menu_id) AS yemek_idler,
                       (SELECT GROUP_CONCAT(y.ad ORDER BY k.sira, y.ad SEPARATOR ', ')
                          FROM menu_yemekleri my
                          JOIN yemekler y ON y.id = my.yemek_id
                          JOIN yemek_kategorileri k ON k.id = y.kategori_id
                         WHERE my.menu_id = d.menu_id) AS yemek_listesi
                  FROM v_menu_doluluk d
                  JOIN menuler m ON m.id = d.menu_id
                  LEFT JOIN v_menu_puan p ON p.menu_id = d.menu_id
                 ORDER BY d.tarih DESC, d.yemekhane_id ASC, d.ogun_id ASC
                 LIMIT 60
                """
            )
            return [_serilestir(s) for s in cur.fetchall()]
    finally:
        conn.close()


def yonetici_menu_kaydet(
    yemekhane_id: int,
    tarih: str,
    ogun_id: int,
    ogrenci_fiyati: float,
    personel_fiyati: float,
    yemek_idler: list[int],
) -> int:
    if not yemek_idler:
        raise IsKuraliHatasi("Menüde en az bir yemek seçilmelidir.")

    conn = yazma_baglantisi(autocommit=False)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM menuler
                 WHERE yemekhane_id = %s AND tarih = %s AND ogun_id = %s
                """,
                (yemekhane_id, tarih, ogun_id),
            )
            mevcut = cur.fetchone()
            if mevcut:
                menu_id = int(mevcut["id"])
                cur.execute(
                    """
                    UPDATE menuler
                       SET ogrenci_fiyati = %s, personel_fiyati = %s
                     WHERE id = %s
                    """,
                    (ogrenci_fiyati, personel_fiyati, menu_id),
                )
                cur.execute("DELETE FROM menu_yemekleri WHERE menu_id = %s", (menu_id,))
            else:
                cur.execute(
                    """
                    INSERT INTO menuler (yemekhane_id, tarih, ogun_id, ogrenci_fiyati, personel_fiyati)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (yemekhane_id, tarih, ogun_id, ogrenci_fiyati, personel_fiyati),
                )
                menu_id = int(cur.lastrowid)

            for yid in dict.fromkeys(int(x) for x in yemek_idler):
                cur.execute(
                    "INSERT INTO menu_yemekleri (menu_id, yemek_id) VALUES (%s, %s)",
                    (menu_id, yid),
                )
        conn.commit()
        return menu_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
