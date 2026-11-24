let TOKEN = sessionStorage.getItem("yemekhane_token") || "";
let KULLANICI = null;
let SABITLER = { yemekhaneler: [], ogunler: [], alerjenler: [] };
let YONETICI_MENULER = [];

const $ = (id) => document.getElementById(id);

function tl(tutar) {
  return Number(tutar || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " TL";
}

function bugunISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const g = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}

function mesajGoster(metin, tur = "basari") {
  const kutu = $("genel-bildirim");
  kutu.textContent = metin;
  kutu.className = `bildirim bildirim-${tur}`;
  kutu.classList.remove("gizli");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function mesajGizle() {
  $("genel-bildirim").classList.add("gizli");
}

function kullaniciBakiyeGuncelle(yeniBakiye) {
  if (!KULLANICI) return;
  KULLANICI.bakiye = Number(yeniBakiye);
  $("kullanici-bakiye").textContent = tl(KULLANICI.bakiye);
  $("bakiye-buyuk").textContent = tl(KULLANICI.bakiye);
}

function rolFiyati(menu) {
  return KULLANICI && KULLANICI.rol === "ogrenci"
    ? menu.ogrenci_fiyati
    : menu.personel_fiyati;
}

async function apiIstek(yol, secenekler = {}) {
  const basliklar = {
    Accept: "application/json",
    ...(secenekler.body ? { "Content-Type": "application/json" } : {}),
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
  const yanit = await fetch(yol, { ...secenekler, headers: basliklar });
  const veri = await yanit.json().catch(() => ({}));
  if (!yanit.ok) {
    if (yanit.status === 401 && yol !== "/api/giris") {
      oturumuKapat(false);
    }
    throw new Error(veri.hata || veri.detail || "İşlem gerçekleştirilemedi.");
  }
  return veri;
}

function oturumuKapat(sunucuyaBildir = true) {
  if (sunucuyaBildir && TOKEN) {
    apiIstek("/api/cikis", { method: "POST" }).catch(() => {});
  }
  TOKEN = "";
  KULLANICI = null;
  sessionStorage.removeItem("yemekhane_token");
  $("ust-kullanici").classList.add("gizli");
  $("uygulama-alani").classList.add("gizli");
  $("ekran-giris").classList.remove("gizli");
}

async function oturumuBaslat(kullanici) {
  KULLANICI = kullanici;
  $("ekran-giris").classList.add("gizli");
  $("ust-kullanici").classList.remove("gizli");
  $("uygulama-alani").classList.remove("gizli");

  const rolAd = { ogrenci: "Öğrenci", personel: "Personel", yonetici: "Yönetici" }[kullanici.rol] || kullanici.rol;
  $("kullanici-ad").textContent = `${kullanici.ad} ${kullanici.soyad} (${rolAd})`;
  kullaniciBakiyeGuncelle(kullanici.bakiye);

  if (kullanici.rol === "yonetici") {
    $("sekme-yonetici-btn").classList.remove("gizli");
  } else {
    $("sekme-yonetici-btn").classList.add("gizli");
  }

  SABITLER = await apiIstek("/api/sabitler");
  secenekleriDoldur();
  sekmeAc("gunun");
}

function secenekleriDoldur() {
  const yhSecenek = SABITLER.yemekhaneler
    .map((y) => `<option value="${y.id}">${y.ad} (Kapasite: ${y.kapasite})</option>`)
    .join("");
  const ogunSecenek = SABITLER.ogunler
    .map((o) => `<option value="${o.id}">${o.ad} (Son: ${o.son_saat})</option>`)
    .join("");

  $("gunun-yemekhane").innerHTML = yhSecenek;
  $("haftalik-yemekhane").innerHTML = yhSecenek;
  $("yon-yemekhane").innerHTML = yhSecenek;

  $("gunun-ogun").innerHTML = ogunSecenek;
  $("gunun-ogun").value = "2";
  $("yon-ogun").innerHTML = ogunSecenek;

  $("gunun-tarih").value = bugunISO();
  $("yon-tarih").value = bugunISO();
}

async function sekmeAc(ad) {
  mesajGizle();
  document.querySelectorAll(".sekme[data-sekme]").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.dataset.sekme === ad ? "true" : "false");
  });
  ["gunun", "haftalik", "rezervasyonlar", "bakiye", "degerlendirme", "profil", "yonetici"].forEach((p) => {
    const el = $(`panel-${p}`);
    if (el) el.classList.toggle("gizli", p !== ad);
  });

  try {
    if (ad === "gunun") await gununMenusunuYukle();
    if (ad === "haftalik") await haftalikMenuyuYukle();
    if (ad === "rezervasyonlar") await rezervasyonlariYukle();
    if (ad === "bakiye") await bakiyeyiYukle();
    if (ad === "degerlendirme") await degerlendirmeyiYukle();
    if (ad === "profil") profilAlerjenleriniYukle();
    if (ad === "yonetici") await yoneticiPaneliniYukle();
  } catch (err) {
    mesajGoster(err.message, "hata");
  }
}

