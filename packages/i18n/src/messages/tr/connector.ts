import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  // Sunucu ayarları > Bağlayıcılar: bu bilgisayarın yerleşik GitHub bağlantısı.
  "connector.github.title": "GitHub",
  "connector.github.description":
    "Bu bilgisayardaki her ajan GitHub depolarınızı, sorunlarınızı (issues), çekme isteklerinizi (pull requests), gh ve git araçlarını kullanabilir.",
  "connector.github.connect": "GitHub'a Bağlan",
  "connector.github.pendingTitle": "Bu kodu GitHub'a yazın",
  "connector.github.pendingDescription": "GitHub tarayıcınızda açıldı. Bağlanmak için kodu oraya yazın.",
  "connector.github.waiting": "GitHub bekleniyor",
  "connector.github.copyCode": "Kodu kopyala",
  "connector.github.codeCopied": "Kopyalandı",
  "connector.github.openGitHub": "GitHub'ı Aç",
  "connector.github.cancel": "İptal",
  "connector.github.connectedAs": "@{login} olarak bağlandı",
  "connector.github.repositoriesTitle": "Depolar",
  "connector.github.repositoriesDescription":
    "Ajanlar yalnızca GoAhead GitHub Uygulamasının yüklü olduğu depoları kullanabilir.",
  "connector.github.chooseRepositories": "Depoları seç",
  "connector.github.repositoriesLoading": "Depolar GitHub'dan okunuyor",
  "connector.github.repositoriesFailed": "GoAhead depoları GitHub'dan okuyamadı.",
  "connector.github.noRepositories": "GoAhead GitHub Uygulaması henüz bir depoya yüklenmedi.",
  // {count} bir sayıdır (örneğin 12).
  "connector.github.moreRepositories": {
    one: "Ve {count} depo daha",
    other: "Ve {count} depo daha",
  },
  // Yalnızca üyelerinin görebileceği bir deponun yanındaki rozet.
  "connector.github.private": "Gizli",
  "connector.github.disconnect": "Bağlantıyı Kes",
  "connector.github.disconnectTitle": "GitHub Bağlantısını Kes",
  "connector.github.disconnectSummary": "Tüm ajanlar GitHub erişimini kaybeder. Sohbetleriniz ve dosyalarınız kalır.",
  "connector.github.expiredTitle": "GitHub bağlantısının süresi doldu",
  "connector.github.expiredDescription": "Ajanlara yeniden GitHub erişimi vermek için @{login} olarak tekrar bağlanın.",
  "connector.github.reconnect": "Yeniden Bağlan",
  "connector.github.actionFailed": "GoAhead GitHub bağlantısını değiştiremedi.",
  // GitHub sayfasının üst kısmındaki adın yanındaki durum.
  "connector.github.statusConnected": "Bağlandı",
  "connector.github.statusConnecting": "Bağlanıyor",
  "connector.github.statusExpired": "Süresi doldu",
  "connector.github.statusNotSetUp": "Ayarlanmadı",
  "connector.github.accountTitle": "Hesap",
  // {count} listedeki depo sayısıdır (örneğin 12).
  "connector.github.filterPlaceholder": {
    one: "{count} depoyu filtrele",
    other: "{count} depoyu filtrele",
  },
  "connector.github.filterLabel": "Depoları filtrele",
  // {query} kullanıcının filtreye yazdığı metindir.
  "connector.github.noMatch": "“{query}” ile eşleşen depo bulunamadı.",
  // Bağlanma iletişim kutusu. Adımlar sayı olarak gösterilir; ekran okuyucular adları okur.
  "connector.github.stepSignIn": "Giriş yap",
  "connector.github.stepConnected": "Bağlandı",
  "connector.github.requestingCode": "GoAhead GitHub'dan bir kod istiyor.",
  // {code} GitHub'a yazılacak koddur (örneğin WDJB-MJHT).
  "connector.github.codeLabel": "Kod {code}",
  "connector.github.failedTitle": "GitHub bağlanamadı",
  "connector.github.cancelConnecting": "GitHub bağlantısını iptal et",
  // {count} ajanların kullanabileceği depo sayısıdır.
  "connector.github.connectedSummary": {
    one: "{count} depo · bu bilgisayardaki her ajan",
    other: "{count} depo · bu bilgisayardaki her ajan",
  },
  "connector.github.done": "Bitti",
  "connector.github.later": "Daha sonra",
  // Bağlantıyı kesme öncesi onay. {login} GitHub hesap adıdır (örneğin octocat).
  "connector.github.disconnectConfirmTitle": "GitHub bağlantısı kesilsin mi?",
  "connector.github.disconnectConfirmDescription": "Bağlantıyı kesmek @{login} oturumunu bu bilgisayardan kaldırır.",
  "connector.github.disconnectEffectTools": "Tüm ajanlar GitHub araçlarını, gh ve git erişimini kaybeder.",
  "connector.github.disconnectEffectRevoke": "Ardından GoAhead yetkisini kaldırabileceğiniz GitHub açılır.",
  "connector.github.disconnectEffectKept": "Sohbetler, dosyalar ve ajan hafızası bu bilgisayarda kalır.",
  "connector.github.keepConnected": "Bağlı kal",
  "connector.github.close": "Kapat",
  // Bir entegrasyon sayfasının onu kaldıran eylemi içeren son bölümü.
  "connector.dangerZone": "Tehlikeli bölge",

  // Sunucu ayarları > Bağlayıcılar: entegrasyonlar listesi. Her satır kendi sayfasını açar.
  "connector.hub.onThisComputer": "Bu bilgisayarda",
  "connector.hub.notSetUp": "Ayarlanmadı",
  "connector.hub.available": "Kullanılabilir",
  // {name} Slack gibi bir entegrasyonun adıdır.
  "connector.hub.open": "{name} uygulamasını aç",
  "connector.hub.setUp": "Ayarla",
  "connector.hub.back": "Tüm bağlayıcılar",
  // {names} "Chief, Research" gibi ajanları listeler.
  "connector.hub.usedBy": "{names} tarafından kullanılıyor",

  // Sunucu ayarları > Bağlayıcılar > Slack: bir çalışma alanı tek OpenBot uygulamasını yükler ve Slack
  // Düzenleyicisi ajanı her isteği alır, ekibe sorar ve yanıtlar.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Kullanıcılar Slack'te @GoAhead'den bahseder veya doğrudan mesaj gönderir. Slack Düzenleyicisi doğru ajana sorar ve yanıtlar.",
  "connector.slack.statusNotSetUp": "Ayarlanmadı",
  "connector.slack.statusConnected": "Bağlandı",
  "connector.slack.statusAttention": "İlgilenilmesi gerekiyor",
  // {workspace} Slack çalışma alanı adıdır.
  "connector.slack.summaryConnected": "{workspace} · Slack Düzenleyicisi yanıtlıyor",
  "connector.slack.summaryNoAgent": "{workspace} · Henüz yanıt veren bir ajan yok",
  "connector.slack.attentionTitle": {
    one: "{count} çalışma alanının ilgilenilmesi gerekiyor",
    other: "{count} çalışma alanının ilgilenilmesi gerekiyor",
  },
  "connector.slack.attentionDescription": "Aşağıdaki durum ne yapılması gerektiğini belirtir.",
  "connector.slack.connect": "Slack'e Bağlan",
  "connector.slack.addAgent": "Ajan ekle",
  "connector.slack.actionFailed": "Slack değişikliği kabul etmedi",
  "connector.slack.workspaceTitle": "Çalışma alanı",
  "connector.slack.workspaceDescription": "Kullanıcılar @GoAhead'den bahseder veya doğrudan mesaj gönderir.",
  "connector.slack.connectedAs":
    "@{name} olarak bağlı. Kullanıcılar @GoAhead'den bahseder veya doğrudan mesaj gönderir.",
  "connector.slack.connectAsYou":
    "Sizin adınıza da bağlanmak için yeniden bağlanın; ajanlarınız gördüklerinizi okur ve onayınızdan sonra sizin adınıza yanıtlar.",
  "connector.slack.disconnectWorkspace": "Bağlantıyı Kes",
  "connector.slack.missingScopes":
    "GoAhead Slack'te şu izinlere sahip değil: {scopes}. Çalışma alanı bağlantısını kesin, ardından tekrar bağlayın.",
  "connector.slack.retryAt": "Slack GoAhead'den beklemesini istedi. {time} saatinde tekrar deneyecek.",
  "connector.slack.reconnect": "Yeniden Bağlan",
  "connector.slack.resume": "Sürdür",
  // {action} Pause gibi bir düğmedir; {name} çalışma alanı adıdır.
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.orchestratorTitle": "Slack Düzenleyicisi",
  "connector.slack.orchestratorDescription":
    "Bu ajan Slack'ten gelen her isteği alır. Kısa olanları kendisi yanıtlar, diğer işleri doğru ajana iletir ve yanıtı ileti dizisinde yayınlar.",
  "connector.slack.orchestratorNone": "Henüz yanıt veren bir ajan yok",
  "connector.slack.orchestratorNoneDescription": "Slack Düzenleyicisini ekleyin, aksi takdirde Slack yanıt alamaz.",
  "connector.slack.inviteNote":
    "GoAhead her genel kanala ve her yeni kanala kendiliğinden katılır. Özel bir kanal için onu davet edin: /invite @GoAhead.",
  // Bağlanma iletişim kutusu. Adımlar sayı olarak gösterilir; ekran okuyucular adları okur.
  "connector.slack.stepWorkspace": "Çalışma alanı",
  "connector.slack.stepAgent": "Ajan",
  "connector.slack.connectTitle": "Bir Slack çalışma alanına bağlanın",
  "connector.slack.connectDescription":
    "GoAhead çalışma alanına GoAhead adında bir uygulama yükler ve her genel kanala katılır. Ayrıca sizin adınıza da bağlanır; böylece ajanlarınız gördüklerinizi okur ve onayınızdan sonra sizin adınıza yanıtlar.",
  "connector.slack.connectStepBrowser": "Slack tarayıcınızda açılır",
  "connector.slack.connectStepAllow": "Sağ üst köşeden çalışma alanını seçin, ardından İzin Ver'e tıklayın",
  "connector.slack.connectStepReturn": "Slack işlemi tamamlandığında bu iletişim kutusu devam eder",
  "connector.slack.connectInSlack": "Slack'te Bağlan",
  "connector.slack.connectWaiting": "Slack bekleniyor. Kurulumu tarayıcınızda tamamlayın.",
  "connector.slack.agentStepTitle": "Slack Düzenleyicisini ekleyin",
  // {workspace} Slack çalışma alanı adıdır.
  "connector.slack.agentStepDescription": "Bu yeni ajan, {workspace} içinde @GoAhead'e gönderilen her şeyi yanıtlar.",
  "connector.slack.orchestratorName": "Slack Düzenleyicisi",
  "connector.slack.orchestratorRole": "Slack'te yanıt verir ve ekibe sorar",
  "connector.slack.orchestratorDoesReceive": "Her Slack isteğini ilk olarak alır",
  "connector.slack.orchestratorDoesDelegate": "Her görevi en uygun ajana iletir",
  "connector.slack.orchestratorDoesAnswer": "Yanıtı Slack ileti dizisinde yayınlar",
  "connector.slack.orchestratorModel": "Model",
  "connector.slack.doneTitle": "GoAhead {workspace} içinde",
  "connector.slack.doneDescription": "Herhangi bir genel kanalda @GoAhead'den bahsedin veya doğrudan mesaj gönderin.",
  "connector.slack.done": "Bitti",
  "connector.slack.disconnectTitle": "{workspace} bağlantısı kesilsin mi?",
  "connector.slack.disconnectDescription":
    "GoAhead {workspace} içinde yanıt vermeyi durdurur ve Slack token'ını bu bilgisayardan kaldırır.",
  "connector.slack.disconnectEffect": "{workspace} içindeki kişiler artık @GoAhead aracılığıyla ajanlarınıza ulaşamaz.",
  "connector.slack.disconnectEffectUser": "GoAhead artık Slack'te sizin adınıza okuyamaz veya yanıt veremez.",
  "connector.slack.disconnectEffectInbox": "GoAhead'in bu bilgisayarda tuttuğu Slack mesajları silinir.",
  "connector.slack.inboxTitle": "Slack gelen kutusu",
  "connector.slack.inboxDescription":
    "GoAhead doğrudan mesajlarınızı, grup mesajlarınızı ve bahsedilmelerinizi bu bilgisayarda 30 gün tutar. Ajanlar bunları yalnızca GoAhead ile doğrudan mesajınızda istediğinizde okur. Tutulacak kanalları da seçin.",
  "connector.slack.inboxChannelsNone": "Kanal seçilmedi",
  "connector.slack.inboxChannels": { one: "{count} kanal: {names}", other: "{count} kanal: {names}" },
  "connector.slack.chooseChannels": "Kanalları seç",
  "connector.slack.channelsTitle": "Slack gelen kutusu için kanallar",
  "connector.slack.channelsDescription":
    "GoAhead seçtiğiniz kanalların mesajlarını, her birinin en yeni 15 mesajından başlayarak tutar. Kaldırdığınız bir kanal tutulan mesajlarını kaybeder.",
  "connector.slack.channelsSearch": "Kanal ara",
  "connector.slack.channelsLoading": "Kanallarınız yükleniyor…",
  "connector.slack.channelsFailed": "Slack kanallarınız yüklenmedi.",
  "connector.slack.channelsEmpty": "Eşleşen kanal yok.",
  "connector.slack.channelsLimit": {
    one: "En fazla {count} kanal seçebilirsiniz.",
    other: "En fazla {count} kanal seçebilirsiniz.",
  },
  "connector.slack.channelPrivate": "Özel kanal",
  "connector.slack.channelsSave": "Kaydet",
  "connector.slack.channelsCancel": "İptal",
  "connector.slack.removeEffectKept": "Konuşmalar ve Slack Düzenleyicisi GoAhead'de kalır.",
  "connector.slack.keep": "Bağlı tut",
  "connector.slack.close": "Kapat",
} as const satisfies PartialTranslation<typeof source>;
