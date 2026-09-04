// LinguaPlay controller — worn on the fist that throws the punches.
//
// The board has two jobs, and the split between them is the hand it is strapped
// to. The MPU6050 reads what the fist *does* — the punch, and the roll that
// steers the kart — because that is the one thing a hand wrapped around a
// controller can still say. The joystick and the button are for the menus and
// the pause screen only: they sit under a thumb that is closed around the grip
// mid-fight, so anything in the fight that depended on them would be a control
// the player cannot reach at the moment it matters.
//
// Blocking used to be the button and is now a gesture the camera reads — the
// palm brought back onto the chest. See `computer vision.py`, and
// software/src/game/input/HARDWARE.md for the whole contract.

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

#define BUZZER_PIN 32
#define BUZZER_CHANNEL 0

#define JOY_X 34
#define JOY_Y 35

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDR 0x3C

// WiFi and the bridge (bridge.py)
//
// The ESP32 has a 2.4 GHz radio only. On an iPhone hotspot that means
// Settings > Personal Hotspot > Maximize Compatibility must be ON, or the
// phone serves 5 GHz and the board never sees the network at all.
const char* WIFI_SSID = "iPhone";
const char* WIFI_PASSWORD = "dao12345";

// The laptop's address on that network.
//
// This is the one value that silently breaks: a hotspot hands out a new lease
// on every reconnect, and the only symptom is POSTs failing with code -1 while
// everything else looks healthy. The board reports its own IP in the telemetry
// below, so comparing that with `ipconfig` on the laptop tells you at a glance
// whether the two are even on the same subnet.
const char* API_URL = "http://172.20.10.3:5000/api/controller";

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

// Monotonic event counters.
//
// The game fires one punch per increment rather than reacting to `action`
// changing, because the two run on unrelated clocks: `action` is held at PUNCH
// for showDuration so the OLED can display it, and a browser polling at 50 Hz
// would otherwise read that one punch as forty. A counter makes the reading
// rate irrelevant — and a packet lost on the way still leaves the next one
// carrying the right total. The button is counted the same way, so a press
// selects one menu item however many pushes it spans.
unsigned long punchCount = 0;
unsigned long buttonCount = 0;

unsigned long lastPunchTime = 0;
unsigned long lastDisplayTime = 0;
unsigned long lastSerialTime = 0;
unsigned long lastShownTime = 0;
unsigned long lastApiTime = 0;
unsigned long lastWiFiCheck = 0;

const int punchCooldown = 350;
const int showDuration = 800;

// Fast enough that a punch reaches the game inside one animation frame or two,
// slow enough to leave the MPU and the display their share of the loop.
const int apiInterval = 50;

// Set from measurement, not taste.
//
// punchPower is |‖a‖ - 1g|, so it fires on any linear acceleration and cannot
// tell a jab from a hard sideways flick. Measured on this rig: deliberate
// punches peaked at 0.61, 0.65, 1.05, 1.12, 1.56, 2.37 and 2.95 g, while
// steering, walking about holding the controller, and setting it down peaked at
// 0.28, 0.40, 0.40 and 0.63 g. The two ranges overlap at the bottom, so no
// threshold catches every punch without also firing while the player steers.
//
// 0.8 sits above the loudest non-punch movement with margin and still catches
// five of the seven punches. It was 1.5, which caught only three: the player
// spent most of the round throwing punches the game ignored.
//
// Raising this is the fix for phantom punches while driving; lowering it is the
// fix for punches that do not land. Separating the two properly needs direction
// -- a gyro spike, or acceleration along the fist's forward axis -- rather than
// a bigger number here.
const float punchThreshold = 0.8;

// Radians of roll that count as full lock. About 35 degrees, so the kart can be
// steered from lane to lane with the wrist rather than the whole arm.
const float tiltRange = 0.6;
// Below this the board is treated as level, so a hand that is never perfectly
// still does not drift the kart out of the centre lane.
const float tiltDeadzone = 0.08;
// Exponential smoothing. The accelerometer is noisy, and a jittery steering
// axis reads as a broken controller rather than a twitchy one.
const float tiltSmoothing = 0.25;