function profilAlerjenleriniYukle() {
  const seciliSet = new Set((KULLANICI && KULLANICI.alerjen_idler) || []);
  $("profil-alerjen-kutulari").innerHTML = (SABITLER.alerjenler || [])
    .map(
      (a) => `
      <label class="onay-satir kart" style="margin-bottom: 0; padding: 0.65rem;">
        <input type="checkbox" name="profil_alerjen" value="${a.id}" ${seciliSet.has(a.id) ? "checked" : ""}>
        <span>${a.ad}</span>
      </label>`
    )
    .join("");
}

async function gununMenusunuYukle() {
  const yh = $("gunun-yemekhane").value;
  const tarih = $("gunun-tarih").value;
  const ogun = $("gunun-ogun").value;
  const kutu = $("gunun-icerik");
  kutu.textContent = "Yükleniyor...";

  const { menu } = await apiIstek(
    `/api/gunun-menusu?yemekhane_id=${yh}&tarih=${tarih}&ogun_id=${ogun}`
  );
  if (!menu) {
    kutu.innerHTML = `<p class="bildirim">Seçilen tarih ve öğün için tanımlı menü bulunamadı.</p>`;
    return;
  }

  const fiyat = rolFiyati(menu);
  const puanMetni = menu.ortalama_puan ? `${menu.ortalama_puan} / 5 (${menu.oy_sayisi} oy)` : "Henüz oy yok";
  const kullaniciAlerjenSet = new Set((KULLANICI && KULLANICI.alerjen_idler) || []);
  const alerjenAdHarita = new Map((SABITLER.alerjenler || []).map((a) => [Number(a.id), a.ad]));

  const yemeklerHtml = menu.yemekler
    .map((y) => {
      const yemekAlerjenIdler = String(y.alerjen_idler || "")
        .split(",")
        .filter(Boolean)
        .map(Number);
      const cakisanAlerjenler = yemekAlerjenIdler
        .filter((id) => kullaniciAlerjenSet.has(id))
        .map((id) => alerjenAdHarita.get(id) || `#${id}`);

      const uyariKutusu = cakisanAlerjenler.length
        ? `<div class="bildirim bildirim-hata" style="margin-top: 0.4rem; padding: 0.35rem 0.6rem; font-size: var(--boyut-kucuk);">
             ⚠️ <strong>Alerjen Uyarısı:</strong> Profilinizdeki alerjenleri içerir (${cakisanAlerjenler.join(", ")}).
           </div>`
        : "";

      return `
        <div class="yemek-satir" style="${cakisanAlerjenler.length ? "background: #fff8f7; padding-inline: 0.5rem; border-radius: var(--kose);" : ""}">
          <div style="flex: 1;">
            <strong>${y.yemek}</strong>
            <div style="font-size: var(--boyut-kucuk); color: var(--metin-soluk);">${y.kategori}</div>
            <div style="margin-top: 0.25rem; display: flex; flex-wrap: wrap; gap: 0.3rem;">
              ${y.vejetaryen ? `<span class="rozet rozet-veg">Vejetaryen</span>` : ""}
              ${y.alerjenler ? `<span class="rozet rozet-alerjen">Alerjen: ${y.alerjenler}</span>` : ""}
            </div>
            ${uyariKutusu}
          </div>
          <span class="rozet">${y.kalori} kcal</span>
        </div>`;
    })
    .join("");

  kutu.innerHTML = `
    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
      <span class="rozet">Toplam: <strong>${menu.toplam_kalori} kcal</strong></span>
      <span class="rozet">Ücretiniz: <strong>${tl(fiyat)}</strong></span>
      <span class="rozet">Boş Yer: <strong>${menu.bos_yer} / ${menu.kapasite}</strong></span>
      <span class="rozet">Puan: <strong>${puanMetni}</strong></span>
    </div>
    <div>${yemeklerHtml}</div>
  `;
}

