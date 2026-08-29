#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define MPU_ADDR 0x68

#define SDA_PIN 21
#define SCL_PIN 22

#define BUTTON_PIN 27

#define LED_G 26
#define LED_R 25
#define LED_B 33

#define JOY_X 34
#define JOY_Y 35

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDR 0x3C

// WiFi and Flask API
const char* WIFI_SSID = "internet";
const char* WIFI_PASSWORD = "password";

// Change this to your laptop's LAN IPv4 address
const char* API_URL = "http://{ip}:5000/api/controller";

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

int16_t accX, accY, accZ;
int16_t gyroX, gyroY, gyroZ;

float ax, ay, az;
float gx, gy, gz;

float accPower = 0;
float punchPower = 0;

// Steering for the kart chase: -1 tilted fully left, 0 level, +1 fully right.
float tilt = 0;

int joyX = 0;
int joyY = 0;
int buttonState = HIGH;

String action = "READY";
String joyDir = "CENTER";

unsigned long lastPunchTime = 0;
unsigned long lastDisplayTime = 0;
unsigned long lastShownTime = 0;
unsigned long lastApiTime = 0;
unsigned long lastWiFiCheck = 0;

const int punchCooldown = 350;
const int showDuration = 800;
const int apiInterval = 100;

const float punchThreshold = 1.5;

// Radians of roll that count as full lock. About 35 degrees, so the kart can be
// steered from lane to lane with the wrist rather than the whole arm.
const float tiltRange = 0.6;
// Below this the board is treated as level, so a hand that is never perfectly
// still does not drift the kart out of the centre lane.
const float tiltDeadzone = 0.08;
// Exponential smoothing. The accelerometer is noisy, and a jittery steering
// axis reads as a broken controller rather than a twitchy one.
const float tiltSmoothing = 0.25;

void writeMPU(byte reg, byte data) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(data);
  Wire.endTransmission();
}

void setLED(bool r, bool g, bool b) {
  digitalWrite(LED_R, r ? HIGH : LOW);
  digitalWrite(LED_G, g ? HIGH : LOW);
  digitalWrite(LED_B, b ? HIGH : LOW);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");

  unsigned long startTime = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 15000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connection failed");
  }
}

void keepWiFiConnected() {
  if (millis() - lastWiFiCheck < 5000) return;
  lastWiFiCheck = millis();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected. Reconnecting...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

void readMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);

  int received = Wire.requestFrom(MPU_ADDR, 14, true);

  if (received != 14) {
    return;
  }

  accX = Wire.read() << 8 | Wire.read();
  accY = Wire.read() << 8 | Wire.read();
  accZ = Wire.read() << 8 | Wire.read();

  Wire.read();
  Wire.read();

  gyroX = Wire.read() << 8 | Wire.read();
  gyroY = Wire.read() << 8 | Wire.read();
  gyroZ = Wire.read() << 8 | Wire.read();

  // MPU6050 accel range: +-8g
  ax = accX / 4096.0;
  ay = accY / 4096.0;
  az = accZ / 4096.0;

  gx = gyroX / 131.0;
  gy = gyroY / 131.0;
  gz = gyroZ / 131.0;

  updateTilt();
}

// Roll angle straight out of gravity.
//
// Deliberately the accelerometer and not the gyro: the gyro reports how fast
// the board is turning, which has to be integrated to get an angle and drifts
// as soon as it is. atan2 of two gravity components is an absolute angle that
// never drifts, which is what a steering axis needs — let go of the wheel and
// the kart really is back in the centre lane.
//
// Swap ay/az below if the board is mounted on a different face.
void updateTilt() {
  float roll = atan2(ay, az);
  float target = roll / tiltRange;

  if (target > 1.0) target = 1.0;
  if (target < -1.0) target = -1.0;
  if (fabs(target) < tiltDeadzone) target = 0;

  tilt = tilt + (target - tilt) * tiltSmoothing;
}

