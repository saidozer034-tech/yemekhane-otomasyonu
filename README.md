# Kampüs Yemekhane Otomasyonu

## Proje Değerlendirmesi ve Kazanımlar

### Genel Değerlendirme
Bu ödevi yaparken sadece ekranda çalışan bir yemekhane uygulaması yazmaktan ziyade, arka planda birden fazla servisin birbiriyle nasıl haberleştiğini birebir görme fırsatım oldu. Açıkçası ilk başta Docker Compose dosyasında iki ayrı MySQL, Redis ve Apache'yi bir arada görünce gözüme biraz karmaşık gelmişti ama aşama aşama ilerledikçe her parçanın sistemde neden ayrı bir görevi olduğunu çok net kavradım. Özellikle çalışan bir sistemin üzerine sonradan yeni özellik eklediğimiz **Aşama 4**, gerçek hayatta bir projeye sonradan gelen müşteri/kullanıcı taleplerinin nasıl entegre edildiğini görmek açısından benim için en öğretici kısım oldu.

### Farklı Olarak Neler Yaptım ve Neler Öğrendim?
* **Kişiselleştirilmiş Alerjen Profili ve Menü Uyarısı:** Aşama 4'te yemeklerin yanına sadece alerjen etiketi koyup geçmek yerine, öğrencinin kendi hassasiyetlerini işaretleyebildiği ayrı bir **Alerjen Profilim** sekmesi yaptım. Günün menüsü açıldığında sistem kullanıcının seçtiği alerjenlerle menüdeki yemekleri karşılaştırıyor ve riskli bir yemek varsa doğrudan kırmızı uyarı kutusuyla dikkat çekiyor. Günlük hayatta gerçekten işe yarayacak çok güzel bir detay olduğunu düşünüyorum.
* **Yarım Porsiyon Kurgusu:** Öğle ve akşam öğünlerinde tam porsiyonun yanında %60 ücretli yarım porsiyon seçeneğini hem veritabanı yordamına hem de arayüzdeki rezervasyon kartlarına ekledim; kahvaltıda ise kural gereği yarım porsiyonu kapattım.
* **Replikasyon Gecikmesi (Replication Lag) Farkındalığı:** Okuma sorgularını `mysql-replica` üzerine, yazma işlemlerini `mysql-primary` üzerine ayırdım. Burada fark ettiğim önemli bir detay şu oldu: Kullanıcı rezervasyon yaptığında veya bakiye yüklediğinde replikasyon eşzamansız çalıştığı için güncel bakiyeyi replikadan okumak anlık gecikmeye takılabiliyordu. Bu yüzden işlem sonrası güncel bakiyeyi doğrudan kaynaktan (`mysql-primary`) okuyarak arayüzde her zaman doğru bakiyenin görünmesini sağladım.
* **İş Kurallarını Veritabanına Bırakma:** Bakiye düşümü, kontenjan kontrolü ve iptal süresi gibi kritik kontrolleri Python tarafında `if/else` yazarak çoğaltmak yerine doğrudan veritabanındaki satır kilitlemeli (`FOR UPDATE`) `stored procedure` yapılarına bıraktım ve dönen Türkçe hata mesajlarını bozmadan kullanıcıya gösterdim.

### Karşılaştığım Zorluklar ve Çözümleri
* **Önbellek Temizliği (Cache Invalidation):** Günün menüsünü Redis'e aldıktan sonra yönetici panelinden menü güncellendiğinde veya Aşama 4'te tablo yapısı değiştiğinde eski verilerin ekranda kalmaması için ilgili Redis anahtarlarını otomatik sildirmem gerekti.
* **Oturumların Konteyner Yeniden Başlayınca Düşmesi:** İlk aşamada oturumları uygulama belleğinde tutuyordum; `uygulama` konteyneri yeniden başladığında herkesin oturumu düşüyordu. Aşama 3'te oturumları 30 dakikalık (`TTL = 1800 sn`) anahtarlarla Redis'e taşıyınca bu sorun tamamen ortadan kalktı.
* **Hata Mesajlarının Yönetimi:** Veritabanı yordamlarından fırlatılan `SQLSTATE 45000` (hata kodu 1644) uyarılarını sistem hatası (`500`) gibi göstermek yerine özel bir istisna sınıfıyla yakalayıp kullanıcıya doğrudan *"Bakiye yetersiz."*, *"Kahvaltıda yarım porsiyon seçilemez."* gibi net uyarılar olarak ilettim.

---

## Kurulum ve Çalıştırma

Proje **Web API + Arayüz** (`Apache 2.4 + Python FastAPI + HTML5/CSS3/Vanilla JS`) mimarisiyle geliştirilmiştir. Tek komutla tüm servisler ve örnek veriler ayağa kalkar:

```bash
git clone [https://github.com/saidozer034-tech/yemekhane-otomasyonu.git](https://github.com/saidozer034-tech/yemekhane-otomasyonu.git)
cd yemekhane-otomasyonu
docker compose up -d
```

Tarayıcı adresi: **http://localhost:8080**

## Proje Klasör Yapısı

```text
docker-compose.yml                 Tüm servislerin tanımı (frontend, uygulama, mysql-primary, mysql-replica, redis)
apache/yemekhane.conf              Apache reverse proxy ayarları (/ -> frontend, /api/ -> FastAPI)
db/init/01_sema.sql                12 tablo, 3 view ve 4 stored procedure
db/init/02_ornek_veri.sql          Başlangıç kullanıcıları, yemekler, menüler ve rezervasyonlar
db/init/04_degisiklik.sql          Aşama 4 migration (yarım porsiyon, kullanici_alerjenleri, güncel yordam)
uygulama/main.py                   Web API endpoint'leri (Controller katmanı)
uygulama/veritabani.py             Veri erişim katmanı (SQL, View ve Stored Procedure çağrıları)
uygulama/onbellek.py               Redis menü önbelleği ve oturum yönetimi
frontend/                          400 px mobil uyumlu HTML5 / CSS3 / Vanilla JS arayüzü
rapor/                             Aşama 1–4 doğrulama çıktıları ve ekran görüntülerini içeren PDF rapor
```

## Test Hesapları

Tüm kullanıcıların şifresi: **`Yemek2026!`**

| E-posta | Rol | Açıklama |
|---|---|---|
| `leyla.arslan@kampus.edu.tr` | Yönetici | Menü oluşturma/düzenleme, doluluk ve puan raporları |
| `murat.kaya@kampus.edu.tr` | Personel | Personel fiyat tarifesi |
| `ayse.demir@ogr.kampus.edu.tr` | Öğrenci | Bakiyesi 12,50 TL ("Bakiye yetersiz." uyarısını test etmek için) |
| `mehmet.yildiz@ogr.kampus.edu.tr` | Öğrenci | Standart öğrenci hesabı |

## Servis Bağlantı Bilgileri

| Servis | Container İçi Adres | Yerel Makine Portu |
|---|---|---|
| Web Arayüzü ve API | `frontend:80` / `uygulama:8000` | `http://localhost:8080` |
| MySQL Kaynak (Yazma) | `mysql-primary:3306` | `localhost:3307` |
| MySQL Replika (Okuma) | `mysql-replica:3306` | `localhost:3308` |
| Redis | `redis:6379` | `localhost:6379` |