async function haftalikMenuyuYukle() {
  const yh = $("haftalik-yemekhane").value;
  const kutu = $("haftalik-icerik");
  kutu.textContent = "Yükleniyor...";

  const { menuler } = await apiIstek(`/api/haftalik-menu?yemekhane_id=${yh}`);
  if (!menuler.length) {
    kutu.innerHTML = `<p class="bildirim">Bu hafta için yayınlanmış menü bulunamadı.</p>`;
    return;
  }

  kutu.innerHTML = menuler
    .map((m) => {
      const tamFiyat = rolFiyati(m);
      const yarimFiyat = Math.round(tamFiyat * 60) / 100;
      const acik = Boolean(m.rezervasyon_acik);
      const mevcutDurum = m.kullanici_rezervasyon_durum;
      const kahvaltiMi = Number(m.ogun_id) === 1 || m.ogun === "Kahvaltı";

      let islemHtml = "";
      if (mevcutDurum === "aktif") {
        const pEtiket = m.kullanici_rezervasyon_porsiyon === "yarim" ? "Yarım" : "Tam";
        islemHtml = `<button type="button" class="dugme" disabled>Rezerve Edildi (${pEtiket})</button>`;
      } else if (mevcutDurum === "kullanildi") {
        islemHtml = `<button type="button" class="dugme" disabled>Kullanıldı</button>`;
      } else if (!acik) {
        islemHtml = `<button type="button" class="dugme" disabled>Son Saat Geçti</button>`;
      } else if (m.bos_yer <= 0) {
        islemHtml = `<button type="button" class="dugme" disabled>Kapasite Dolu</button>`;
      } else if (kahvaltiMi) {
        islemHtml = `
          <div style="font-size: var(--boyut-kucuk); color: var(--metin-soluk); margin-bottom: 0.4rem;">
            Kahvaltıda yalnızca tam porsiyon sunulur.
          </div>
          <button type="button" class="dugme rez-yap-btn" data-menu-id="${m.menu_id}" data-porsiyon="tam">
            Tam Porsiyon (${tl(tamFiyat)})
          </button>`;
      } else {
        islemHtml = `
          <div style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
            <button type="button" class="dugme rez-yap-btn" data-menu-id="${m.menu_id}" data-porsiyon="tam">
              Tam (${tl(tamFiyat)})
            </button>
            <button type="button" class="dugme rez-yap-btn" style="background: var(--ana-koyu);" data-menu-id="${m.menu_id}" data-porsiyon="yarim">
              Yarım %60 (${tl(yarimFiyat)})
            </button>
          </div>`;
      }

      return `
        <article class="kart" style="margin-bottom: 0;">
          <div style="display: flex; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.4rem;">
            <strong>${m.tarih} · ${m.ogun}</strong>
            <span class="rozet">${tl(tamFiyat)}</span>
          </div>
          <p style="font-size: var(--boyut-kucuk); color: var(--metin-soluk); margin-bottom: 0.6rem;">
            Boş yer: <strong>${m.bos_yer}</strong> / ${m.kapasite}<br>
            Son işlem: ${m.rezervasyon_son}
          </p>
          ${islemHtml}
        </article>
      `;
    })
    .join("");
}