// ---------------------------------------------------------- game feedback --
//
// Everything below is driven by the game, and arrives in the reply to the state
// we are already posting. The controller never polls for it: the push and the
// feedback share one request, so the round trip costs nothing beyond what the
// state update was going to cost anyway.

// Held open across pushes so the TCP connection is genuinely reused. See
// sendToBridge() for why a local HTTPClient is not good enough.
WiFiClient wifiClient;
HTTPClient http;
bool httpReady = false;
unsigned long httpFailures = 0;

// Latest one-shot command, identified by a sequence number so the same reply
// read twice is not flashed twice.
unsigned long lastCmdSeq = 0;
unsigned long feedbackUntil = 0;
int feedbackR = 0, feedbackG = 0, feedbackB = 0;
String feedbackText = "";

// The running scoreboard, mirrored onto the OLED.
int gameScore = 0;
int gameCombo = 0;
int gameHp = -1;
int gameMonsterHp = -1;
int gameLevel = 0;
String gameState = "";
bool gameLinked = false;

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

// The ESP32 core moved tone() in 3.x and renamed the LEDC API under it, so the
// sketch picks the one it was compiled against rather than pinning the whole
// project to a core version.
void buzzerSetup() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  // tone() attaches its own channel on first use.
#else
  ledcSetup(BUZZER_CHANNEL, 2000, 8);
  ledcAttachPin(BUZZER_PIN, BUZZER_CHANNEL);
#endif
}

void buzzerOff() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  noTone(BUZZER_PIN);
#else
  ledcWriteTone(BUZZER_CHANNEL, 0);
#endif
}

void buzzerTone(int frequency) {
  if (frequency <= 0) {
    buzzerOff();
    return;
  }
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  tone(BUZZER_PIN, frequency);
#else
  ledcWriteTone(BUZZER_CHANNEL, frequency);
#endif
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
    // The single biggest source of input lag on this rig.
    //
    // The ESP32 defaults to modem sleep, waking only on the access point's
    // DTIM beacon. A phone hotspot beacons slowly, so every request waits for
    // the next wake-up: pushes drop to about 6 a second and each punch carries
    // that delay with it. Staying awake costs battery and buys back the
    // responsiveness the whole game is built on.
    WiFi.setSleep(false);
    Serial.println("WiFi connected (modem sleep disabled)");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
    // Printed together so a subnet mismatch is obvious in the serial monitor
    // without having to know what the laptop's address is supposed to be.
    Serial.print("Posting to: ");
    Serial.println(API_URL);
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

  int previousButton = buttonState;
  buttonState = digitalRead(BUTTON_PIN);

  // The press, not the hold. A thumb resting on the button must select one menu
  // item, the way tapping it does, rather than a new one on every push.
  if (buttonState == LOW && previousButton == HIGH) {
    buttonCount++;
  }

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
    punchCount++;
  }

  // The headline holds for showDuration after whatever caused it, so a punch
  // is still readable on the OLED once the fist has come back down.
  if (buttonState == LOW) {
    lastShownTime = now;
    action = "MENU";
  } else if (now - lastShownTime >= showDuration) {
    action = "READY";
  }

  // The game's verdict outranks the local one while it is showing: a punch that
  // the game scored as WRONG should read red on the glove, not the green the
  // controller lights for "I detected a punch".
  if (now < feedbackUntil) {
    setLED(feedbackR, feedbackG, feedbackB);
    return;
  }

  buzzerOff();

  if (action == "PUNCH") {
    setLED(false, true, false);
  } else if (action == "MENU") {
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
  json += "\"tilt\":" + String(tilt, 3) + ",";
  json += "\"punchCount\":" + String(punchCount) + ",";
  json += "\"buttonCount\":" + String(buttonCount) + ",";
  // Where the board thinks it is. Costs nothing and turns "why is nothing
  // arriving" from a guess into a subnet comparison.
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\"";

  json += "}";

  return json;
}

