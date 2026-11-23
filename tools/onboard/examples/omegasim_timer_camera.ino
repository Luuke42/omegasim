// ============================================================================
//  M5Stack Timer Camera X (ESP32, OV3660) als MJPEG-Stream für OmegaSim
//  WIP / UNGEPRÜFT. Pinbelegung laut M5Stack-Dokumentation (TimerCamera-X).
//
//  Arduino IDE:
//    - Board "M5TimerCAM" (ESP32) im Boardverwalter installieren
//    - Bibliothek "Timer-CAM" von M5Stack installieren (oder ESP32-Core nutzen)
//    - WLAN-Zugangsdaten unten eintragen, hochladen
//
//  OmegaSim:
//    Garage -> Onboard-Kamera -> Quelle "M5Stack Timer Camera (WLAN)"
//    -> IP der Kamera eintragen -> Einschalten.
//
//  Liefert:
//    http://<ip>/stream   MJPEG (multipart/x-mixed-replace) mit CORS-Kopf
//    http://<ip>/         Testseite mit eingebettetem Bild
//
//  Hinweise (M5Stack):
//    - PWR-Knopf zum Einschalten 2 s gedrückt halten.
//    - Batteriebetrieb: Der Braun-Out-Schutz kann die Kamera zurücksetzen;
//      der Code unten schaltet ihn ab (siehe setup()).
//    - Windows braucht ggf. den FTDI-VCP-Treiber.
// ============================================================================

#include <WiFi.h>
#include <esp_camera.h>
#include <esp_http_server.h>

// Für Batteriebetrieb: Braun-Out-Erkennung abschalten (empfohlen von M5Stack)
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ---- WLAN-Zugangsdaten ----
const char* WIFI_SSID = "DEIN-WLAN";
const char* WIFI_PASS = "DEIN-PASSWORT";

// ---- Pinbelegung der Timer Camera X (OV3660), laut M5Stack-Doku ----
#define PWDN_GPIO_NUM  -1
#define RESET_GPIO_NUM 15
#define XCLK_GPIO_NUM  27
#define SIOD_GPIO_NUM  25
#define SIOC_GPIO_NUM  23
#define Y9_GPIO_NUM    19   // D7
#define Y8_GPIO_NUM    36   // D6
#define Y7_GPIO_NUM    18   // D5
#define Y6_GPIO_NUM    39   // D4
#define Y5_GPIO_NUM    5    // D3
#define Y4_GPIO_NUM    34   // D2
#define Y3_GPIO_NUM    35   // D1
#define Y2_GPIO_NUM    32   // D0
#define VSYNC_GPIO_NUM 22
#define HREF_GPIO_NUM  26
#define PCLK_GPIO_NUM  21

camera_config_t config = {
  .pin_pwdn     = PWDN_GPIO_NUM,
  .pin_reset    = RESET_GPIO_NUM,
  .pin_xclk     = XCLK_GPIO_NUM,
  .pin_sccb_sda = SIOD_GPIO_NUM,
  .pin_sccb_scl = SIOC_GPIO_NUM,
  .pin_d7       = Y9_GPIO_NUM,
  .pin_d6       = Y8_GPIO_NUM,
  .pin_d5       = Y7_GPIO_NUM,
  .pin_d4       = Y6_GPIO_NUM,
  .pin_d3       = Y5_GPIO_NUM,
  .pin_d2       = Y4_GPIO_NUM,
  .pin_d1       = Y3_GPIO_NUM,
  .pin_d0       = Y2_GPIO_NUM,
  .pin_vsync    = VSYNC_GPIO_NUM,
  .pin_href     = HREF_GPIO_NUM,
  .pin_pclk     = PCLK_GPIO_NUM,
  .xclk_freq_hz = 20000000,          // 20 MHz
  .ledc_timer   = LEDC_TIMER_0,
  .ledc_channel = LEDC_CHANNEL_0,
  .pixel_format = PIXFORMAT_JPEG,
  .frame_size   = FRAMESIZE_VGA,     // 640x480; kleiner hält die Verzögerung klein
  .jpeg_quality = 12,
  .fb_count     = 2,
  .fb_location  = CAMERA_FB_IN_PSRAM,
  .grab_mode    = CAMERA_GRAB_LATEST
};

// ---- MJPEG-Grenze (multipart) ----
#define PART_BOUNDARY "123456789000000000000987654321"
#define STREAM_BOUNDARY "\r\n--" PART_BOUNDARY "\r\n"
#define STREAM_PART "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n"

httpd_handle_t server = NULL;

// /stream : MJPEG (multipart/x-mixed-replace), mit CORS-Kopf
static esp_err_t stream_handler(httpd_req_t* req) {
  httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=" PART_BOUNDARY);
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  while (true) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) return ESP_FAIL;
    char hdr[64];
    size_t hlen = snprintf(hdr, sizeof(hdr), STREAM_PART, fb->len);
    httpd_resp_send_chunk(req, hdr, hlen);
    httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
    httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    esp_camera_fb_return(fb);
  }
}

// / : Testseite mit eingebettetem Bild
static esp_err_t index_handler(httpd_req_t* req) {
  const char* html =
    "<html><body><h1>Timer Camera</h1>"
    "<img src=\"/stream\" style=\"width:100%\"></body></html>";
  httpd_resp_set_type(req, "text/html");
  httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

void startCamera() {
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Kamera-Fehler 0x%x\n", err);
    return;
  }
  sensor_t* s = esp_camera_sensor_get();
  if (s) s->set_vflip(s, 1);   // Bild aufrichten, je nach Einbau 0 oder 1
}

void startServer() {
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.server_port = 80;
  if (httpd_start(&server, &cfg) == ESP_OK) {
    httpd_uri_t uri = { .uri = "/", .method = HTTP_GET, .handler = index_handler };
    httpd_register_uri_handler(server, &uri);
    httpd_uri_t stream = { .uri = "/stream", .method = HTTP_GET, .handler = stream_handler };
    httpd_register_uri_handler(server, &stream);
  }
}

void setup() {
  // Batteriebetrieb (z. B. im Auto): Braun-Out-Erkennung abschalten, sonst
  // kann die Kamera bei kurzem Spannungseinbruch neu starten.
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  startCamera();
  startServer();
}

void loop() {
  delay(1000);
}