async function rezervasyonlariYukle() {
  const kutu = $("rezervasyonlar-icerik");
  kutu.textContent = "Yükleniyor...";
  const { rezervasyonlar } = await apiIstek("/api/rezervasyonlarim");

  if (!rezervasyonlar.length) {
    kutu.innerHTML = `<p class="bildirim">Henüz rezervasyonunuz bulunmuyor.</p>`;
    return;
  }

  const satirlar = rezervasyonlar
    .map((r) => {
      const durumEtiket = {
        aktif: `<span class="rozet rozet-aktif">Aktif</span>`,
        kullanildi: `<span class="rozet">Kullanıldı</span>`,
        iptal: `<span class="rozet rozet-iptal">İptal</span>`,
      }[r.durum] || r.durum;

      const porsiyonMetni = r.porsiyon === "yarim" ? "Yarım (%60)" : "Tam";

      const islem =
        r.durum === "aktif" && r.iptal_edilebilir
          ? `<button type="button" class="dugme dugme-tehlike dugme-kucuk rez-iptal-btn" data-rez-id="${r.id}">İptal Et</button>`
          : r.durum === "aktif"
          ? `<small style="color: var(--metin-soluk);">İptal süresi doldu</small>`
          : "-";

      return `
        <tr>
          <td>${r.tarih}<br><small>${r.yemekhane} · ${r.ogun}</small></td>
          <td>${porsiyonMetni}</td>
          <td>${tl(r.ucret)}</td>
          <td>${durumEtiket}</td>
          <td>${islem}</td>
        </tr>
      `;
    })
    .join("");

  kutu.innerHTML = `
    <table class="tablo">
      <thead>
        <tr><th>Tarih / Öğün</th><th>Porsiyon</th><th>Ücret</th><th>Durum</th><th>İşlem</th></tr>
      </thead>
      <tbody>${satirlar}</tbody>
    </table>
  `;
}

async function bakiyeyiYukle() {
  const veri = await apiIstek("/api/bakiye");
  kullaniciBakiyeGuncelle(veri.bakiye);
  const kutu = $("hareketler-icerik");

  if (!veri.hareketler.length) {
    kutu.innerHTML = `<p class="bildirim">Henüz bakiye hareketi yok.</p>`;
    return;
  }

  const turAd = { yukleme: "Yükleme", rezervasyon: "Rezervasyon", iade: "İade" };
  const satirlar = veri.hareketler
    .map(
      (h) => `
      <tr>
        <td>${h.olusturma}</td>
        <td>${turAd[h.tur] || h.tur}</td>
        <td style="font-weight: 700; color: ${h.tutar >= 0 ? "var(--basari)" : "var(--hata)"};">
          ${h.tutar >= 0 ? "+" : ""}${tl(h.tutar)}
        </td>
        <td>${h.aciklama || "-"}</td>
      </tr>`
    )
    .join("");

  kutu.innerHTML = `
    <table class="tablo">
      <thead>
        <tr><th>Tarih</th><th>Tür</th><th>Tutar</th><th>Açıklama</th></tr>
      </thead>
      <tbody>${satirlar}</tbody>
    </table>
  `;
}

async function degerlendirmeyiYukle() {
  const { rezervasyonlar } = await apiIstek("/api/rezervasyonlarim");
  const kullanilanlar = rezervasyonlar.filter((r) => r.durum === "kullanildi");
  const secim = $("deg-menu");
  const gecmis = $("deg-gecmis");

  if (!kullanilanlar.length) {
    secim.innerHTML = `<option value="">Değerlendirilebilir kullanılmış menü yok</option>`;
    gecmis.innerHTML = `<p class="bildirim">Henüz turnikeden geçip kullandığınız bir menü bulunmuyor.</p>`;
    return;
  }

  secim.innerHTML = kullanilanlar
    .map(
      (r) =>
        `<option value="${r.menu_id}">${r.tarih} · ${r.yemekhane} · ${r.ogun}${
          r.verilen_puan ? ` (Puanınız: ${r.verilen_puan}/5)` : ""
        }</option>`
    )
    .join("");

  const oyVerilenler = kullanilanlar.filter((r) => r.verilen_puan);
  gecmis.innerHTML = oyVerilenler.length
    ? `<h3>Verdiğiniz Puanlar</h3>` +
      oyVerilenler
        .map(
          (r) => `
        <div class="yemek-satir">
          <div>
            <strong>${r.tarih} · ${r.yemekhane} · ${r.ogun}</strong>
            <div style="font-size: var(--boyut-kucuk); color: var(--metin-soluk);">${r.verilen_yorum || "Yorum yok"}</div>
          </div>
          <span class="rozet rozet-aktif">${r.verilen_puan} / 5</span>
        </div>`
        )
        .join("")
    : "";
}