// Debug telemetry, deliberately not once per loop.
//
// The line is about 145 bytes and the UART buffer is 128, so println blocks
// until the wire drains -- 13 ms at 115200, every loop, spent on output nobody
// reads while the game is running. Five a second is still plenty to watch the
// sensors in a serial monitor.
void printSerial() {
  if (millis() - lastSerialTime < 200) return;
  lastSerialTime = millis();
  Serial.println(makeJson());
}

// ------------------------------------------------------- reply parsing --
//
// Deliberately not ArduinoJson. The reply has a known, tiny shape, and a
// dependency-free reader keeps this sketch compilable on a fresh Arduino IDE
// with only the two Adafruit display libraries installed.

// Value of "key": as an integer, or `fallback` when the key is absent.
long jsonLong(const String& body, const char* key, long fallback) {
  String needle = String("\"") + key + "\":";
  int at = body.indexOf(needle);
  if (at < 0) return fallback;

  at += needle.length();
  while (at < (int)body.length() && body[at] == ' ') at++;

  int end = at;
  if (end < (int)body.length() && (body[end] == '-' || body[end] == '+')) end++;
  while (end < (int)body.length() && isDigit(body[end])) end++;
  if (end == at) return fallback;

  return body.substring(at, end).toInt();
}

// Value of "key": as a quoted string, or "" when absent.
String jsonString(const String& body, const char* key) {
  String needle = String("\"") + key + "\":\"";
  int at = body.indexOf(needle);
  if (at < 0) return "";

  at += needle.length();
  int end = body.indexOf('"', at);
  if (end < 0) return "";

  return body.substring(at, end);
}

// Value of "led":[r,g,b]. Left untouched when the key is absent.
void jsonRgb(const String& body, int& r, int& g, int& b) {
  int at = body.indexOf("\"led\":[");
  if (at < 0) return;

  at += 7;
  int end = body.indexOf(']', at);
  if (end < 0) return;

  String list = body.substring(at, end);
  int first = list.indexOf(',');
  int second = list.indexOf(',', first + 1);
  if (first < 0 || second < 0) return;

  r = list.substring(0, first).toInt();
  g = list.substring(first + 1, second).toInt();
  b = list.substring(second + 1).toInt();
}

void applyFeedback(const String& body) {
  gameLinked = true;

  // Status is continuous and always present; it is what the OLED mirrors.
  gameScore = jsonLong(body, "score", gameScore);
  gameCombo = jsonLong(body, "combo", gameCombo);
  gameHp = jsonLong(body, "hp", gameHp);
  gameMonsterHp = jsonLong(body, "monsterHp", gameMonsterHp);
  gameLevel = jsonLong(body, "level", gameLevel);

  String state = jsonString(body, "state");
  if (state.length() > 0) gameState = state;

  // The command is one-shot. `seq` only ever moves forward, so a reply that
  // carries nothing new leaves the current flash to finish undisturbed.
  long seq = jsonLong(body, "seq", 0);
  if (seq <= 0 || (unsigned long)seq == lastCmdSeq) return;
  lastCmdSeq = seq;

  int r = 1, g = 1, b = 1;
  jsonRgb(body, r, g, b);
  feedbackR = r;
  feedbackG = g;
  feedbackB = b;

  long ms = jsonLong(body, "ms", 120);
  feedbackUntil = millis() + (ms > 0 ? ms : 120);

  String text = jsonString(body, "text");
  if (text.length() > 0) feedbackText = text;

  buzzerTone(jsonLong(body, "buzz", 0));
}