void readInputs() {
  joyX = analogRead(JOY_X);
  joyY = analogRead(JOY_Y);
  buttonState = digitalRead(BUTTON_PIN);

  if (joyX < 1200) {
    joyDir = "LEFT";
  } else if (joyX > 2800) {
    joyDir = "RIGHT";
  } else if (joyY < 1200) {
    joyDir = "UP";
  } else if (joyY > 2800) {
    joyDir = "DOWN";
  } else {
    joyDir = "CENTER";
  }
}

void updateAction() {
  unsigned long now = millis();

  accPower = sqrt(ax * ax + ay * ay + az * az);
  punchPower = abs(accPower - 1.0);

  bool punched = punchPower > punchThreshold &&
                 now - lastPunchTime > punchCooldown;

  if (punched) {
    lastPunchTime = now;
    lastShownTime = now;
    action = "PUNCH";
  }

  if (buttonState == LOW) {
    lastShownTime = now;
    action = "BUTTON";
  }

  if (buttonState == LOW) {
    action = "BUTTON";
  } else if (now - lastShownTime < showDuration && punched) {
    action = "PUNCH";
  } else if (now - lastShownTime >= showDuration) {
    action = "READY";
  }

  if (action == "PUNCH") {
    setLED(false, true, false);
  } else if (action == "BUTTON") {
    setLED(false, false, true);
  } else {
    setLED(true, false, false);
  }
}

String makeJson() {
  String json = "{";

  json += "\"action\":\"" + action + "\",";
  json += "\"joy\":\"" + joyDir + "\",";
  json += "\"button\":" + String(buttonState == LOW ? 1 : 0) + ",";
  json += "\"x\":" + String(joyX) + ",";
  json += "\"y\":" + String(joyY) + ",";
  json += "\"punchPower\":" + String(punchPower, 2) + ",";
  json += "\"accPower\":" + String(accPower, 2) + ",";
  json += "\"tilt\":" + String(tilt, 3);

  json += "}";

  return json;
}

void printSerial() {
  Serial.println(makeJson());
}

void sendToFlask() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastApiTime < apiInterval) return;

  lastApiTime = millis();

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(1000);

  int responseCode = http.POST(makeJson());

  Serial.print("Flask HTTP response: ");
  Serial.println(responseCode);

  http.end();
}

void updateOLED() {
  if (millis() - lastDisplayTime < 80) return;
  lastDisplayTime = millis();

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("ESP32 Game Remote");
  display.drawLine(0, 11, 127, 11, SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(0, 17);
  display.println(action);

  display.setTextSize(1);
  display.setCursor(0, 40);
  display.print("Joy: ");
  display.print(joyDir);

  // Live steering readout, so tiltRange can be calibrated against the board's
  // actual mounting without a serial monitor.
  display.setCursor(74, 40);
  display.print("T:");
  display.print(tilt, 2);

  display.setCursor(0, 50);
  display.print("X:");
  display.print(joyX);

  display.setCursor(64, 50);
  display.print("Y:");
  display.print(joyY);

  display.display();
}

void setup() {
  Serial.begin(115200);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);

  setLED(true, false, false);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  writeMPU(0x6B, 0x00);
  delay(100);

  writeMPU(0x1A, 0x03);
  writeMPU(0x1B, 0x00);
  writeMPU(0x1C, 0x10);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED not found");
    while (true);
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Game Remote Ready");
  display.println("Connecting WiFi...");
  display.display();

  connectWiFi();

  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Game Remote Ready");

  if (WiFi.status() == WL_CONNECTED) {
    display.println("WiFi connected");
  } else {
    display.println("WiFi failed");
  }

  display.display();
  delay(1000);
}

void loop() {
  keepWiFiConnected();

  readMPU();
  readInputs();
  updateAction();

  printSerial();
  sendToFlask();
  updateOLED();

  delay(20);
}