async function yoneticiPaneliniYukle() {
  const veri = await apiIstek("/api/yonetici/veriler");
  YONETICI_MENULER = veri.menuler;

  $("yon-yemek-kutulari").innerHTML = veri.yemekler
    .map(
      (y) => `
      <label class="onay-satir">
        <input type="checkbox" name="yon_yemek" value="${y.id}">
        <span><strong>${y.kategori}:</strong> ${y.ad} (${y.kalori} kcal)</span>
      </label>`
    )
    .join("");

  const satirlar = veri.menuler
    .map((m) => {
      const puan = m.ortalama_puan ? `${m.ortalama_puan} (${m.oy_sayisi})` : "-";
      return `
        <tr>
          <td>${m.tarih}<br><small>${m.yemekhane} · ${m.ogun}</small></td>
          <td>${m.rezerve} / ${m.kapasite} (%${m.doluluk_yuzde})</td>
          <td>${puan}</td>
          <td><small>${m.yemek_listesi || "-"}</small></td>
          <td>
            <button type="button" class="dugme dugme-kucuk yon-duzenle-btn" data-menu-id="${m.menu_id}">Düzenle</button>
          </td>
        </tr>`;
    })
    .join("");

  $("yonetici-tablo").innerHTML = `
    <table class="tablo">
      <thead>
        <tr><th>Menü</th><th>Doluluk</th><th>Puan</th><th>Yemekler</th><th>İşlem</th></tr>
      </thead>
      <tbody>${satirlar}</tbody>
    </table>
  `;
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".hizli-giris").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("giris-eposta").value = btn.dataset.eposta;
      $("giris-sifre").value = "Yemek2026!";
    });
  });

  $("giris-formu").addEventListener("submit", async (e) => {
    e.preventDefault();
    mesajGizle();
    try {
      const sonuc = await apiIstek("/api/giris", {
        method: "POST",
        body: JSON.stringify({
          eposta: $("giris-eposta").value,
          sifre: $("giris-sifre").value,
        }),
      });
      TOKEN = sonuc.token;
      sessionStorage.setItem("yemekhane_token", TOKEN);
      await oturumuBaslat(sonuc.kullanici);
    } catch (err) {
      mesajGoster(err.message, "hata");
    }
  });

  $("cikis-dugme").addEventListener("click", () => oturumuKapat(true));

  document.querySelectorAll(".sekme[data-sekme]").forEach((btn) => {
    btn.addEventListener("click", () => sekmeAc(btn.dataset.sekme));
  });

  ["gunun-yemekhane", "gunun-tarih", "gunun-ogun"].forEach((id) => {
    $(id).addEventListener("change", () => gununMenusunuYukle().catch((e) => mesajGoster(e.message, "hata")));
  });

  $("haftalik-yemekhane").addEventListener("change", () =>
    haftalikMenuyuYukle().catch((e) => mesajGoster(e.message, "hata"))
  );

  $("haftalik-icerik").addEventListener("click", async (e) => {
    const btn = e.target.closest(".rez-yap-btn");
    if (!btn) return;
    mesajGizle();
    try {
      const porsiyon = btn.dataset.porsiyon || "tam";
      const sonuc = await apiIstek("/api/rezervasyonlar", {
        method: "POST",
        body: JSON.stringify({
          menu_id: Number(btn.dataset.menuId),
          porsiyon,
        }),
      });
      kullaniciBakiyeGuncelle(sonuc.bakiye);
      const pMetin = sonuc.porsiyon === "yarim" ? "Yarım porsiyon" : "Tam porsiyon";
      mesajGoster(`${sonuc.mesaj} (${pMetin} - ${tl(sonuc.ucret)}). Güncel bakiye: ${tl(sonuc.bakiye)}`, "basari");
      await haftalikMenuyuYukle();
    } catch (err) {
      mesajGoster(err.message, "hata");
    }
  });

  $("rezervasyonlar-icerik").addEventListener("click", async (e) => {
    const btn = e.target.closest(".rez-iptal-btn");
    if (!btn) return;
    mesajGizle();
    try {
      const sonuc = await apiIstek(`/api/rezervasyonlar/${btn.dataset.rezId}/iptal`, {
        method: "POST",
      });
      kullaniciBakiyeGuncelle(sonuc.bakiye);
      mesajGoster(`${sonuc.mesaj} İade tutarı: ${tl(sonuc.iade)}`, "basari");
      await rezervasyonlariYukle();
    } catch (err) {
      mesajGoster(err.message, "hata");
    }
  });

  $("bakiye-formu").addEventListener("submit", async (e) => {
    e.preventDefault();
    mesajGizle();
    try {
      const sonuc = await apiIstek("/api/bakiye/yukle", {
        method: "POST",
        body: JSON.stringify({ tutar: Number($("yukleme-tutar").value) }),
      });
      kullaniciBakiyeGuncelle(sonuc.bakiye);
      mesajGoster(`${sonuc.mesaj} Güncel bakiyeniz: ${tl(sonuc.bakiye)}`, "basari");
      await bakiyeyiYukle();
    } catch (err) {
      mesajGoster(err.message, "hata");
    }
  });

  $("degerlendirme-formu").addEventListener("submit", async (e) => {
    e.preventDefault();
    mesajGizle();
    const menuId = Number($("deg-menu").value);
    if (!menuId) {
      mesajGoster("Lütfen kullanılmış bir menü seçin.", "hata");
      return;
    }
    try {
      const sonuc = await apiIstek("/api/degerlendirmeler", {
        method: "POST",
        body: JSON.stringify({
          menu_id: menuId,
          puan: Number($("deg-puan").value),
          yorum: $("deg-yorum").value,
        }),
      });
      $("deg-yorum").value = "";
      mesajGoster(sonuc.mesaj, "basari");
      await degerlendirmeyiYukle();
    } catch (err) {
      mesajGoster(err.message, "hata");
    }
  });

  $("profil-alerjen-formu").addEventListener("submit", async (e) => {
    e.preventDefault();
    mesajGizle();
    const seciliIdler = Array.from(document.querySelectorAll('input[name="profil_alerjen"]:checked')).map(
      (cb) => Number(cb.value)
    );
    try {
      const sonuc = await apiIstek("/api/profil/alerjenler", {
        method: "POST",
        body: JSON.stringify({ alerjen_idler: seciliIdler }),
      });
      if (KULLANICI) {
        KULLANICI.alerjen_idler = sonuc.alerjen_idler;
      }
      mesajGoster(sonuc.mesaj, "basari");
    } catch (err) {
      mesajGoster(err.message, "hata");
    }
  });

  $("yonetici-menu-formu").addEventListener("submit", async (e) => {
    e.preventDefault();
    mesajGizle();
    const seciliYemekler = Array.from(document.querySelectorAll('input[name="yon_yemek"]:checked')).map(
      (cb) => Number(cb.value)
    );
    try {
      const sonuc = await apiIstek("/api/yonetici/menuler", {
        method: "POST",
        body: JSON.stringify({
          yemekhane_id: Number($("yon-yemekhane").value),
          tarih: $("yon-tarih").value,
          ogun_id: Number($("yon-ogun").value),
          ogrenci_fiyati: Number($("yon-ogr-fiyat").value),
          personel_fiyati: Number($("yon-per-fiyat").value),
          yemek_idler: seciliYemekler,
        }),
      });
      mesajGoster(sonuc.mesaj, "basari");
      await yoneticiPaneliniYukle();
    } catch (err) {
      mesajGoster(err.message, "hata");
    }
  });

  $("yonetici-tablo").addEventListener("click", (e) => {
    const btn = e.target.closest(".yon-duzenle-btn");
    if (!btn) return;
    const menu = YONETICI_MENULER.find((m) => m.menu_id === Number(btn.dataset.menuId));
    if (!menu) return;
    $("yon-yemekhane").value = String(menu.yemekhane_id);
    $("yon-tarih").value = menu.tarih;
    $("yon-ogun").value = String(menu.ogun_id);
    $("yon-ogr-fiyat").value = menu.ogrenci_fiyati;
    $("yon-per-fiyat").value = menu.personel_fiyati;
    const idler = new Set((menu.yemek_idler || "").split(",").filter(Boolean));
    document.querySelectorAll('input[name="yon_yemek"]').forEach((cb) => {
      cb.checked = idler.has(cb.value);
    });
    $("yonetici-menu-formu").scrollIntoView({ behavior: "smooth" });
  });

  if (TOKEN) {
    try {
      const { kullanici } = await apiIstek("/api/ben");
      await oturumuBaslat(kullanici);
    } catch {
      oturumuKapat(false);
    }
  }
});