void sendToBridge() {
  if (WiFi.status() != WL_CONNECTED) {
    // Drop the socket so the next connected loop opens a fresh one rather than
    // writing into a half-open connection the access point has forgotten.
    if (httpReady) {
      http.end();
      httpReady = false;
    }
    gameLinked = false;
    return;
  }

  if (millis() - lastApiTime < apiInterval) return;
  lastApiTime = millis();

  // The client and the request are file-scope so the TCP connection actually
  // survives between pushes. A local HTTPClient is destroyed at the end of the
  // call, so setReuse() has nothing to reuse and every push pays a fresh
  // three-way handshake -- about 185 ms on a phone hotspot, which throttled the
  // whole loop to 5 Hz and made punches arrive late.
  if (!httpReady) {
    http.begin(wifiClient, API_URL);
    http.addHeader("Content-Type", "application/json");
    http.setReuse(true);
    // Well under the loop budget: a push that cannot complete promptly is
    // better abandoned than allowed to stall the MPU and the display.
    http.setTimeout(400);
    http.setConnectTimeout(400);
    httpReady = true;
  }

  int responseCode = http.POST(makeJson());

  if (responseCode == 200) {
    // The reply to the push we were making anyway: this is the whole of the
    // game-to-hardware channel.
    applyFeedback(http.getString());
    httpFailures = 0;
  } else {
    gameLinked = false;
    httpFailures++;
    // A reused socket that the other end has closed fails once; reopening is
    // the fix. Persistent failure means the bridge is gone, and saying so once
    // is worth more than a line per push.
    if (httpFailures == 1 || httpFailures % 40 == 0) {
      Serial.print("Bridge POST failed, code ");
      Serial.print(responseCode);
      Serial.print(" (");
      Serial.print(httpFailures);
      Serial.println(" in a row)");
    }
    http.end();
    httpReady = false;
  }
}

void updateOLED() {
  // A full 1 KB framebuffer over I2C costs about 23 ms. Eight refreshes a
  // second still reads as live, and the time saved goes to the push rate --
  // which is what the punch travels on.
  if (millis() - lastDisplayTime < 125) return;
  lastDisplayTime = millis();

  bool showingFeedback = millis() < feedbackUntil;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("LinguaPlay");

  // Two letters in the corner answer "why is nothing happening": W for the
  // network, G for the game actually replying on the other end of it.
  display.setCursor(98, 0);
  display.print(WiFi.status() == WL_CONNECTED ? "W" : "-");
  display.print(gameLinked ? "G" : "-");

  display.drawLine(0, 11, 127, 11, SSD1306_WHITE);

  // The headline is the game's verdict while one is live, and the controller's
  // own state the rest of the time.
  display.setTextSize(2);
  display.setCursor(0, 16);
  display.println(showingFeedback && feedbackText.length() > 0 ? feedbackText : action);

  display.setTextSize(1);

  if (gameLinked) {
    display.setCursor(0, 38);
    display.print("SCORE ");
    display.print(gameScore);

    display.setCursor(84, 38);
    display.print("x");
    display.print(gameCombo);

    display.setCursor(0, 48);
    if (gameHp >= 0) {
      display.print("HP ");
      display.print(gameHp);
    }
    display.setCursor(56, 48);
    if (gameMonsterHp >= 0) {
      display.print("MON ");
      display.print(gameMonsterHp);
    }
  } else {
    // Not connected yet, so show what is worth calibrating instead: the tilt
    // axis and the stick, both readable without a serial monitor.
    display.setCursor(0, 38);
    display.print("Joy: ");
    display.print(joyDir);

    display.setCursor(74, 38);
    display.print("T:");
    display.print(tilt, 2);

    display.setCursor(0, 48);
    display.print("X:");
    display.print(joyX);

    display.setCursor(64, 48);
    display.print("Y:");
    display.print(joyY);
  }

  // The stance the game will read, drawn as three cells with the live one
  // filled. Lets the tilt range be calibrated by tilting until the right cell
  // lights, with no screen and no serial monitor.
  int lane = tilt < -0.34 ? 0 : (tilt > 0.34 ? 2 : 1);
  for (int i = 0; i < 3; i++) {
    int x = 92 + i * 12;
    if (i == lane) {
      display.fillRect(x, 56, 8, 6, SSD1306_WHITE);
    } else {
      display.drawRect(x, 56, 8, 6, SSD1306_WHITE);
    }
  }

  display.display();
}

void setup() {
  Serial.begin(115200);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);

  pinMode(BUZZER_PIN, OUTPUT);
  buzzerSetup();
  buzzerOff();

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
  sendToBridge();
  updateOLED();

  delay(20);
}
